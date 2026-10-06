import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';

const strictTypeScript = tseslint.configs.strict.map((config) => ({
  ...config,
  files: ['**/*.{ts,svelte}'],
}));

export default tseslint.config(
  { ignores: ['build/**', 'dist/**', 'node_modules/**'] },
  {
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: { ...globals.browser, ...globals.node },
    },
  },
  ...strictTypeScript,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  svelte.configs['flat/prettier'],
  prettier,
);
