import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'Literal[raw="null"]',
          message:
            '避免使用 null，请使用 undefined。仅在外部 API 要求、JSON 序列化或显式删除标记时使用 null（需加 eslint-disable 注释说明原因）。',
        },
      ],
    },
  },
  prettierConfig,
  {
    plugins: { prettier: prettierPlugin },
    rules: { 'prettier/prettier': 'error' },
  },
);
