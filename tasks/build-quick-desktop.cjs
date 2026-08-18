module.exports = {
  id: 'build-quick:desktop',
  description: 'build-quick desktop',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build' },
};
