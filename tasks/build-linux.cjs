const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:linux',
  description: 'build linux',
  dependsOn: ['icon:linux', 'linux:init'],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --runner cross --target x86_64-unknown-linux-gnu' },
};
