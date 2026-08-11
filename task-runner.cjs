/**
 * @file 任务运行器
 * @description 加载任务注册表、解析依赖图（拓扑排序）、按序执行任务。
 *              支持 TUI 模式和回退内联模式。
 *              基于统一 TaskDAG + ConflictSet 架构。
 * @module scripts/build/task-runner
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '../..');
const TASKS_DIR = path.join(__dirname, 'tasks');

// ============================================================
//  TaskDAG — 有向无环依赖图
// ============================================================

/**
 * 任务有向无环图。
 * 封装节点关系、依赖计数、就绪集、路径检测、拓扑排序。
 *
 * 每个节点的 TypeScript 形态：
 *   { task: object, index: number,
 *     parents: Set<string>, children: Set<string>,
 *     remainingDeps: number, conflicts: Set<string> }
 */
class TaskDAG {
  /**
   * @param {Array<object>} taskList - 拓扑排序后的任务列表（顺序仅作初始 index 参考）
   */
  constructor(taskList) {
    /** @type {Map<string, { task: object, index: number, parents: Set<string>, children: Set<string>, remainingDeps: number, conflicts: Set<string> }>} */
    this.nodes = new Map();

    for (let i = 0; i < taskList.length; i++) {
      const t = taskList[i];
      const node = {
        task: t,
        index: i,
        parents: new Set(),
        children: new Set(),
        remainingDeps: 0,
        conflicts: new Set(t.conflicts || []),
      };
      this.nodes.set(t.id, node);
    }

    // 连线：t.dependsOn[d] ⇒ d → t
    for (let i = 0; i < taskList.length; i++) {
      const t = taskList[i];
      const node = this.nodes.get(t.id);
      for (const depId of t.dependsOn) {
        if (this.nodes.has(depId)) {
          node.parents.add(depId);
          node.remainingDeps++;
          this.nodes.get(depId).children.add(t.id);
        }
      }
    }
  }

  /**
   * 获取就绪任务 ID 集合（remainingDeps === 0）
   * @returns {Set<string>}
   */
  getReady() {
    const ready = new Set();
    for (const [id, node] of this.nodes) {
      if (node.remainingDeps === 0) ready.add(id);
    }
    return ready;
  }

  /**
   * 标记节点完成，递减所有后继的 remainingDeps
   * @param {string} id - 已完成的任务 ID
   * @returns {string[]} 被解封的后继任务 ID
   */
  onDone(id) {
    const node = this.nodes.get(id);
    const unblocked = [];
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      child.remainingDeps--;
      if (child.remainingDeps === 0) unblocked.push(childId);
    }
    return unblocked;
  }

  /**
   * DFS 检查 from 是否能到达 to
   * @param {string} from
   * @param {string} to
   * @returns {boolean}
   */
  hasPath(from, to) {
    if (from === to) return true;
    const visited = new Set();
    const stack = [from];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === to) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const next of this.nodes.get(node).children) {
        stack.push(next);
      }
    }
    return false;
  }

  /**
   * 在两个无路径的冲突节点间插入串行边 a → b
   * @param {string} a - 先执行的任务 ID
   * @param {string} b - 后执行的任务 ID
   */
  addEdge(a, b) {
    if (this.hasPath(a, b) || this.hasPath(b, a)) return;
    const nodeA = this.nodes.get(a);
    const nodeB = this.nodes.get(b);
    nodeA.children.add(b);
    nodeB.parents.add(a);
    nodeB.remainingDeps++;
  }

  /**
   * Kahn 拓扑排序，按传递依赖计数降序出队
   * @returns {{ ordered: Array<object>, cyclic: boolean }}
   */
  topologicalSort() {
    const inDegree = new Map();
    const graph = new Map();
    for (const [id, node] of this.nodes) {
      inDegree.set(id, node.remainingDeps); // 副本，用于排序
      graph.set(id, [...node.children]);
    }

    // 传递依赖计数（BFS）
    const reachableCount = new Map();
    for (const id of this.nodes.keys()) {
      const visited = new Set();
      const q = [id];
      while (q.length > 0) {
        const cur = q.shift();
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const next of graph.get(cur)) q.push(next);
      }
      reachableCount.set(id, visited.size);
    }

    const ordered = [];
    const zeroQueue = [];

    for (const [id, deg] of inDegree) {
      if (deg === 0) zeroQueue.push(id);
    }

    while (zeroQueue.length > 0) {
      zeroQueue.sort((a, b) => {
        const rc = reachableCount.get(b) - reachableCount.get(a);
        if (rc !== 0) return rc;
        return a.localeCompare(b);
      });
      const id = zeroQueue.shift();
      ordered.push(this.nodes.get(id).task);

      for (const next of graph.get(id)) {
        const newDeg = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) zeroQueue.push(next);
      }
    }

    return { ordered, cyclic: ordered.length !== this.nodes.size };
  }
}

