import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  // Electron 通过 file:// 协议加载，需要相对路径
  base: './',
  build: {
    sourcemap: 'hidden',
    outDir: 'dist',
    emptyOutDir: true,
    // 代码分割：将大体积第三方依赖拆分到独立 chunk，避免主 chunk 超 500KB 警告
    rollupOptions: {
      output: {
        manualChunks: {
          // React 运行时
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // 富文本编辑器（Tiptap + ProseMirror 生态体积较大）
          'editor-vendor': [
            '@tiptap/react',
            '@tiptap/starter-kit',
            '@tiptap/extension-color',
            '@tiptap/extension-text-style',
            '@tiptap/extension-link',
            '@tiptap/extension-placeholder',
          ],
          // 文档导出三件套
          'export-vendor': ['docx', 'pdf-lib', 'jszip'],
          // 状态管理 + 工具库
          'utils-vendor': ['zustand', 'dompurify', 'lucide-react'],
        },
      },
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths()
  ],
})
