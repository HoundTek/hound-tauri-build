/**
 * @file config.cjs
 * @description 统一配置加载器。
 *              配置合并优先级（低→高）：
 *                1. 内建默认   config/htb.default.json（htb 仓库内）
 *                2. 项目配置   <HOUND_BUILD_ROOT>/htb.config.json
 *                3. 命令行     --set <path>=<value>（经 loadConfig(setOverrides) 传入）
 *              加载后扁平化为 HTB_<PATH> 环境变量，供依赖 env 的模块读取。
 * @module hound-tauri-build/config
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '..', '..');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config', 'htb.default.json');

let CONFIG = null;

/** 递归深合并：source 覆盖 target（对象递归合并，其他值直接替换） */
function deepMerge(target, source) {
  const out = Array.isArray(target) ? target.slice() : Object.assign({}, target);
  for (const [k, v] of Object.entries(source || {})) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && out[k] !== null && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** 按点路径写入对象：setPath({}, 'ios.target', 'sim') → { ios: { target: 'sim' } } */
function setPath(obj, pathStr, value) {
  const parts = pathStr.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** 递归扁平化：{ ios: { target: 'sim' } } → { 'ios_target': 'sim' } */
function flattenConfig(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flattenConfig(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

/** 读取 JSON 文件（不存在或解析失败返回 {}） */
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return {};
  }
}

/** 字符串 → 类型转换：'true'/'false' → 布尔；数字字符串 → number；其余原样 */
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

/**
 * 从继承的 HTB_* 环境变量恢复配置覆盖（子进程场景）。
 * 主进程 loadConfig(overrides) 会把合并结果写入 env，子进程（如 gen-icons）继承后据此还原 --set。
 */
function applyEnvOverrides(config) {
  const flat = flattenConfig(config);
  for (const [k] of Object.entries(flat)) {
    const envKey = `HTB_${k.toUpperCase()}`;
    if (process.env[envKey] !== undefined) {
      setPath(config, k, coerce(process.env[envKey]));
    }
  }
  return config;
}

/**
 * 加载并合并配置；可通过 --set 覆盖（同 key 重复时后者覆盖前者）。
 * @param {Record<string,string>} setOverrides --set <path>=<value> 集合
 * @returns {object} 合并后的完整配置
 */
function loadConfig(setOverrides = {}) {
  const defaults = readJson(DEFAULT_CONFIG_PATH);
  const project = readJson(path.join(ROOT_DIR, 'htb.config.json'));
  let config = deepMerge(defaults, project);
  applyEnvOverrides(config); // 子进程：恢复继承的 --set 覆盖
  for (const [k, v] of Object.entries(setOverrides)) setPath(config, k, v);
  CONFIG = config;

  // 扁平化为 HTB_* 环境变量（供子进程继承 / 兼容依赖 env 的既有读取方）
  for (const [k, v] of Object.entries(flattenConfig(config))) {
    process.env[`HTB_${k.toUpperCase()}`] = String(v);
  }
  return config;
}

/** 获取已加载配置（未加载则先加载） */
function getConfig() {
  return CONFIG || loadConfig();
}

/** 获取任务命令覆盖：config.tasks.<id>.cmd，未配置返回 fallback */
function getTaskCmd(id, fallback) {
  const over = getConfig().tasks && getConfig().tasks[id];
  return (over && over.cmd) || fallback;
}

module.exports = {
  ROOT_DIR,
  deepMerge,
  setPath,
  flattenConfig,
  loadConfig,
  getConfig,
  getTaskCmd,
};
