module.exports = {
  id: 'collect:all',
  description: 'collect all artifacts',
  dependsOn: ['collect:desktop', 'collect:mobile'],
};
