import antfu from '@antfu/eslint-config';

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
  },
  react: true,
});
