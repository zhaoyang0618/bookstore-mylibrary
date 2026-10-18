import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 只跑本仓库的测试；不排除的话 vitest 会扫进 .pnpm-store/ 里的包副本
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.pnpm-store/**', 'fixtures/**'],
    environment: 'node',
  },
});
