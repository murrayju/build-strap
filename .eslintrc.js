module.exports = {
  parser: 'babel-eslint',

  plugins: ['flowtype', 'prettier', 'babel'],

  extends: [
    'airbnb-base',
    'plugin:flowtype/recommended',
    'plugin:prettier/recommended',
    'prettier',
    'prettier/flowtype',
  ],

  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2018,
  },

  env: {
    node: true,
    es6: true,
  },

  rules: {
    'comma-dangle': ['error', 'always-multiline'],
    'flowtype/delimiter-dangle': [2, 'always-multiline'],
    'linebreak-style': ['error', 'unix'],
    semi: ['error', 'always'],
    'no-underscore-dangle': 'off',
    'no-use-before-define': 'off',
    'no-nested-ternary': 'off',
    'func-names': ['error', 'never'],
    'lines-between-class-members': [
      'error',
      'always',
      { exceptAfterSingleLine: true },
    ],
    // Support for do-expressions
    'no-unused-expressions': 'off',
    'babel/no-unused-expressions': 'error',
    // Allow .js files to use JSX syntax
    // Forbid the use of extraneous packages
    // https://github.com/benmosher/eslint-plugin-import/blob/master/docs/rules/no-extraneous-dependencies.md
    'import/no-extraneous-dependencies': ['error', { packageDir: '.' }],
    'import/no-cycle': 'off',
    'import/prefer-default-export': 'off',
    // Recommend not to leave any console.log in your code
    // Use console.error, console.warn and console.info instead
    // https://eslint.org/docs/rules/no-console
    'no-console': [
      'warn',
      {
        allow: ['warn', 'error', 'info'],
      },
    ],
    'no-debugger': 'warn',
    // Prefer destructuring from arrays and objects
    // http://eslint.org/docs/rules/prefer-destructuring
    'prefer-destructuring': [
      'error',
      {
        VariableDeclarator: {
          array: true,
          object: true,
        },
        AssignmentExpression: {
          array: true,
          object: true,
        },
      },
      {
        enforceForRenamedProperties: false,
      },
    ],
  },
  overrides: [
    {
      files: ['*.test.js'],
      rules: {
        'babel/no-unused-expressions': 'off',
      },
    },
  ],
};
