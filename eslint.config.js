const js = require('@eslint/js');
const prettierPlugin = require('eslint-plugin-prettier');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'public/**', 'scripts/**'],
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2021,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      'prettier/prettier': [
        'warn',
        {
          singleQuote: true,
          trailingComma: 'es5',
        },
      ],
      'no-console': 'off',
    },
  },
];
