/**
 * @file 跨平台子进程执行
 * @description 统一的 spawn 封装：参数数组形式（shell:false，无 shell 解释差异），
 *   支持行级输出回调（TUI）、stdio 继承（inline）、外部中止信号。
 *   失败时对输出做已知错误模式匹配，附加修复引导（见 GUIDES 表）。
 * @module lib/sys/run
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 在 PATH 中解析可执行文件的真实路径（Windows 按 PATHEXT 匹配）。
 * 已是路径（含分隔符）时原样返回；找不到时返回原 cmd（交由 spawn 报错）。
 * @param {string} cmd
 * @returns {string}
 */
function resolveExecutable(cmd) {
  if (/[/\\]/.test(cmd)) return cmd;
  const exts = process.platform === 'win32'
    ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')]
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      const fullLower = path.join(dir, cmd + ext.toLowerCase());
      if (fs.existsSync(full)) return full;
      if (fullLower !== full && fs.existsSync(fullLower)) return fullLower;
    }
  }
  return cmd;
}

/**
 * 已知错误模式 → 修复引导。
 * 按 process.platform 选择具体文案；通用文案放 all。
 * 匹配对象：子进程合并输出（stdout+stderr）。
 */
const ERROR_GUIDES = [
  {
    pattern: /Cannot connect to the Docker daemon|docker daemon is not running|error during connect/i,
    guide: {
      darwin: 'Docker daemon 未运行：启动 Docker Desktop（open -a Docker）',
      win32: 'Docker daemon 未运行：启动 Docker Desktop',
      linux: 'Docker daemon 未运行：sudo systemctl start docker（或 systemctl --user start docker）',
    },
  },
  {
    pattern: /frontendDist.*(doesn't exist|does not exist|not found)/i,
    guide: { all: '前端产物目录不存在：先执行前端构建（tauri.conf.json 的 beforeBuildCommand 未生效时手动跑，如 yarn build）' },
  },
  {
    pattern: /xcodebuild.*license|xcode.*license.*accept/i,
    guide: { darwin: 'Xcode license 未接受：sudo xcodebuild -license accept' },
  },
  {
    pattern: /Connection refused.*gradle|gradle.*Connection refused|Could not (download|resolve).*(gradle|maven)/i,
    guide: { all: '依赖下载失败：检查网络/代理设置（如配置了代理请确认代理已启动，或移除失效代理）' },
  },
];

/**
 * 清洗子进程输出行，防止控制字符/光标序列破坏 TUI 画面。
 * - \r：进度行覆盖语义，保留最后一个非空段
 * - C0 控制字符（\x1b 除外）：剥除
 * - 转义序列：仅保留 SGR（\x1b[...m）与 OSC 8 超链接，其余（光标移动、清屏、OSC 剪贴板等）剥除
 * @param {string} line
 * @returns {string}
 */
function sanitizeLogLine(line) {
  let l = line;
  if (l.includes('\r')) {
    const segs = l.split('\r');
    l = segs[segs.length - 1] || segs[segs.length - 2] || '';
  }
  // 先处理 OSC（此时 \x07 终止符还在）：剥除非 OSC 8 的 OSC（剪贴板/标题等）
  l = l.replace(/\x1b\](?!8;;)[^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '');
  // 剥除 C0 控制字符（保留 \x1b 与 \x07——\x07 是 OSC 8 终止符，落单仅响铃无害）
  l = l.replace(/[\x00-\x06\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g, '');
  // 剥除非 SGR 的 CSI（光标移动、清屏等）
  l = l.replace(/\x1b\[(?![0-9;]*m)[0-9;?]*[ -/]*[@-~]/g, '');
  // 剥除其他 ESC 序列（保留 OSC 8 的 ST 终止符 \x1b\\）
  l = l.replace(/\x1b[^[\]\\]/g, '');
  return l;
}

/**
 * 对输出匹配已知错误模式，返回引导文案数组（可能为空）。
 * @param {string} output
 * @returns {string[]}
 */
function matchGuides(output) {
  const out = [];
  for (const { pattern, guide } of ERROR_GUIDES) {
    if (pattern.test(output)) {
      out.push(guide[process.platform] || guide.all);
    }
  }
  return out.filter(Boolean);
}

/**
 * 以参数数组形式执行外部命令（不经 shell）。
 * @param {string} cmd - 可执行文件（node 脚本请传 process.execPath）
 * @param {string[]} args - 参数数组（元素不做任何 shell 转义/展开）
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {object} [opts.env] - 完整环境（缺省继承 process.env）
 * @param {(line: string) => void} [opts.onLine] - 行级输出回调（stdout/stderr 合并，按行）；缺省且非 inherit 时静默
 * @param {boolean} [opts.inherit] - 直接继承父进程 stdio（inline 模式长输出）
 * @param {{ signaled: boolean }} [opts.abort] - 外部中止信号（轮询检测后 kill）
 * @returns {Promise<{ ok: boolean, code: number|null, output: string, guides: string[] }>}
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const resolved = resolveExecutable(cmd);
    // Windows 的 .cmd/.bat 不能直接 exec（CVE-2024-27980 后 Node 强制拒绝），
    // 仅对这类 shim 打开 shell；其余一律 shell:false 避免解释差异
    const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
    const child = spawn(resolved, args, {
      cwd: opts.cwd,
      shell: needsShell,
      stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: opts.env || process.env,
    });

    // 监听 abort：轮询检测，信号到位立即杀子进程
    let abortTimer = null;
    if (opts.abort) {
      abortTimer = setInterval(() => {
        if (opts.abort.signaled) {
          clearInterval(abortTimer);
          try { child.kill(); } catch (_) {}
        }
      }, 50);
    }

    let output = '';
    if (!opts.inherit) {
      let buf = '';
      const onData = (text) => {
        output += text;
        if (!opts.onLine) return;
        buf += text;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) {
          const clean = sanitizeLogLine(l);
          if (clean.trim()) opts.onLine(clean);
        }
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('close', () => {
        if (opts.onLine && buf.trim()) opts.onLine(sanitizeLogLine(buf).trimEnd());
      });
    }

    child.on('close', (code) => {
      if (abortTimer) clearInterval(abortTimer);
      const guides = code === 0 ? [] : matchGuides(output);
      resolve({ ok: code === 0, code, output, guides });
    });
    child.on('error', (err) => {
      if (abortTimer) clearInterval(abortTimer);
      resolve({
        ok: false,
        code: null,
        output: String(err),
        guides: [`命令无法启动：${cmd}（不存在或不可执行）`],
      });
    });
  });
}

module.exports = { run, matchGuides, ERROR_GUIDES, resolveExecutable, sanitizeLogLine };
