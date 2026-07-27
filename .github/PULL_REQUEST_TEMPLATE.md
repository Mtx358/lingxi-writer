# 灵犀写作助手 PR 检查清单
#
# 提交 PR 前请确认以下项目全部勾选，加速 review 流程

## 代码质量

- [ ] `npm run lint` 通过（0 错误 0 警告）
- [ ] `npx tsc --noEmit` 渲染层类型检查通过
- [ ] `npx tsc -p tsconfig.electron.json --noEmit` electron 层类型检查通过
- [ ] `npm test` 单元测试全部通过
- [ ] 新增/修改的代码已添加单元测试（关键路径覆盖率优先）
- [ ] `npm run build` 生产构建通过

## 安全审查（涉及以下场景时必填）

- [ ] 新增 IPC handler 已做入参白名单校验
- [ ] 文件路径相关操作已用 `isSafeProjectFilePath` / `isInsideDataDir` / `assertRealPathInside` 三层校验
- [ ] 用户可控字符串拼接到 `path.join` / `URL` 前已用 `isSafeIdentifier` 校验
- [ ] 日志输出不含 `apiKey` / `token` / `password` 等敏感字段（logger 已自动脱敏，自定义 console.* 需手动脱敏）
- [ ] 新增外部域名访问已在 `isAllowedAiBaseUrl` 或 `setWindowOpenHandler` 白名单中

## 描述

<!-- 简述本 PR 的目的与改动范围，关联 issue 号（如有） -->

## 测试方式

<!-- 描述如何手动验证本改动，例如：
1. 启动 `npm run electron:dev`
2. 打开项目 → 创建章节 → 输入内容 → Ctrl+S 保存
3. 重启应用，确认章节内容持久化
-->
