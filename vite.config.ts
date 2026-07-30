import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  // Electron 通过 file:// 协议加载，需要相对路径
  base: './',
  build: {
    // 生产构建禁用 sourcemap：避免 .map 文件被打入 app.asar，
    // 防止源代码结构泄露给终端用户并减小打包体积。
    // 开发调试时通过 `vite dev` 自带 sourcemap，无需在此启用。
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    // 第三方库（pdf-lib 511K、docx 336K、@tiptap 383K）体积不可控，
    // 调高警告阈值到 600K 避免误报；应用代码 chunks 已通过 manualChunks 合理分割
    chunkSizeWarningLimit: 600,
    // 代码分割：用函数形式按 node_modules 路径前缀自动分组，避免手动列举遗漏。
    // 之前用对象形式时漏配了 @tiptap/extension-underline/highlight/focus、
    // @tiptap/pm/* (prosemirror) 等，导致它们被错误打入 EditorPage chunk。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // 文档导出三件套拆成独立 chunk：用户只导出单一格式时不需加载其他两库，
          // 单库升级时缓存失效范围更小
          if (id.includes('/node_modules/docx/') || id.includes('/node_modules/@docx/')) return 'docx-vendor';
          // mammoth（DOCX→HTML 转换）体积较大且仅在导入 DOCX 文件时通过动态 import 拉取，
          // 独立 chunk 后导入 Markdown/纯文本时不必加载 mammoth，缓存也可独立于导入解析逻辑
          if (id.includes('/node_modules/mammoth/')) return 'mammoth-vendor';
          // pdf-lib 与 @pdf-lib/fontkit 拆为独立 chunk：
          //   - pdf-lib 主库（PDFDocument/StandardFonts 等）体积大，作为基础 chunk
          //   - fontkit 仅在嵌入自定义中文字体时才需要（registerFontkit 调用点），
          //     独立 chunk 后用户即便导出 PDF 但走 Helvetica 降级路径也不必加载 fontkit
          //   - 两者升级/缓存失效互不影响
          if (id.includes('/node_modules/pdf-lib/')) return 'pdf-lib';
          if (id.includes('/node_modules/@pdf-lib/')) return 'pdf-fontkit';
          if (id.includes('/node_modules/jszip/') || id.includes('/node_modules/@jszip/')) return 'jszip-vendor';
          // 富文本编辑器拆分：Tiptap 与 ProseMirror 分离为独立 vendor chunk
          //   - @tiptap/* 为编辑器上层 API（扩展/StarterKit/React 绑定）
          //   - prosemirror-* 为底层文档模型（@tiptap/pm 的实际依赖）
          //   - 分离后单 chunk 体积更小，独立缓存；版本升级影响范围更精准
          if (id.includes('/node_modules/@tiptap/')) return 'tiptap-vendor';
          if (id.includes('/node_modules/prosemirror-')) return 'prosemirror-vendor';
          // 拖拽库（@dnd-kit/core + 各子包），独立分包避免被打入 EditorPage chunk
          if (id.includes('/node_modules/@dnd-kit/')) return 'dnd-vendor';
          // React 运行时
          if (id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/react-router/') ||
              id.includes('/node_modules/scheduler/')) return 'react-vendor';
          // 状态管理 + 工具库
          if (id.includes('/node_modules/zustand/') ||
              id.includes('/node_modules/dompurify/') ||
              id.includes('/node_modules/lucide-react/')) return 'utils-vendor';
          return undefined;
        },
      },
    },
  },
  plugins: [
    // react-dev-locator 仅在开发模式启用：它是 IDE 点击跳转源码的开发期工具，
    // 生产构建启用会走 babel 转换链路（比纯 esbuild 慢 2-5 倍）并给每个组件
    // 注入 dev locator 元数据增大 bundle 体积。
    react({
      babel: process.env.NODE_ENV === 'development' ? {
        plugins: ['react-dev-locator'],
      } : undefined,
    }),
    tsconfigPaths()
  ],
})
