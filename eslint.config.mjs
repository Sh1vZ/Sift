import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettierPlugin from 'eslint-plugin-prettier'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/build/**',
      '**/.vite/**',
      'design-system/**',
      'src/renderer/src/components/bits/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...vue.configs['flat/recommended'],

  // Prettier owns formatting: this turns off every stylistic rule the
  // configs above enable so they cannot fight `prettier/prettier`.
  prettierConfig,

  {
    files: ['**/*.{ts,mts,cts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { prettier: prettierPlugin },
    rules: {
      'prettier/prettier': 'warn',

      // TypeScript
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/require-await': 'off',
      // `||` is deliberate on strings here: an empty env var or an empty error
      // message has to fall through to the default, which `??` would keep.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true } },
      ],
      // No-op arrows are a real pattern in main: the inert dev updater's stubs
      // and the logger sink's discarded `debug`.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // General
      'no-underscore-dangle': 'off',
      'linebreak-style': 'off',
      'object-curly-newline': 'off',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      // `cap` in splash.ts is read by a closure defined above its assignment.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],

      // Vue
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      'vue/attributes-order': 'warn',
      'vue/component-name-in-template-casing': ['warn', 'PascalCase'],
      'vue/define-macros-order': [
        'warn',
        { order: ['defineOptions', 'defineProps', 'defineEmits', 'defineSlots'] },
      ],
    },
  },

  // Vue SFCs: vue-eslint-parser drives the template, delegating <script> to
  // the TypeScript parser so the type-aware rules above still apply.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        project: ['./tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
      globals: globals.browser,
    },
  },

  // Main, preload, build scripts and tests run in Node.
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Release scripts and tests are CLIs; their stdout is the point.
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Config files sit outside both tsconfigs, so no type information exists.
  {
    files: ['**/*.{js,mjs,cjs}', 'electron.vite.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
)
