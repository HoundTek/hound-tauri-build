const { collectPlatform } = require('../artifacts.cjs');

module.exports = {
  id: 'collect:android',
  description: 'collect android artifacts',
  dependsOn: ['build:android'],
  run: { fn: () => collectPlatform('android') },
};
