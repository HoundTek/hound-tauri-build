const { collectPlatform } = require('../artifacts.cjs');

module.exports = {
  id: 'collect:linux',
  description: 'collect linux artifacts',
  dependsOn: ['build:linux'],
  run: { fn: () => collectPlatform('linux') },
};
