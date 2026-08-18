#!/usr/bin/env node
/**
 * @file hound-tauri-sim-install
 * @description 将 htb build ios --sim 构建出的模拟器 App 自动安装到指定的模拟器。
 *              用法：
 *                node bin/hound-tauri-sim-install.js [--project <dir>] [--launch] [--device <name|udid>]
 *                node bin/hound-tauri-sim-install.js --list
 * @module hound-tauri-build/bin/hound-tauri-sim-install
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const USAGE = '用法: node bin/hound-tauri-sim-install.js [--project <dir>] [--launch] [--device <name|udid>] | --list';

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
let projectRoot = null;
let launch = false;
let device = null;
let list = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--project') projectRoot = args[++i];
  else if (a === '--launch') launch = true;
  else if (a === '--device') device = args[++i];
  else if (a === '--list') list = true;
  else { console.error(`未知参数: ${a}\n${USAGE}`); process.exit(2); }
}

// ---------- 工具 ----------
// 返回 stdout 字符串；失败返回 null
function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`  ✗ ${cmd} ${cmdArgs.join(' ')} 失败:\n${(r.stderr || r.stdout || '').trim()}`);
    return null;
  }
  return r.stdout.trim();
}

// 列出全部模拟器（含未启动）
function listAllDevices() {
  const out = run('xcrun', ['simctl', 'list', 'devices', '-j']);
  if (!out) return null;
  return Object.values(JSON.parse(out).devices).flat();
}

// 按 UDID 或名称匹配：优先精确（不区分大小写），无精确结果才用模糊
function matchDevice(all, q) {
  const ql = q.toLowerCase();
  const exact = all.filter((d) => d.udid.toLowerCase() === ql || d.name.toLowerCase() === ql);
  if (exact.length > 0) return exact;
  return all.filter((d) => d.udid.toLowerCase().startsWith(ql) || d.name.toLowerCase().includes(ql));
}

// ---------- --list：列出全部模拟器 ----------
if (list) {
  const all = listAllDevices();
  if (!all) process.exit(1);
  for (const d of all) {
    console.log(`  ${d.state === 'Booted' ? '●' : '○'} ${d.name}  ${d.udid}  ${d.state}`);
  }
  process.exit(0);
}

// ---------- 1. 定位项目根 ----------
projectRoot = projectRoot || process.env.HOUND_BUILD_ROOT || process.cwd();
const tauriConfPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
if (!fs.existsSync(tauriConfPath)) {
  console.error(`✗ 未找到 ${tauriConfPath}\n  请用 --project 指定 Tauri 项目根目录。`);
  process.exit(1);
}
const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
const productName = conf.productName;
const bundleId = (conf.bundle && conf.bundle.identifier) || conf.identifier;
if (!productName || !bundleId) {
  console.error('✗ tauri.conf.json 缺少 productName 或 bundle.identifier');
  process.exit(1);
}

// ---------- 2. 定位构建产物 ----------
const appPath = path.join(projectRoot, 'src-tauri', 'gen', 'apple', 'build', 'arm64-sim', `${productName}.app`);
if (!fs.existsSync(appPath)) {
  console.error(`✗ 未找到构建产物: ${appPath}\n  请先执行: htb build ios --sim`);
  process.exit(1);
}

// ---------- 3. 确定目标模拟器 ----------
const allDevices = listAllDevices();
if (!allDevices) process.exit(1);

let target = null;
if (device) {
  // --device：按名称或 UDID 匹配
  const matches = matchDevice(allDevices, device);
  if (matches.length === 0) {
    console.error(`✗ 没有匹配 "${device}" 的模拟器，可用设备：`);
    for (const d of allDevices) console.error(`    ${d.name}  ${d.udid}  ${d.state}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`✗ "${device}" 匹配到多个模拟器，请用 UDID 精确定位：`);
    for (const d of matches) console.error(`    ${d.name}  ${d.udid}`);
    process.exit(1);
  }
  target = matches[0];
} else {
  // 未指定：自动找当前 Booted 的唯一设备
  const booted = allDevices.filter((d) => d.state === 'Booted');
  if (booted.length === 0) {
    console.error('✗ 没有正在运行的模拟器。请先启动（如 open -a Simulator），或用 --device 指定一个：');
    for (const d of allDevices.filter((d) => d.state !== 'Booted')) console.error(`    ${d.name}  ${d.udid}`);
    process.exit(1);
  }
  if (booted.length > 1) {
    console.error(`✗ 有 ${booted.length} 个模拟器在运行，请用 --device 指定其中一个：`);
    for (const d of booted) console.error(`    ${d.name}  ${d.udid}  (Booted)`);
    process.exit(1);
  }
  target = booted[0];
}

const deviceUdid = target.udid;
console.log(`  使用模拟器: ${target.name} (${deviceUdid})`);

// ---------- 4. 安装 ----------
console.log(`  安装 ${productName}.app → ${target.name} ...`);
if (run('xcrun', ['simctl', 'install', deviceUdid, appPath]) === null) process.exit(1);
console.log('  ✓ 安装成功');

// ---------- 5. 可选启动 ----------
if (launch) {
  console.log(`  启动 ${bundleId} ...`);
  const out = run('xcrun', ['simctl', 'launch', deviceUdid, bundleId]);
  if (out === null) process.exit(1);
  console.log(`  ✓ 已启动 (PID ${out})`);
}
