module.exports = {
  id: 'collect:mobile',
  description: 'collect mobile artifacts',
  dependsOn: ['collect:android', 'collect:ios'],
};
