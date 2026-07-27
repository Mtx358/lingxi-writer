// scripts/build-electron.cjs
// 用 esbuild 编译 electron 端 TypeScript → CommonJS .cjs 文件
// 解决 tsc 只能输出 .js 但 package.json main 字段需要 .cjs 的问题
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'electron', 'dist');

// 清理旧的编译产物（保留 handlers 子目录）
if (fs.existsSync(OUT_DIR)) {
  for (const f of fs.readdirSync(OUT_DIR)) {
    const full = path.join(OUT_DIR, f);
    if (fs.statSync(full).isFile() && (f.endsWith('.cjs') || f.endsWith('.js'))) {
      fs.unlinkSync(full);
    }
  }
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// 确认 handlers 目录存在
const HANDLERS_DIR = path.join(OUT_DIR, 'handlers');
fs.mkdirSync(HANDLERS_DIR, { recursive: true });

async function build() {
  console.log('[build-electron] 编译 main.ts → main.cjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'electron', 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(OUT_DIR, 'main.cjs'),
    external: ['electron', 'jszip'],
    logLevel: 'info',
    sourcemap: false,
    minify: false,
  });

  console.log('[build-electron] 编译 preload.ts → preload.cjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'electron', 'preload.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: path.join(OUT_DIR, 'preload.cjs'),
    external: ['electron'],
    logLevel: 'info',
    sourcemap: false,
    minify: false,
  });

  console.log('[build-electron] 编译 handlers/*.ts → handlers/*.js');
  const handlersDir = path.join(ROOT, 'electron', 'handlers');
  if (fs.existsSync(handlersDir)) {
    const handlerFiles = fs.readdirSync(handlersDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of handlerFiles) {
      await esbuild.build({
        entryPoints: [path.join(handlersDir, f)],
        bundle: false,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        outfile: path.join(HANDLERS_DIR, f.replace(/\.ts$/, '.js')),
        logLevel: 'silent',
        sourcemap: false,
        minify: false,
      });
    }
    // 处理 storage 子目录
    const storageDir = path.join(handlersDir, 'storage');
    if (fs.existsSync(storageDir)) {
      const storageOutDir = path.join(HANDLERS_DIR, 'storage');
      fs.mkdirSync(storageOutDir, { recursive: true });
      const storageFiles = fs.readdirSync(storageDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      for (const f of storageFiles) {
        await esbuild.build({
          entryPoints: [path.join(storageDir, f)],
          bundle: false,
          platform: 'node',
          format: 'cjs',
          target: 'node20',
          outfile: path.join(storageOutDir, f.replace(/\.ts$/, '.js')),
          logLevel: 'silent',
          sourcemap: false,
          minify: false,
        });
      }
    }
  }

  console.log('[build-electron] 编译其他 electron/*.ts → electron/dist/*.js');
  const electronDir = path.join(ROOT, 'electron');
  const otherTsFiles = fs.readdirSync(electronDir).filter(f =>
    f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'main.ts' && f !== 'preload.ts'
  );
  for (const f of otherTsFiles) {
    await esbuild.build({
      entryPoints: [path.join(electronDir, f)],
      bundle: false,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      outfile: path.join(OUT_DIR, f.replace(/\.ts$/, '.js')),
      logLevel: 'silent',
      sourcemap: false,
      minify: false,
    });
  }

  console.log('[build-electron] 完成');
}

build().catch(err => {
  console.error('[build-electron] 失败:', err);
  process.exit(1);
});
