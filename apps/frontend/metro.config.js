// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro config is CommonJS
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
