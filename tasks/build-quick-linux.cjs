module.exports = {
  id: 'build-quick:linux',
  description: 'build-quick linux',
  dependsOn: ['linux:init'],
  conflicts: ['resource:cross-build'],
  run: { cmd: "rm -rf src-tauri/.htb-frontend-dist && cp -r src src-tauri/.htb-frontend-dist && tauri build --runner cross --target x86_64-unknown-linux-gnu --bundles deb appimage rpm --config '{\"build\":{\"frontendDist\":\"./.htb-frontend-dist\"}}'; code=$?; rm -rf src-tauri/.htb-frontend-dist; exit $code" },
};
