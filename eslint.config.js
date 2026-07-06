import antfu from '@antfu/eslint-config';
import pluginQuery from '@tanstack/eslint-plugin-query';

export default antfu({
  stylistic: {
    semi: true,
    quotes: 'single',
  },
  gitignore: true,
  ignores: [
    'public/',
    '.husky',
    '*.md',
    '.github/*',
  ],
  rules: {
    'n/prefer-global/process': 'off',
    'react-refresh/only-export-components': 'off',
  },
  react: true,

  ...pluginQuery.configs['flat/recommended'],
});
