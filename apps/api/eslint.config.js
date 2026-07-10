import baseConfig from '@config/core/eslint.config.js';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ['src/controllers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repositories/*', '**/repositories'],
              message: 'Controllers must not import repositories directly — go through services/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/routers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/*', '**/services', '**/repositories/*', '**/repositories'],
              message: 'Routers must not import services/repositories directly — go through controllers/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/repositories/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/controllers/*', '**/controllers', '**/routers/*', '**/routers'],
              message: 'Repositories must not import controllers/routers.',
            },
          ],
        },
      ],
    },
  },
];
