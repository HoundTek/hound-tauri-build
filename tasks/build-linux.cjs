const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:linux',
  description: 'build linux',
  dependsOn: ['icon:linux', 'linux:init'],
  conflicts: ['resource:cross-build'],
  run: { cmd: "rm -rf src-tauri/.htb-frontend-dist && cp -r src src-tauri/.htb-frontend-dist && tauri build --runner cross --target x86_64-unknown-linux-gnu --config '{\"build\":{\"frontendDist\":\"./.htb-frontend-dist\"}}'; code=$?; rm -rf src-tauri/.htb-frontend-dist; exit $code" },
};
