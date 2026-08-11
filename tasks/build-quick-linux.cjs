module.exports = {
  id: 'build-quick:linux',
  description: 'build-quick linux',
  dependsOn: ['linux:init'],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --runner cross --target x86_64-unknown-linux-gnu --bundles deb appimage rpm' },
};
