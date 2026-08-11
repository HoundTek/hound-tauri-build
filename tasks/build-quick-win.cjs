module.exports = {
  id: 'build-quick:win',
  description: 'build-quick win',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --runner cross --bundles nsis msi' },
};
