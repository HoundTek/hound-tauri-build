const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { getConfig } = require('./config.cjs')

const scriptDir = __dirname
const rootDir = process.env.HOUND_BUILD_ROOT || path.resolve(scriptDir, '../..')
// 图标配置来自统一配置（config/htb.default.json → 项目 htb.config.json → --set 覆盖）
const config = getConfig().icons

function findSource(candidates) {
  for (const name of candidates) {
    const p = path.join(rootDir, 'icons', name)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** 阶段1：生成到临时目录（无平台间冲突，可并行） */
function generatePhase(platform) {
  const cfg = config.platforms[platform]

  const source = findSource(cfg.source)
  if (!source) {
    console.error('Error: No source icon found. Tried:', cfg.source.join(', '))
    return false
  }

  console.log('Source:', path.relative(rootDir, source))

  // 按源文件名命名临时目录: icons/temp/icon-mac, icons/temp/icon-win ...
  const srcName = path.basename(source, path.extname(source))
  const tempDir = path.join(rootDir, config.tempDir, srcName)

  // Quick: 如果缓存有效则跳过 tauri icon 生成
  const cacheFile = path.join(tempDir, '.icon-cache.json')
  const srcMtime = fs.statSync(source).mtimeMs
  if (fs.existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      if (cache.source === source && cache.mtime === srcMtime) {
        console.log('  (cached, skip generate)')
        return true
      }
    } catch (_) { /* cache invalid, regenerate */ }
  }

  fs.rmSync(tempDir, { recursive: true, force: true })
  fs.mkdirSync(tempDir, { recursive: true })

  const cmd = `yarn tauri icon "${source}" --output "${tempDir}"`
  console.log('$', cmd)
  try {
    const out = execSync(cmd, { cwd: rootDir, encoding: 'utf8' })
    if (out.trim()) console.log(out.trimEnd())
  } catch (e) {
    if (e.stdout && e.stdout.trim()) console.log(e.stdout.trimEnd())
    if (e.stderr && e.stderr.trim()) console.log(e.stderr.trimEnd())
    fs.rmSync(tempDir, { recursive: true, force: true })
    return false
  }

  console.log('  Generated to:', path.relative(rootDir, tempDir))

  // 写入缓存标记
  fs.writeFileSync(cacheFile, JSON.stringify({ source, mtime: srcMtime }))

  return true
}

/** 从 temp 拷贝图标到目标目录 */
function copyEntries(tempDir, destDir, platform, clean) {
  // 清理
  if (clean === 'full') {
    fs.rmSync(destDir, { recursive: true, force: true })
    fs.mkdirSync(destDir, { recursive: true })
  } else if (clean === 'mobile') {
    if (fs.existsSync(destDir)) {
      const existing = fs.readdirSync(destDir, { withFileTypes: true })
      for (const e of existing) {
        const full = path.join(destDir, e.name)
        if (platform === 'android' && e.name.startsWith('mipmap-')) {
          fs.rmSync(full, { recursive: true, force: true })
        } else if (platform === 'ios' && e.name !== 'Contents.json') {
          // iOS appiconset 只保留 Contents.json：清理 AppIcon-*.png 及误拷的顶层桌面文件
          fs.rmSync(full, { recursive: true, force: true })
        }
      }
    }
    fs.mkdirSync(destDir, { recursive: true })
  } else {
    // clean === 'none': 仅覆盖，不清理
    fs.mkdirSync(destDir, { recursive: true })
  }

  const entries = fs.readdirSync(tempDir, { withFileTypes: true })
  for (const entry of entries) {
    // 过滤跨平台文件
    if (platform === 'android' && entry.name === 'ios') continue
    if (platform === 'ios' && entry.name.startsWith('mipmap-')) continue
    // iOS 图标全部位于 temp 的 ios/ 子目录，仅拷贝该子目录内容（appiconset 不接收顶层桌面图标）
    if (platform === 'ios' && entry.name !== 'ios') continue
    // 拷贝到 icons/ 时排除移动端专属文件
    if (platform === 'icons-only' && (entry.name.startsWith('mipmap-') || entry.name === 'ios' || entry.name === 'android' || /^AppIcon-.*\.png$/.test(entry.name))) continue
    const src = path.join(tempDir, entry.name)
    // 解包：tauri icon 把移动端图标放在 android/ 或 ios/ 子目录中，直接拷内容
    if ((platform === 'android' && entry.name === 'android') || (platform === 'ios' && entry.name === 'ios')) {
      if (entry.isDirectory()) {
        fs.cpSync(src, destDir, { recursive: true, force: true })
      }
      continue
    }
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true, force: true })
    } else {
      fs.copyFileSync(src, dest)
    }
  }
}

/** 阶段2：从临时目录拷贝图标 */
function copyPhase(platform) {
  const cfg = config.platforms[platform]

  const source = findSource(cfg.source)
  const srcName = source ? path.basename(source, path.extname(source)) : platform
  const tempDir = path.join(rootDir, config.tempDir, srcName)

  if (!fs.existsSync(tempDir)) {
    console.error('Error: Temp directory not found:', path.relative(rootDir, tempDir))
    return false
  }

  // 1) 平台专属输出
  const outputDir = path.join(rootDir, cfg.output)
  console.log('Output:', path.relative(rootDir, outputDir))
  const clean = (platform === 'android' || platform === 'ios') ? 'mobile' : 'full'
  copyEntries(tempDir, outputDir, platform, clean)

  if (source) {
    fs.writeFileSync(path.join(outputDir, '.icon-source'), JSON.stringify({
      platform,
      source: path.basename(source),
      timestamp: new Date().toISOString(),
    }, null, 2))
  }

  // 2) 移动端额外输出到 src-tauri/icons/（cross proc macro 编译需要）
  if (platform === 'android' || platform === 'ios') {
    const iconsDir = path.join(rootDir, 'src-tauri/icons')
    console.log('Also to:', path.relative(rootDir, iconsDir))
    copyEntries(tempDir, iconsDir, 'icons-only', 'none')
  }

  return true
}

function generateIcon(platform, phase) {
  console.log(`=== ${platform}${phase ? ' (' + phase + ')' : ''} ===`)
  if (phase === 'generate') return generatePhase(platform)
  if (phase === 'copy') return copyPhase(platform)
  if (!generatePhase(platform)) return false
  return copyPhase(platform)
}

function main() {
  const args = process.argv.slice(2)

  let phase = null
  const targets = []
  for (const arg of args) {
    if (arg.startsWith('--phase=')) { phase = arg.split('=')[1] }
    else if (!arg.startsWith('--')) targets.push(arg)
  }

  if (targets.length === 0) targets.push('desktop')
  if (targets.includes('all')) { targets.length = 0; targets.push(...Object.keys(config.platforms)) }

  let failed = false
  for (const target of targets) {
    if (!config.platforms[target]) { console.error('Unknown platform:', target); process.exit(1) }
    if (!generateIcon(target, phase)) failed = true
  }
  process.exit(failed ? 1 : 0)
}

main()
