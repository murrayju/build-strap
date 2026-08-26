import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
// eslint-disable-next-line import-x/no-named-as-default
import importX from 'eslint-plugin-import-x';
import n from 'eslint-plugin-n';
import perfectionist from 'eslint-plugin-perfectionist';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // replaces the old .eslintignore file, which eslint 10 no longer reads
    ignores: ['build/', 'dist/', 'download/', 'node_modules/'],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    // must cover every extension typescript-eslint's configs match
    // (**/*.mts and **/*.cts included), otherwise those files are discovered
    // and partially linted but skip this block entirely -- including the
    // runtime-critical import-x/extensions check
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.mts',
      '**/*.cts',
      '**/*.js',
      '**/*.jsx',
      '**/*.mjs',
      '**/*.cjs',
    ],
    languageOptions: {
      globals: {
        ...globals.es2021,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      'import-x': importX,
      n,
      perfectionist,
      prettier: prettierPlugin,
    },
    rules: {
      '@typescript-eslint/array-type': 'error',
      // this codebase intentionally infers return types
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-empty-function': 'warn',
      // `strict` bans non-null assertions, but several caching helpers rely on
      // a `has()` check immediately before `get()!`
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      // NOTE: airbnb's `no-return-await` is not carried forward. The core rule
      // is deprecated, and its replacement (@typescript-eslint/return-await)
      // requires type-aware linting, which this project does not enable.
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unused-vars': 'error',

      // --- carried forward from eslint-config-airbnb-base ---
      // airbnb-base was dropped (last published 2021, peers cap at eslint ^8,
      // eslintrc-only). These are the rules it contributed that @eslint/js
      // recommended and typescript-eslint do not already cover, minus the
      // purely stylistic ones that prettier owns.
      'array-callback-return': ['error', { allowImplicit: true }],
      'block-scoped-var': 'error',
      camelcase: ['error', { ignoreDestructuring: false, properties: 'never' }],
      'default-case': ['error', { commentPattern: '^no default$' }],
      'default-case-last': 'error',
      'default-param-last': 'error',
      'dot-notation': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'func-names': 'warn',

      'grouped-accessor-pairs': 'error',

      'guard-for-in': 'error',
      // correctness rules that eslint-plugin-import's `recommended` provided
      // via airbnb; they are not on by default in a bare import-x setup
      'import-x/export': 'error',
      // --- import hygiene (eslint-plugin-import-x: maintained fork of
      // eslint-plugin-import, whose `order` rule hard-crashes on eslint 10) ---
      // This package emits native ESM, where relative imports must carry the
      // .js extension that node resolves at runtime. This is the single most
      // important lint rule here: violations only fail at runtime.
      'import-x/extensions': ['error', 'always', { ignorePackages: true }],
      'import-x/first': 'error',
      // `import-x/named` is intentionally left off: without type-aware linting
      // it cannot see TypeScript `export type { ... }` re-exports and reports
      // false positives (e.g. GlobOptions from `glob`). tsc already covers this.
      'import-x/named': 'off',
      'import-x/newline-after-import': 'error',
      'import-x/no-absolute-path': 'error',
      'import-x/no-amd': 'error',
      'import-x/no-cycle': 'warn',
      'import-x/no-duplicates': 'error',
      'import-x/no-dynamic-require': 'error',
      'import-x/no-import-module-exports': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      'import-x/no-named-default': 'error',
      'import-x/no-relative-packages': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': ['error', { commonjs: true }],
      'import-x/no-webpack-loader-syntax': 'error',
      // import sorting is handled by perfectionist/sort-imports below
      'import-x/order': 'off',
      // a build library exports many small helpers per module
      'import-x/prefer-default-export': 'off',
      // --- node correctness (eslint-plugin-n) ---
      // airbnb used the core no-buffer-constructor / no-path-concat /
      // no-new-require rules, which eslint deprecated in favor of this plugin.
      // n/no-deprecated-api covers the unsafe `new Buffer()` constructor.
      'n/no-deprecated-api': 'error',
      'n/no-new-require': 'error',
      'n/no-path-concat': 'error',
      'new-cap': [
        'error',
        { capIsNew: false, newIsCap: true, properties: true },
      ],
      'no-alert': 'warn',
      // --- airbnb rules this project deliberately opts out of ---
      // build scripts legitimately await sequentially in loops
      'no-await-in-loop': 'off',
      'no-bitwise': 'error',
      'no-caller': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
      'no-constructor-return': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-extra-label': 'error',
      'no-implied-eval': 'error',
      'no-inner-declarations': 'error',
      'no-iterator': 'error',
      'no-label-var': 'error',
      'no-labels': ['error', { allowLoop: false, allowSwitch: false }],
      'no-lone-blocks': 'error',
      'no-loop-func': 'error',
      'no-multi-assign': 'error',
      'no-multi-str': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-object-constructor': 'error',
      'no-octal-escape': 'error',
      // airbnb exempted common accumulator/context params, which this codebase
      // relies on (e.g. reduce accumulators)
      'no-param-reassign': [
        'error',
        {
          ignorePropertyModificationsFor: [
            'acc',
            'accumulator',
            'e',
            'ctx',
            'context',
            'req',
            'request',
            'res',
            'response',
          ],
          props: true,
        },
      ],
      'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
      'no-promise-executor-return': 'error',
      'no-proto': 'error',
      // enabled by @eslint/js recommended, but intentionally off in this project
      'no-prototype-builtins': 'off',
      // handled by @typescript-eslint equivalents above
      'no-redeclare': 'off',
      // airbnb also banned exporting `then`, which breaks dynamic import()
      // through promise assimilation
      'no-restricted-exports': [
        'error',
        { restrictedNamedExports: ['default', 'then'] },
      ],
      'no-restricted-globals': ['error', 'isFinite', 'isNaN'],
      'no-restricted-properties': [
        'error',
        {
          message: 'arguments.callee is deprecated',
          object: 'arguments',
          property: 'callee',
        },
        {
          message: 'Use the exponentiation operator (**) instead.',
          object: 'Math',
          property: 'pow',
        },
        {
          message: 'Please use Object.defineProperty instead.',
          property: '__defineGetter__',
        },
        {
          message: 'Please use Object.defineProperty instead.',
          property: '__defineSetter__',
        },
      ],
      'no-return-assign': 'off',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-shadow': 'off',
      'no-template-curly-in-string': 'error',
      'no-throw-literal': 'error',
      'no-undef-init': 'error',
      'no-underscore-dangle': ['error', { enforceInMethodNames: true }],
      'no-unneeded-ternary': ['error', { defaultAssignment: false }],
      'no-unreachable-loop': 'error',
      // airbnb enabled the stricter option; @eslint/js defaults it to false
      'no-unsafe-optional-chaining': [
        'error',
        { disallowArithmeticOperators: true },
      ],
      'no-useless-computed-key': 'error',
      'no-useless-concat': 'error',
      'no-useless-rename': 'error',
      'no-useless-return': 'error',
      'no-void': 'error',
      'object-shorthand': [
        'error',
        'always',
        { avoidQuotes: true, ignoreConstructors: false },
      ],
      'one-var': ['error', 'never'],
      // --- deterministic sorting (perfectionist) ---
      'perfectionist/sort-enums': 'error',
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [
            ['builtin', 'external'],
            'parent',
            'sibling',
            'index',
            'unknown',
          ],
          ignoreCase: true,
          newlinesBetween: 1,
          order: 'asc',
          type: 'alphabetical',
        },
      ],
      'perfectionist/sort-interfaces': 'error',
      'perfectionist/sort-named-imports': [
        'error',
        { ignoreCase: true, order: 'asc', type: 'alphabetical' },
      ],
      'perfectionist/sort-object-types': 'error',
      // also covers destructuring patterns
      'perfectionist/sort-objects': 'error',

      'prefer-const': [
        'error',
        { destructuring: 'any', ignoreReadBeforeAssign: true },
      ],
      'prefer-destructuring': [
        'error',
        {
          AssignmentExpression: { array: false, object: false },
          VariableDeclarator: { array: false, object: true },
        },
      ],
      'prefer-exponentiation-operator': 'error',
      'prefer-numeric-literals': 'error',
      'prefer-object-spread': 'error',
      'prefer-promise-reject-errors': ['error', { allowEmptyReject: true }],
      'prefer-regex-literals': ['error', { disallowRedundantWrapping: true }],
      radix: 'error',
      'spaced-comment': [
        'error',
        'always',
        {
          block: {
            balanced: true,
            exceptions: ['-', '+'],
            markers: ['=', '!', ':', '::'],
          },
          line: { exceptions: ['-', '+'], markers: ['=', '!', '/'] },
        },
      ],
      strict: ['error', 'never'],
      'symbol-description': 'error',
      'unicode-bom': ['error', 'never'],
      // airbnb enabled the stricter option; @eslint/js defaults it to false
      'valid-typeof': ['error', { requireStringLiterals: true }],
      'vars-on-top': 'error',
      yoda: 'error',

      // --- prettier last: turns off every stylistic rule it owns ---
      // In flat config `prettier/recommended` no longer pulls in
      // eslint-config-prettier via `extends`, so it is spread explicitly.
      ...prettierConfig.rules,
      ...prettierPlugin.configs.recommended.rules,
      'prettier/prettier': 'error',
    },
    settings: {
      'import-x/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      },
    },
  },
  // config files and build targets are allowed to use console freely
  {
    files: ['eslint.config.js', 'targets/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
