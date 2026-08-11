const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:win',
  description: 'build win',
  dependsOn: ['icon:win'],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --runner cross' },
};
