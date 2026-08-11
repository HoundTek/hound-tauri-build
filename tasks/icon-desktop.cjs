const path = require('path');
const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'icon:desktop',
  description: 'icon desktop',
  dependsOn: [],
  conflicts: ['resource:tauri-cli'],
  run: { cmd: `${GEN_CMD} desktop` },
};
