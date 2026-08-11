const path = require('path');
const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'icon:android',
  description: 'icon android',
  dependsOn: [],
  conflicts: ['resource:tauri-cli'],
  run: { cmd: `${GEN_CMD} android` },
};
