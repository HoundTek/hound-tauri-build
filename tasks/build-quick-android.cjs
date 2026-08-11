module.exports = {
  id: 'build-quick:android',
  description: 'build-quick android',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri android build' },
};
