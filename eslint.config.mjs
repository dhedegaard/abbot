import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['node_modules/', 'output/'] },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // We use `interface Foo extends z.infer<...> {}` for zod-derived object
      // types; the empty interface is intentional.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  eslintConfigPrettier
)
