const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:ios',
  description: 'build ios',
  dependsOn: ['icon:ios', 'ios:init'],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri ios build' },
};
