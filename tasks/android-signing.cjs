/**
 * @file android:signing 任务
 * @description 配置 Android 签名（keystore + build.gradle.kts）。
 *   向 Tauri v2 生成的 build.gradle.kts 注入签名配置（基于字符串替换）。
 * @module scripts/build/tasks/android-signing
 */

const path = require('path');
const fs = require('fs');
const { getConfig } = require('../lib/config.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '../../..');

// ── 注入块常量（Kotlin 代码片段）────────────────────

/** FileInputStream import（keystoreProperties 需要） */
const IMPORT_FIS = 'import java.io.FileInputStream';

/** keystoreProperties 变量声明（读取 keystore.properties 文件） */
const KEYSTORE_PROPS_BLOCK = `
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
`;

/** signingConfigs 块（release 签名配置） */
const SIGNING_CONFIGS_BLOCK = `signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias", "")
            keyPassword = keystoreProperties.getProperty("keyPassword", "")
            storeFile = if (keystoreProperties.getProperty("storeFile").isNullOrEmpty()) null else file(keystoreProperties.getProperty("storeFile"))
            storePassword = keystoreProperties.getProperty("storePassword", "")
        }
    }
    buildTypes {
`;

/** signingConfig 赋值（绑定到 release buildType） */
const SIGNING_CONFIG_ASSIGN = '            signingConfig = signingConfigs.getByName("release")';

// ── 注入步骤 ────────────────────────────────────────

/** 步骤 1：确保 import java.io.FileInputStream 存在 */
function ensureImport(content) {
  if (!content.includes(IMPORT_FIS)) {
    return content.replace('import java.util.Properties', `import java.util.Properties\n${IMPORT_FIS}`);
  }
  return content;
}

/** 步骤 2：注入 keystoreProperties 变量声明（在 tauriProperties 块之后、android 块之前） */
function ensureKeystoreProperties(content) {
  if (content.includes('keystoreProperties')) return content;
  const insertAt = content.indexOf('}\n\nandroid');
  if (insertAt === -1) return content;
  const pos = insertAt + 1;
  return content.slice(0, pos) + '\n' + KEYSTORE_PROPS_BLOCK + content.slice(pos);
}

/** 步骤 3：注入 signingConfigs 块（在 buildTypes 之前） */
function ensureSigningConfigs(content) {
  if (content.includes('signingConfigs')) return content;
  return content.replace('buildTypes {\n', SIGNING_CONFIGS_BLOCK);
}

/** 步骤 4：在 release buildType 中添加 signingConfig 赋值（作为块内第一行，不消耗后续行缩进） */
function ensureSigningConfigAssignment(content) {
  if (content.includes('signingConfig = signingConfigs.getByName("release")')) return content;
  return content.replace(
    /getByName\("release"\) \{\n/,
    `$&${SIGNING_CONFIG_ASSIGN}\n`
  );
}

// ── 主函数 ──────────────────────────────────────────

/**
 * 配置 Android 签名
 * @returns {boolean} 是否成功
 */
function configureAndroidSigning() {
  const config = getConfig();
  const tauriDir = config.project.tauriDir || 'src-tauri';
  const keysDir = config.project.keysDir || 'keys';
  const keystoreSrc = path.join(ROOT_DIR, keysDir, 'keystore.properties');
  const keystoreDest = path.join(ROOT_DIR, tauriDir, 'gen', 'android', 'keystore.properties');
  const buildGradlePath = path.join(ROOT_DIR, tauriDir, 'gen', 'android', 'app', 'build.gradle.kts');

  // 复制 keystore 文件
  if (fs.existsSync(keystoreSrc)) {
    fs.mkdirSync(path.dirname(keystoreDest), { recursive: true });
    fs.copyFileSync(keystoreSrc, keystoreDest);
  } else {
    console.warn(`Warning: ${keysDir}/keystore.properties not found — skipping signing (build will be unsigned)`);
    return true;
  }

  if (!fs.existsSync(buildGradlePath)) {
    console.warn(`Warning: build.gradle.kts not found at ${path.relative(ROOT_DIR, buildGradlePath)} — did android:init run successfully?`);
    return false;
  }

  let content = fs.readFileSync(buildGradlePath, 'utf-8');
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  content = content.replace(/\r\n/g, '\n');

  // 逐步注入签名配置
  content = ensureImport(content);
  content = ensureKeystoreProperties(content);
  content = ensureSigningConfigs(content);
  content = ensureSigningConfigAssignment(content);

  // 验证所有注入成功
  const REQUIRED = ['keystoreProperties', 'signingConfigs', 'signingConfig = signingConfigs'];
  for (const kw of REQUIRED) {
    if (!content.includes(kw)) {
      console.error(`Failed to inject "${kw}" into build.gradle.kts`);
      return false;
    }
  }

  if (nl === '\r\n') content = content.replace(/\n/g, '\r\n');
  fs.writeFileSync(buildGradlePath, content);
  return true;
}

module.exports = {
  id: 'android:signing',
  description: 'android sign',
  dependsOn: ['android:init'],
  // 改写 gen/android 下的 build.gradle.kts 与 keystore.properties，与 android:init / icon:android 互斥
  conflicts: [{ resource: 'resource:gen-android', mode: 'write' }],
  run: { fn: configureAndroidSigning },
};