// ============================================================
//  ConflictSet — 资源冲突锁
// ============================================================

/**
 * 资源冲突锁集合。
 * 管理共享资源的互斥：正在使用某资源时，其他需要同资源的任务必须等待。
 */
class ConflictSet {
  constructor() {
    /** @type {Set<string>} 当前被占用的资源名 */
    this.active = new Set();
  }

  /**
   * 尝试获取冲突锁。无冲突返回 true，否则 false。
   * @param {{ conflicts: Set<string> }} node - DAG 节点
   * @returns {boolean}
   */
  tryAcquire(node) {
    for (const res of node.conflicts) {
      if (this.active.has(res)) return false;
    }
    for (const res of node.conflicts) {
      this.active.add(res);
    }
    return true;
  }

  /**
   * 释放节点的全部冲突锁
   * @param {{ conflicts: Set<string> }} node - DAG 节点
   */
  release(node) {
    for (const res of node.conflicts) {
      this.active.delete(res);
    }
  }
}

// ============================================================
//  加载
// ============================================================

/**
 * 递归收集 tasks/ 下所有 .cjs 文件
 * @param {string} dir
 * @returns {string[]}
 */
function collectTaskFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTaskFiles(full));
    } else if (entry.name.endsWith('.cjs')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * 加载所有任务定义，构建注册表
 * @returns {Map<string, { id: string, description: string, dependsOn: string[], conflicts: string[], retry?: number, run: { cmd?: string, fn?: () => boolean } }>}
 */
function loadTaskRegistry() {
  const registry = new Map();
  const files = collectTaskFiles(TASKS_DIR);

  for (const file of files) {
    const exported = require(file);
    const defs = Array.isArray(exported) ? exported : [exported];

    for (const def of defs) {
      if (!def || !def.id) {
        console.warn('Task file missing id:', path.relative(ROOT_DIR, file));
        continue;
      }
      if (registry.has(def.id)) {
        console.warn('Duplicate task id:', def.id);
        continue;
      }

      registry.set(def.id, {
        id: def.id,
        description: def.description || def.id,
        dependsOn: def.dependsOn || [],
        conflicts: def.conflicts || [],
        retry: def.retry,
        run: def.run || {},
      });
    }
  }

  return registry;
}

// ============================================================
//  依赖解析
// ============================================================

/**
 * 解析目标任务的完整依赖图，返回拓扑排序后的执行列表。
 * 使用 TaskDAG 统一管理：BFS 收集 → 构建 DAG → 冲突边 → 拓扑排序。
 * @param {string[]} targetIds - 目标任务 ID 列表
 * @param {Map} registry - 任务注册表
 * @returns {{ ordered: Array, errors: string[] }}
 */
function resolveTaskGraph(targetIds, registry) {
  const errors = [];

  // 验证所有目标存在
  for (const id of targetIds) {
    if (!registry.has(id)) {
      errors.push('Unknown task: ' + id);
    }
  }
  if (errors.length > 0) return { ordered: [], errors };

  // BFS 收集所有需要的任务（包含传递依赖）
  const needed = new Set();
  const queue = [...targetIds];

  while (queue.length > 0) {
    const id = queue.shift();
    if (needed.has(id)) continue;
    needed.add(id);

    const task = registry.get(id);
    if (!task) {
      errors.push('Unknown dependency: ' + id);
      continue;
    }
    for (const dep of task.dependsOn) {
      queue.push(dep);
    }
  }
  if (errors.length > 0) return { ordered: [], errors };

  // 构建 DAG
  const taskList = [];
  for (const id of needed) taskList.push(registry.get(id));
  const dag = new TaskDAG(taskList);

  // 冲突边插入：共享资源的任务间若无路径，自动加串行边
  const conflictGroups = new Map();
  for (const id of needed) {
    const task = registry.get(id);
    for (const res of (task.conflicts || [])) {
      if (!conflictGroups.has(res)) conflictGroups.set(res, new Set());
      conflictGroups.get(res).add(id);
    }
  }

  for (const ids of conflictGroups.values()) {
    if (ids.size < 2) continue;
    const arr = [...ids];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        dag.addEdge(arr[i], arr[j]);
      }
    }
  }

  // 拓扑排序
  const { ordered, cyclic } = dag.topologicalSort();

  if (cyclic) {
    errors.push('Circular dependency detected');
    return { ordered: [], errors };
  }

  return { ordered, errors: [] };
}

