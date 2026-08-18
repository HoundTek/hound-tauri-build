const { collectPlatform } = require('../artifacts.cjs');

module.exports = {
  id: 'collect:ios',
  description: 'collect ios artifacts',
  dependsOn: ['build:ios'],
  run: { fn: () => collectPlatform('ios') },
};
