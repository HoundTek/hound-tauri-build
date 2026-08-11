module.exports = {
  id: 'build-quick:mac-universal',
  description: 'build-quick mac-universal',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --runner cross --target universal-apple-darwin' },
};
