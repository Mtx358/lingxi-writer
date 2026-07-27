# 灵犀写作助手 - 本地构建指南

本指南用于在本地从源码构建可安装的发布包。

## 前置要求

| 工具 | 版本要求 | 下载 |
|------|---------|------|
| Node.js | ≥ 20.0.0（推荐 22.x LTS） | https://nodejs.org/ |
| npm | ≥ 10.0.0（随 Node 附带） | - |
| Git | 任意版本 | https://git-scm.com/ |
| 7-Zip（可选） | 任意版本 | 用于解压便携版 |

**Windows 用户**：建议用 PowerShell 或 Git Bash 执行命令。
**macOS 用户**：需先 `xcode-select --install` 安装命令行工具。
**Linux 用户**：需安装 `libgbm-dev libnss3-dev libasound2` 等依赖。

## 步骤 1：克隆仓库

```bash
git clone <你的仓库URL> lingxi-writer
cd lingxi-writer
```

## 步骤 2：安装依赖

```bash
npm install
```

首次安装约需 2-5 分钟（取决于网络，约 300MB 下载量）。

如果网络较慢，可使用国内镜像加速：

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

## 步骤 3：验证环境

```bash
# TypeScript 类型检查
npm run check

# 单元测试（可选，验证源码完整性）
npm test
```

如测试全部通过，说明源码完整，可以进入构建。

## 步骤 4：构建发布包

### Windows 安装包（NSIS）

```bash
npm run electron:build:win
```

产物：
- `release/LingxiWriter-1.0.0-Setup.exe`（约 100MB，NSIS 安装向导）
- `release/LingxiWriter-1.0.0-portable/`（便携版目录）

### Linux 安装包

```bash
npm run electron:build:linux
```

产物：
- `release/LingxiWriter-1.0.0.AppImage`（直接运行）
- `release/LingxiWriter-1.0.0.deb`（Debian/Ubuntu 安装包）

### macOS 安装包

```bash
npm run electron:build:mac
```

产物：
- `release/LingxiWriter-1.0.0.dmg`

## 步骤 5：首次运行

### Windows

双击 `LingxiWriter-1.0.0-Setup.exe`，按向导完成安装，从开始菜单启动「灵犀写作助手」。

### Linux

```bash
chmod +x release/LingxiWriter-1.0.0.AppImage
./release/LingxiWriter-1.0.0.AppImage
```

### macOS

双击 `.dmg` 文件，将「灵犀写作助手」拖入 Applications 文件夹，从 Launchpad 启动。

首次启动如被拦截「无法验证开发者」，在 `系统偏好设置 → 安全性与隐私` 中允许打开。

## 常见问题

### Q1：构建时下载 Electron 二进制很慢

设置淘宝镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run electron:build:win
```

Windows PowerShell：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run electron:build:win
```

### Q2：构建时下载 electron-builder 工具失败

```bash
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### Q3：应用启动后白屏

1. 打开开发者工具：`Ctrl+Shift+I`
2. 查看 Console 报错
3. 常见原因：
   - 杀毒软件拦截 asar 加载 → 添加信任
   - 路径包含特殊字符 → 移到纯英文路径
   - 权限不足 → 以管理员身份运行

### Q4：测试不通过

如 `npm test` 失败但不影响构建，可跳过：

```bash
npm run electron:build:win
```

构建脚本会自动执行 `tsc -b && vite build`，不需要测试通过。

### Q5：想跳过构建直接运行开发版

```bash
npm run electron:dev
```

会启动 Vite 开发服务器 + Electron 热重载，用于调试。

## 项目结构

```
lingxi-writer/
├── src/                    # 前端源码（React + TypeScript）
├── electron/               # Electron 主进程源码
│   ├── main.ts            # 主进程入口
│   └── preload.ts         # 预加载脚本
├── build/                  # electron-builder 资源
│   ├── icon.png           # 应用图标
│   └── icon.svg
├── tests/                  # 单元测试
├── e2e/                    # 端到端测试
├── package.json           # 依赖与构建脚本
├── vite.config.ts         # Vite 配置
├── vitest.config.ts       # 测试配置
├── tsconfig.json          # TypeScript 配置
├── tsconfig.electron.json # Electron 端 TS 配置
└── eslint.config.js       # ESLint 配置
```

## 技术栈

- **前端**：React 18 + TypeScript + Tailwind CSS + TipTap 编辑器
- **桌面**：Electron 43 + electron-builder
- **构建**：Vite 6 + esbuild
- **测试**：Vitest（单元）+ Playwright（E2E）
- **状态**：Zustand

## 安全特性

本应用已实施工业级安全加固：

- contextIsolation + sandbox 双层隔离
- CSP 内容安全策略
- IPC 速率限制 + 输入校验
- API 密钥 safeStorage 加密存储
- 主进程代理 AI 请求（密钥不进渲染进程）
- 文件路径白名单校验

## 构建 troubleshooting

如果 `npm run electron:build:win` 报错：

1. **清理重建**：
   ```bash
   rm -rf node_modules dist electron/dist release
   npm install
   npm run electron:build:win
   ```

2. **检查 TypeScript 编译**：
   ```bash
   npm run check
   ```

3. **单独构建前端**：
   ```bash
   npm run build
   ```

4. **单独构建 Electron**：
   ```bash
   npx tsc -p tsconfig.electron.json
   ```

5. **查看详细日志**：
   ```bash
   DEBUG=electron-builder npm run electron:build:win
   ```

## 许可证

私有项目，版权所有 © 2026 灵犀写作助手
