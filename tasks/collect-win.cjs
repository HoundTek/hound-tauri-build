const { collectPlatform } = require('../artifacts.cjs');

module.exports = {
  id: 'collect:win',
  description: 'collect win artifacts',
  dependsOn: ['build:win'],
  run: { fn: () => collectPlatform('win') },
};
