const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const monorepoRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
module.exports = config;
