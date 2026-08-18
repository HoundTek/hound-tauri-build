const path = require('path');
const GEN_CMD = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'icon:ios',
  description: 'icon ios',
  dependsOn: ['ios:init'],
  conflicts: ['resource:tauri-cli'],
  run: { cmd: `${GEN_CMD} ios` },
};
