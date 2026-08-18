module.exports = {
  id: 'collect:desktop',
  description: 'collect desktop artifacts',
  dependsOn: ['collect:win', 'collect:mac', 'collect:mac-universal', 'collect:linux'],
};
