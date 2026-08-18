// 构建配置（htb.config.json / --set）：
//   ios.target: "device"|"sim"  —— sim 构建模拟器（tauri ios build --target aarch64-sim）
//   ios.sign:   false            —— 跳过代码签名（tauri ios build --no-sign）
const IOS_TARGET = process.env.HTB_IOS_TARGET === 'sim' ? ' --target aarch64-sim' : '';
const IOS_NO_SIGN = process.env.HTB_IOS_SIGN === 'false' ? ' --no-sign' : '';

module.exports = {
  id: 'build-quick:ios',
  description: 'build-quick ios',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: `tauri ios build${IOS_TARGET}${IOS_NO_SIGN}` },
};
