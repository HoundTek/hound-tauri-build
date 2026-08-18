const { collectPlatform } = require('../artifacts.cjs');

module.exports = {
  id: 'collect:mac-universal',
  description: 'collect mac-universal artifacts',
  dependsOn: ['build:mac-universal'],
  run: { fn: () => collectPlatform('mac-universal') },
};
