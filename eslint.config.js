'use strict';

const init = require('eslint-config-metarhia');

module.exports = [
  ...init,
  {
    files: ['Application/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        indexedDB: true,
        prompt: true,
        Notification: true,
        crypto: true,
        navigator: true,
        caches: true,
        URL: true,
        self: true,
        Response: true,
        Request: true,
      },
    },
  },
  {
    files: ['CAS-Examples/**/*.js'],
    languageOptions: {
      globals: { crypto: true },
    },
  },
];