// ============================================================
//  执行
// ============================================================

/** 最大并行任务数 */
const MAX_CONCURRENT = 4;

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 3;

/** 重试基础延迟（ms），指数退避：delay * 2^(attempt-1) */
const RETRY_BASE_DELAY = 1000;

/**
 * 执行回调接口
 * @typedef {object} RunCallbacks
 * @property {(tasks: Array<{ id: string, description: string, dependsOn: string[] }>) => void} onInit
 * @property {(id: string, status: string, elapsed?: number) => void} onStatus
 * @property {(text: string, taskId?: string) => void} onLog
 * @property {(ok: boolean) => void} onExit
 */

/**
 * 静默执行 shell 命令（TUI 模式：捕获输出通过 onLog 发送）
 * @param {string} cmd - shell 命令
 * @param {RunCallbacks} cb
 * @param {{ signaled: boolean }} [abort] - 外部中止信号，poll 检测到后 kill 子进程
 * @returns {Promise<boolean>}
 */
function runCmdSilent(cmd, cb, abort) {
  return new Promise((resolve) => {
    const child = spawn(cmd, [], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    // 监听 abort：轮询检测，信号到位立即杀子进程
    if (abort) {
      const timer = setInterval(() => {
        if (abort.signaled) {
          clearInterval(timer);
          try { child.kill(); } catch (_) {}
        }
      }, 50);
      child.on('close', () => clearInterval(timer));
    }

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    const onData = (text) => {
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        const clean = l.replace(/\r$/, '');
        if (clean.trim()) cb.onLog(clean);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('close', (code) => {
      if (buf.trim()) cb.onLog(buf.replace(/\r$/, '').trimEnd());
      resolve(code === 0);
    });
    child.on('error', () => resolve(false));
  });
}

/**
 * inherit stdio 执行命令（回退模式）
 * @param {string} cmd
 * @returns {Promise<boolean>}
 */
function runCmdInherit(cmd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, [], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/**
 * 执行单个任务（含自动重试）
 * 失败时按指数退避重试，最多 retry 次（默认 3）。
 * 优先级：retryOverride（CLI --retry）> task.retry（任务自定义）> DEFAULT_MAX_RETRIES。
 * @param {object} task - 任务定义
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} [cb]
 * @param {string} [taskId] - 任务 ID，用于日志关联
 * @param {{ signaled: boolean }} [abort] - 外部中止信号
 * @param {number} [retryOverride] - CLI 传入的全局重试次数覆盖
 * @returns {Promise<boolean>}
 */
async function executeOneTask(task, mode, cb, taskId, abort, retryOverride) {
  const maxRetries = retryOverride != null ? retryOverride : (task.retry != null ? task.retry : DEFAULT_MAX_RETRIES);

  // 包装回调：所有 onLog 自动归属到当前任务
  const wcb = cb ? {
    onLog: (text) => cb.onLog(text, taskId),
    onStatus: (id, s, e) => cb.onStatus(id, s, e),
    onInit: (tasks) => cb.onInit(tasks),
    onExit: (ok) => cb.onExit(ok),
  } : null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (abort && abort.signaled) return false;

    if (attempt > 0) {
      const delayMs = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt - 1), 30000);
      if (wcb) {
        wcb.onLog(`[retry] ${task.description}: attempt ${attempt}/${maxRetries}, waiting ${delayMs / 1000}s...`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
      if (abort && abort.signaled) return false;
    }

    let ok;
    if (task.run.fn) {
      // 捕获 run.fn 的 console 输出，转发到 TUI 日志（否则 console.warn 等不会出现在 TUI 中）
      const origWarn = console.warn;
      const origLog = console.log;
      const origError = console.error;
      if (wcb) {
        const fwd = (...args) => wcb.onLog(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
        console.warn = fwd;
        console.log = fwd;
        console.error = fwd;
      }
      try {
        ok = task.run.fn() !== false;
      } catch (e) {
        if (wcb) wcb.onLog(String((e && e.stack) || e));
        ok = false;
      } finally {
        console.warn = origWarn;
        console.log = origLog;
        console.error = origError;
      }
    } else if (task.run.cmd) {
      ok = mode === 'tui'
        ? await runCmdSilent(task.run.cmd, wcb, abort)
        : await runCmdInherit(task.run.cmd);
    } else {
      ok = true;
    }

    if (ok) return true;

    if (wcb && attempt < maxRetries) {
      wcb.onLog(`[retry] ${task.description}: failed, will retry (${maxRetries - attempt} left)`);
    }
  }

  return false;
}

/**
 * 串行执行（inline/回退模式用）
 * @param {Array} taskList
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} [cb]
 * @param {{ signaled: boolean }} [abort] - 外部中止信号
 * @param {number} [retryOverride] - CLI 传入的全局重试次数覆盖
 * @returns {Promise<boolean>}
 */
async function executeTasksSequential(taskList, mode, cb, abort, retryOverride) {
  if (cb) {
    cb.onInit(taskList.map((t) => ({ id: t.id, description: t.description, dependsOn: t.dependsOn })));
  }

  let allOk = true;

  for (let i = 0; i < taskList.length; i++) {
    if (abort && abort.signaled) {
      if (cb) {
        for (let j = i; j < taskList.length; j++) cb.onStatus(taskList[j].id, 'skipped');
        cb.onExit(false);
      }
      return false;
    }

    const task = taskList[i];
    const start = Date.now();
    if (cb) cb.onStatus(task.id, 'running');
    const ok = await executeOneTask(task, mode, cb, task.id, abort, retryOverride);
    const elapsed = Date.now() - start;

    if (ok) {
      if (cb) cb.onStatus(task.id, 'done', elapsed);
    } else {
      if (cb) cb.onStatus(task.id, 'failed', elapsed);
      allOk = false;
      for (let j = i + 1; j < taskList.length; j++) {
        if (cb) cb.onStatus(taskList[j].id, 'skipped');
      }
      break;
    }
  }

  if (cb) cb.onExit(allOk);
  return allOk;
}

/**
 * 并行执行（TUI 模式用）。
 * 基于 TaskDAG 依赖调度 + ConflictSet 冲突锁：
 *   依赖满足 → 无冲突锁 → 有空闲槽位 → 立即执行。
 * @param {Array} taskList - 拓扑排序后的任务定义数组
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} cb - TUI 回调
 * @param {{ signaled: boolean }} [abort] - 外部中止信号
 * @returns {Promise<boolean>}
 */
async function executeTasksParallel(taskList, mode, cb, abort) {
  cb.onInit(taskList.map((t) => ({ id: t.id, description: t.description, dependsOn: t.dependsOn })));

  const dag = new TaskDAG(taskList);
  const conflicts = new ConflictSet();

  const ready = dag.getReady();
  /** @type {Set<string>} 已到达终态（done 或 failed）的任务 ID */
  const completed = new Set();
  const running = new Map();
  let allOk = true;

  let resolveDone;
  const donePromise = new Promise((r) => { resolveDone = r; });
  let finished = false;

  /**
   * 尝试调度：从 ready 集合中取出可执行的任务并启动。
   * 单任务失败不中止全局 —— 仅阻断其子孙，独立分支继续执行。
   */
  function trySchedule() {
    if (finished) return;

    // 外部中止：杀子进程，标记未完成，退出
    if (abort && abort.signaled) {
      finished = true;
      for (const node of dag.nodes.values()) {
        if (!completed.has(node.task.id)) cb.onStatus(node.task.id, 'skipped');
      }
      cb.onExit(false);
      resolveDone();
      return;
    }

    for (const id of [...ready]) {
      if (running.size >= MAX_CONCURRENT) break;

      const node = dag.nodes.get(id);
      if (!conflicts.tryAcquire(node)) continue;

      ready.delete(id);
      const task = node.task;

      cb.onStatus(task.id, 'running');

      const start = Date.now();

      const promise = executeOneTask(task, mode, cb, task.id, abort, retryOverride).then((ok) => {
        // 中止后不再处理子进程结束事件
        if (finished) return;

        const elapsed = Date.now() - start;
        running.delete(id);
        conflicts.release(node);
        completed.add(id);

        if (ok) {
          cb.onStatus(task.id, 'done', elapsed);
          for (const uid of dag.onDone(id)) ready.add(uid);
        } else {
          cb.onStatus(task.id, 'failed', elapsed);
          allOk = false;
        }

        trySchedule();
      });

      running.set(id, promise);
    }

    // 终止条件：无就绪任务且无运行中任务
    if (!finished && ready.size === 0 && running.size === 0) {
      finished = true;
      for (const node of dag.nodes.values()) {
        if (!completed.has(node.task.id)) {
          cb.onStatus(node.task.id, 'skipped');
        }
      }
      cb.onExit(allOk);
      resolveDone();
    }
  }

  // 轮询 abort，确保无任务完成时也能检测到中止信号
  let abortTimer;
  if (abort) {
    abortTimer = setInterval(() => {
      if (abort.signaled) trySchedule();
    }, 100);
  }

  trySchedule();
  await donePromise;
  if (abortTimer) clearInterval(abortTimer);

  return allOk;
}

/**
 * 按序执行已解析的任务列表（TUI 模式并行、回退模式串行）
 * @param {Array} taskList - 拓扑排序后的任务定义数组
 * @param {'tui'|'inline'} mode - 执行模式
 * @param {RunCallbacks} [tuiCallbacks] - TUI 模式回调
 * @param {{ signaled: boolean }} [abort] - 外部中止信号
 * @param {number} [retryOverride] - CLI 传入的全局重试次数覆盖
 * @returns {Promise<boolean>} 是否全部成功
 */
async function executeTasks(taskList, mode, tuiCallbacks, abort, retryOverride) {
  if (mode === 'tui' && tuiCallbacks) {
    return executeTasksParallel(taskList, mode, tuiCallbacks, abort, retryOverride);
  }
  return executeTasksSequential(taskList, mode, tuiCallbacks || null, abort, retryOverride);
}

// ============================================================
//  便捷入口
// ============================================================

/**
 * 加载注册表 → 解析依赖 → 执行
 * @param {string[]} targetIds - 目标任务 ID
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} [tuiCallbacks]
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
async function run(targetIds, mode, tuiCallbacks) {
  const registry = loadTaskRegistry();
  const { ordered, errors } = resolveTaskGraph(targetIds, registry);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const ok = await executeTasks(ordered, mode, tuiCallbacks);
  return { ok, errors: [] };
}

module.exports = {
  loadTaskRegistry,
  resolveTaskGraph,
  executeTasks,
  run,
  runCmdInherit,
  ROOT_DIR,
};
