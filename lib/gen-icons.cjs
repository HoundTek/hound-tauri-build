const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { getConfig } = require('./config.cjs')
const { resolveTauriCli } = require('./tauri-cli.cjs')

const scriptDir = __dirname
const rootDir = process.env.HOUND_BUILD_ROOT || path.resolve(scriptDir, '../..')
// 图标配置来自统一配置（config/htb.default.json → 项目 htb.config.json → --set 覆盖）
const config = getConfig().icons

function findSource(candidates) {
  for (const name of candidates) {
    // 支持：绝对路径、相对项目根的路径（含 /）、图标目录内的文件名（旧行为）
    const p = path.isAbsolute(name) || name.includes('/') || name.includes('\\')
      ? path.resolve(rootDir, name)
      : path.join(rootDir, 'icons', name)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** 目录内最大 mtime（递归，供目录源的缓存判定） */
function dirMtime(dir) {
  let max = fs.statSync(dir).mtimeMs
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    max = Math.max(max, e.isDirectory() ? dirMtime(full) : fs.statSync(full).mtimeMs)
  }
  return max
}

/**
 * Icon Composer .icon → 展平 1024×1024 PNG（经 templates/icon-flatten.swift）。
 * 需要 macOS + Xcode CLT（swift 解释器）。
 */
function flattenIconComposer(iconDir, outPng) {
  const swift = path.join(__dirname, '..', 'templates', 'icon-flatten.swift')
  const r = spawnSync('swift', [swift, path.join(iconDir, 'icon.json'), outPng, '1024'], { encoding: 'utf8' })
  if (r.status !== 0) {
    if (r.stderr && r.stderr.trim()) console.error(r.stderr.trimEnd())
    if (r.error) console.error(String(r.error))
    console.error('[hint] .icon 展平需要 macOS 的 swift（安装 Xcode 命令行工具：xcode-select --install）')
    return false
  }
  return true
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

  // 临时目录按 源名+平台 命名（避免不同平台同名源在并行构建时互相覆盖）
  const srcName = path.basename(source, path.extname(source))
  const tempDir = path.join(rootDir, config.tempDir, `${srcName}-${platform}`)

  // Quick: 如果缓存有效则跳过生成（目录源取目录内最大 mtime）
  const srcStat = fs.statSync(source)
  const srcMtime = srcStat.isDirectory() ? dirMtime(source) : srcStat.mtimeMs
  const cacheFile = path.join(tempDir, '.icon-cache.json')
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

  let iconInput = source

  // 目录源：android 预构建 res（直接收 mipmap-*，不经 tauri icon）
  if (srcStat.isDirectory() && platform === 'android') {
    const mipmaps = fs.readdirSync(source, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('mipmap-'))
    if (mipmaps.length === 0) {
      console.error('Error: 预构建 res 目录中没有 mipmap-* 目录:', source)
      return false
    }
    const androidOut = path.join(tempDir, 'android')
    fs.mkdirSync(androidOut, { recursive: true })
    for (const e of mipmaps) {
      fs.cpSync(path.join(source, e.name), path.join(androidOut, e.name), { recursive: true })
    }
    console.log(`  Prebuilt res: ${mipmaps.length} mipmap dir(s)`)
    fs.writeFileSync(cacheFile, JSON.stringify({ source, mtime: srcMtime }))
    return true
  }

  // 目录源：Icon Composer .icon → 展平 PNG 后走 tauri icon
  if (srcStat.isDirectory()) {
    if (!source.endsWith('.icon')) {
      console.error('Error: 目录源仅支持 android 预构建 res 目录或 .icon（Icon Composer）:', source)
      return false
    }
    const flat = path.join(tempDir, 'flattened.png')
    console.log('  Flattening .icon (Icon Composer) ...')
    if (!flattenIconComposer(source, flat)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      return false
    }
    iconInput = flat
  }

  // 直接调用 Tauri CLI（lib/tauri-cli.cjs 解析入口），不经 yarn/npm、不经 .bin shim
  const cli = resolveTauriCli()
  const cliArgs = [...cli.baseArgs, 'icon', iconInput, '--output', tempDir]
  console.log('$', cli.source === 'local' ? 'tauri' : cli.cmd, 'icon', path.relative(rootDir, iconInput), '--output', tempDir)
  const r = spawnSync(cli.cmd, cliArgs, { cwd: rootDir, encoding: 'utf8' })
  if (r.status === 0) {
    if (r.stdout && r.stdout.trim()) console.log(r.stdout.trimEnd())
  } else {
    if (r.stdout && r.stdout.trim()) console.log(r.stdout.trimEnd())
    if (r.stderr && r.stderr.trim()) console.log(r.stderr.trimEnd())
    if (r.error) console.log(String(r.error))
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
    // 中间产物（缓存标记 / .icon 展平临时图）不进任何输出目录
    if (entry.name === '.icon-cache.json' || entry.name === 'flattened.png') continue
    // 移动端专属内容不进桌面输出目录（src-tauri/icons）
    if (platform !== 'android' && platform !== 'ios' &&
        (entry.name === 'android' || entry.name === 'ios' || entry.name.startsWith('mipmap-') || /^AppIcon-.*\.png$/.test(entry.name))) continue
    // 过滤跨平台文件
    // Android res/ 只接收 android/ 子目录内容，顶层桌面图标（32x32.png、icon.ico、.icon-cache.json 等）不得进入 res/
    if (platform === 'android' && entry.name !== 'android') continue
    if (platform === 'ios' && entry.name.startsWith('mipmap-')) continue
    // iOS 图标全部位于 temp 的 ios/ 子目录，仅拷贝该子目录内容（appiconset 不接收顶层桌面图标）
    if (platform === 'ios' && entry.name !== 'ios') continue
    // 拷贝到 icons/ 时排除移动端专属文件和缓存等隐藏文件
    if (platform === 'icons-only' && (entry.name.startsWith('.') || entry.name.startsWith('mipmap-') || entry.name === 'ios' || entry.name === 'android' || /^AppIcon-.*\.png$/.test(entry.name))) continue
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

/**
 * 安卓专用：图标拷贝后同步 AndroidManifest.xml 的图标引用。
 * 从输出 res 的 mipmap-anydpi-v26 推导图标名（非 _round 的 xml 为主图标），
 * 替换 manifest 的 android:icon / android:roundIcon（roundIcon 缺失时补上）。
 */
function patchAndroidManifest(resDir) {
  const tauriDir = getConfig().project.tauriDir || 'src-tauri'
  const manifestPath = path.join(rootDir, tauriDir, 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
  if (!fs.existsSync(manifestPath)) return
  const anydpi = path.join(resDir, 'mipmap-anydpi-v26')
  if (!fs.existsSync(anydpi)) return
  const base = fs.readdirSync(anydpi)
    .filter((f) => f.endsWith('.xml') && !f.includes('_round'))
    .map((f) => path.basename(f, '.xml'))[0]
  if (!base) return
  const round = fs.existsSync(path.join(anydpi, `${base}_round.xml`)) ? `${base}_round` : null

  const content = fs.readFileSync(manifestPath, 'utf8')
  let next = content.replace(/android:icon="@mipmap\/[^"]*"/, `android:icon="@mipmap/${base}"`)
  if (round) {
    next = /android:roundIcon="@mipmap\/[^"]*"/.test(next)
      ? next.replace(/android:roundIcon="@mipmap\/[^"]*"/, `android:roundIcon="@mipmap/${round}"`)
      : next.replace(`android:icon="@mipmap/${base}"`, `android:icon="@mipmap/${base}"\n        android:roundIcon="@mipmap/${round}"`)
  }
  if (next !== content) {
    fs.writeFileSync(manifestPath, next)
    console.log(`  AndroidManifest: icon → @mipmap/${base}`)
  }
}

/** 阶段2：从临时目录拷贝图标 */
function copyPhase(platform) {
  const cfg = config.platforms[platform]

  const source = findSource(cfg.source)
  const srcName = source ? path.basename(source, path.extname(source)) : platform
  const tempDir = path.join(rootDir, config.tempDir, `${srcName}-${platform}`)

  if (!fs.existsSync(tempDir)) {
    console.error('Error: Temp directory not found:', path.relative(rootDir, tempDir))
    return false
  }

  // 1) 平台专属输出
  const outputDir = path.join(rootDir, cfg.output)
  console.log('Output:', path.relative(rootDir, outputDir))
  const clean = (platform === 'android' || platform === 'ios') ? 'mobile' : 'full'
  copyEntries(tempDir, outputDir, platform, clean)
  if (platform === 'android') patchAndroidManifest(outputDir)

  if (source) {
    fs.writeFileSync(path.join(outputDir, '.icon-source'), JSON.stringify({
      platform,
      source: path.basename(source),
      timestamp: new Date().toISOString(),
    }, null, 2))
  }

  // 2) 移动端额外输出到 tauriDir/icons/（cross proc macro 编译需要）
  if (platform === 'android' || platform === 'ios') {
    const tauriDir = getConfig().project.tauriDir || 'src-tauri';
    const iconsDir = path.join(rootDir, tauriDir, 'icons')
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
