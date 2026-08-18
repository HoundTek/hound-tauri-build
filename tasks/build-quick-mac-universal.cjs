module.exports = {
  id: 'build-quick:mac-universal',
  description: 'build-quick mac-universal',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --target universal-apple-darwin --bundles app' },
};
