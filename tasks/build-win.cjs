const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:win',
  description: 'build win',
  dependsOn: ['icon:win'],
  conflicts: ['resource:cross-build'],
  run: { cmd: "rm -rf src-tauri/.htb-frontend-dist && cp -r src src-tauri/.htb-frontend-dist && tauri build --runner cross --target x86_64-pc-windows-gnu --bundles nsis msi --config '{\"build\":{\"frontendDist\":\"./.htb-frontend-dist\"}}'; code=$?; rm -rf src-tauri/.htb-frontend-dist; exit $code" },
};
