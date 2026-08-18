module.exports = {
  id: 'build-quick:mac',
  description: 'build-quick mac',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --bundles app' },
};
