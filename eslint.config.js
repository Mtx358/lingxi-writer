import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'single-file.tsx', 'electron/dist', 'main.cjs', 'preload.cjs', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // 下划线前缀的参数/变量表示故意未使用（如 mock 回调签名中的占位参数）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // 测试文件 override：测试场景中 any 可接受（mock/fixture 类型常不确定），
  // 但保留 warn 以提醒尽量收敛；this 别名在测试中也较常见，一并降级为 warn。
  // 另：测试中对 mock 对象使用 a!.b?.c（optional-chain + 非空断言）、
  // obj.hasOwnProperty、偶发未使用的 mock helper/类型导入、可改 const 的 let 也较常见，
  // 统一降为 warn 以免阻断 CI，同时保留提醒。
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      'no-prototype-builtins': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'prefer-const': 'warn',
    },
  },
)
