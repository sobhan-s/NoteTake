const TICKETED_PATTERN = /^(feat|fix|chore|docs|refactor|test)(\([^)]+\))?: .+ AB#\d+$/;
const CHORE_NO_TICKET_PATTERN = /^chore(\([^)]+\))?: .+$/;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'ab-ticket-format': (parsed) => {
          const header = parsed.header ?? '';
          if (TICKETED_PATTERN.test(header)) return [true];
          if (CHORE_NO_TICKET_PATTERN.test(header)) return [true];
          return [
            false,
            'Commit header must be "type(scope): description AB#ticket" (chore may omit "AB#ticket" only for non-ticket-tied changes, e.g. tooling upgrades)',
          ];
        },
      },
    },
  ],
  rules: {
    'header-max-length': [2, 'always', 100],
    'subject-case': [0],
    'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs', 'refactor', 'test']],
    'ab-ticket-format': [2, 'always'],
  },
};
