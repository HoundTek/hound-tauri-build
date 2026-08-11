const path = require('path');
const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'icon:mac',
  description: 'icon mac',
  dependsOn: [],
  conflicts: ['resource:tauri-cli'],
  run: { cmd: `${GEN_CMD} mac` },
};
