module.exports = {
  id: 'build-quick:mac',
  description: 'build-quick mac',
  dependsOn: [],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --runner cross --bundles dmg app' },
};
