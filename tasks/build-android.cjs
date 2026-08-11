const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:android',
  description: 'build android',
  dependsOn: ['icon:android', 'android:signing'],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri android build' },
};
