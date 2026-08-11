const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:mac-universal',
  description: 'build mac uni',
  dependsOn: ['icon:mac'],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --runner cross --target universal-apple-darwin' },
};
