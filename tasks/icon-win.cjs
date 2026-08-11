const path = require('path');
const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'icon:win',
  description: 'icon win',
  dependsOn: [],
  conflicts: ['resource:tauri-cli'],
  run: { cmd: `${GEN_CMD} win` },
};
