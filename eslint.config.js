import config from './packages/config/eslint.config.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...config,
  {
    ignores: ['node_modules/**', 'dist/**', '.turbo/**', 'coverage/**', 'pnpm-lock.yaml'],
  },
];
