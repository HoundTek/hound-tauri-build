const path = require('path');
const CP = `node "${path.join(__dirname, '..', 'gen-icons.cjs')}"`;

module.exports = {
  id: 'build:mac',
  description: 'build mac',
  dependsOn: ['icon:mac'],
  conflicts: ['resource:cross-build'],
  run: { cmd: 'tauri build --target x86_64-apple-darwin --bundles app' },
};
