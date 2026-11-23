/**
 * @file test 任务
 * @description 运行宿主项目的测试套件。
 *   自适应探测：按 lockfile 识别包管理器（yarn/pnpm/bun/npm），
 *   仅当项目 package.json 声明了 scripts.test 时才执行；
 *   未声明时输出提示并视为通过（测试是宿主项目钩子，不是 htb 的内置职责）。
 * @module scripts/build/tasks/run-tests
 */

const fs = require('fs');
const path = require('path');
const { run } = require('../lib/sys/run.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '../../..');

/**
 * 按 lockfile 探测包管理器
 * @returns {{ cmd: string, args: string[], name: string }}
 */
function detectPackageManager() {
  if (fs.existsSync(path.join(ROOT_DIR, 'yarn.lock'))) {
    return { cmd: 'yarn', args: ['test'], name: 'yarn' };
  }
  if (fs.existsSync(path.join(ROOT_DIR, 'pnpm-lock.yaml'))) {
    return { cmd: 'pnpm', args: ['test'], name: 'pnpm' };
  }
  if (fs.existsSync(path.join(ROOT_DIR, 'bun.lockb')) || fs.existsSync(path.join(ROOT_DIR, 'bun.lock'))) {
    return { cmd: 'bun', args: ['test'], name: 'bun' };
  }
  return { cmd: 'npm', args: ['test'], name: 'npm' };
}

/**
 * @param {{ log?: (text: string) => void, abort?: { signaled: boolean } }} [ctx]
 * @returns {Promise<boolean>}
 */
async function runTests(ctx) {
  const log = (ctx && ctx.log) || (() => {});

  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).scripts || {};
  } catch (_) {
    log('[test] 未找到 package.json，跳过测试');
    return true;
  }
  if (!scripts.test) {
    log('[test] 项目未声明 scripts.test，跳过测试');
    return true;
  }

  const pm = detectPackageManager();
  log(`[test] ${pm.name} test`);
  const r = await run(pm.cmd, pm.args, {
    cwd: ROOT_DIR,
    onLine: log,
    abort: ctx && ctx.abort,
  });
  if (!r.ok && r.code === null) {
    log(`[test] ${pm.name} 不可用：${r.output}`);
    for (const g of r.guides) log(`[hint] ${g}`);
  }
  return r.ok;
}

module.exports = {
  id: 'test',
  description: 'test',
  dependsOn: [],
  conflicts: [{ resource: 'resource:cross-build', mode: 'write' }],
  run: { fn: runTests },
};
