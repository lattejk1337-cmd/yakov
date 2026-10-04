export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    ignores: ['dist/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', console: 'readonly',
        performance: 'readonly', requestAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', localStorage: 'readonly', matchMedia: 'readonly',
        WebSocket: 'readonly', Worker: 'readonly', self: 'readonly', URL: 'readonly', HTMLInputElement: 'readonly',
        process: 'readonly', Buffer: 'readonly',
      },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }], 'no-dupe-keys': 'error', 'no-unreachable': 'error' },
  },
];
