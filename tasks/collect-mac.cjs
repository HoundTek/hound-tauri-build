const { collectPlatform } = require('../artifacts.cjs');

module.exports = {
  id: 'collect:mac',
  description: 'collect mac artifacts',
  dependsOn: ['build:mac'],
  run: { fn: () => collectPlatform('mac') },
};
