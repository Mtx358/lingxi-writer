<#
.SYNOPSIS
    Lingxi Writer - Windows build script (self-contained, does NOT modify package.json)
.DESCRIPTION
    This script avoids ALL package.json encoding issues by:
      - NOT reading/modifying package.json via PowerShell
      - Running esbuild directly via `node scripts/build-electron.cjs` (not npm run)
      - Using pure English text only
    Output: release/ (NSIS installer + portable exe)
    Full log: build-win.log
.NOTES
    Requires: Node.js >= 20, npm >= 10, PowerShell 5.1+
    Usage:
      .\scripts\build-win.ps1
      .\scripts\build-win.ps1 -SkipInstall   # skip npm install
      .\scripts\build-win.ps1 -PackOnly      # only electron-builder, reuse existing dist/
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$PackOnly
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Step($msg) { Write-Host "`n========== $msg ==========" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red }

$script:Interactive = ($Host.Name -eq 'ConsoleHost' -and -not [Console]::IsInputRedirected)

$LogPath = Join-Path $Root 'build-win.log'
try {
    Start-Transcript -Path $LogPath -Force -ErrorAction SilentlyContinue | Out-Null
} catch {}

try {
    # ---- 0. Environment check ----
    Write-Step 'Environment check'
    $nodeVer = (node -v 2>$null)
    if (-not $nodeVer) { throw 'Node.js not found. Install Node.js >= 20.' }
    Write-OK "Node.js $nodeVer"

    if (-not (Test-Path 'package.json')) { throw "package.json not found: $Root" }
    Write-OK "Project root: $Root"

    # ---- 1. Set CN mirror (avoid Electron download timeout) ----
    Write-Step 'Set CN mirror (npmmirror)'
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    $env:NPM_CONFIG_REGISTRY = 'https://registry.npmmirror.com/'
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    Write-OK 'Mirror set'

    # ---- 2. Install dependencies (npm reads package.json as UTF-8, no issue) ----
    if (-not $SkipInstall -and -not $PackOnly) {
        Write-Step 'Install dependencies'
        npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }
        Write-OK 'Dependencies installed'
    } else {
        Write-Step 'Skip dependency install'
    }

    if (-not $PackOnly) {
        # ---- 3. Create build-electron.cjs if missing (pure ASCII, no encoding issue) ----
        Write-Step 'Ensure scripts/build-electron.cjs exists'
        $cjsPath = Join-Path $Root 'scripts\build-electron.cjs'
        if (-not (Test-Path $cjsPath)) {
            $cjsContent = @'
// scripts/build-electron.cjs - compile electron TS to CJS via esbuild
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'electron', 'dist');

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

const HANDLERS_DIR = path.join(OUT_DIR, 'handlers');
fs.mkdirSync(HANDLERS_DIR, { recursive: true });

async function build() {
  console.log('[build-electron] main.ts -> main.cjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'electron', 'main.ts')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    outfile: path.join(OUT_DIR, 'main.cjs'),
    external: ['electron', 'jszip'],
    logLevel: 'info', sourcemap: false, minify: false,
  });

  console.log('[build-electron] preload.ts -> preload.cjs');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'electron', 'preload.ts')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    outfile: path.join(OUT_DIR, 'preload.cjs'),
    external: ['electron'],
    logLevel: 'info', sourcemap: false, minify: false,
  });

  console.log('[build-electron] handlers/*.ts -> handlers/*.js');
  const handlersDir = path.join(ROOT, 'electron', 'handlers');
  if (fs.existsSync(handlersDir)) {
    const handlerFiles = fs.readdirSync(handlersDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const f of handlerFiles) {
      await esbuild.build({
        entryPoints: [path.join(handlersDir, f)],
        bundle: false, platform: 'node', format: 'cjs', target: 'node20',
        outfile: path.join(HANDLERS_DIR, f.replace(/\.ts$/, '.js')),
        logLevel: 'silent', sourcemap: false, minify: false,
      });
    }
    const storageDir = path.join(handlersDir, 'storage');
    if (fs.existsSync(storageDir)) {
      const storageOutDir = path.join(HANDLERS_DIR, 'storage');
      fs.mkdirSync(storageOutDir, { recursive: true });
      const storageFiles = fs.readdirSync(storageDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      for (const f of storageFiles) {
        await esbuild.build({
          entryPoints: [path.join(storageDir, f)],
          bundle: false, platform: 'node', format: 'cjs', target: 'node20',
          outfile: path.join(storageOutDir, f.replace(/\.ts$/, '.js')),
          logLevel: 'silent', sourcemap: false, minify: false,
        });
      }
    }
  }

  console.log('[build-electron] other electron/*.ts -> electron/dist/*.js');
  const electronDir = path.join(ROOT, 'electron');
  const otherTsFiles = fs.readdirSync(electronDir).filter(f =>
    f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'main.ts' && f !== 'preload.ts'
  );
  for (const f of otherTsFiles) {
    await esbuild.build({
      entryPoints: [path.join(electronDir, f)],
      bundle: false, platform: 'node', format: 'cjs', target: 'node20',
      outfile: path.join(OUT_DIR, f.replace(/\.ts$/, '.js')),
      logLevel: 'silent', sourcemap: false, minify: false,
    });
  }

  console.log('[build-electron] done');
}

build().catch(err => { console.error('[build-electron] failed:', err); process.exit(1); });
'@
            # Write as ASCII to avoid any BOM/encoding issues
            Set-Content -Path $cjsPath -Value $cjsContent -Encoding ASCII
            Write-OK 'Created scripts/build-electron.cjs'
        } else {
            Write-OK 'scripts/build-electron.cjs already exists'
        }

        # ---- 4. Clean old build output ----
        Write-Step 'Clean old build output'
        Remove-Item -Recurse -Force (Join-Path $Root 'dist') -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force (Join-Path $Root 'electron\dist') -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force (Join-Path $Root 'node_modules\.vite') -ErrorAction SilentlyContinue
        Write-OK 'Cleaned'

        # ---- 5. Compile Electron main process (direct node call, NOT npm run) ----
        Write-Step 'Compile Electron main process (esbuild)'
        node scripts\build-electron.cjs
        if ($LASTEXITCODE -ne 0) { throw 'Electron compile failed' }
        Write-OK 'main.cjs + preload.cjs + handlers built'

        # ---- 6. Build frontend (npm reads package.json correctly as UTF-8) ----
        Write-Step 'Build frontend (Vite build)'
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
        Write-OK 'Frontend built (dist/)'
    } else {
        Write-Step 'PackOnly mode: skip compile'
    }

    # ---- 7. Package Windows installer ----
    Write-Step 'Package Windows installer (electron-builder --win)'

    $releaseDir = Join-Path $Root 'release'
    if (Test-Path $releaseDir) {
        Write-Host '  Cleaning previous release/ ...' -ForegroundColor DarkGray
        Remove-Item -Recurse -Force $releaseDir -ErrorAction SilentlyContinue
    }

    npx electron-builder --win --publish never
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'electron-builder failed'
        Write-Host ''
        Write-Host '  Common causes:' -ForegroundColor Yellow
        Write-Host '    1. Electron binary download timeout -> mirror is set, check network'
        Write-Host '    2. Still timeout -> download Electron manually (see below)'
        Write-Host ''
        Write-Host '  Manual Electron download:' -ForegroundColor Cyan
        Write-Host '    1. Open https://npmmirror.com/mirrors/electron/43.1.0/'
        Write-Host '    2. Download electron-v43.1.0-win32-x64.zip'
        Write-Host '    3. Put it in: ~\AppData\Local\electron\Cache\43.1.0\'
        Write-Host '    4. Re-run: .\scripts\build-win.ps1 -PackOnly'
        throw 'electron-builder failed'
    }
    Write-OK 'Packaging done'

    # ---- 8. List artifacts ----
    Write-Step 'Build artifacts'
    if (Test-Path $releaseDir) {
        $files = Get-ChildItem -Path $releaseDir -File | Where-Object { $_.Extension -in '.exe','.blockmap','.yaml' }
        if ($files) {
            foreach ($f in $files) {
                $sizeMB = [math]::Round($f.Length / 1MB, 1)
                Write-Host "  $($f.Name)  ($sizeMB MB)" -ForegroundColor Yellow
            }
        } else {
            Write-Host '  No .exe artifact found in release/' -ForegroundColor Yellow
        }
        Write-Host "`n  Output dir: $releaseDir" -ForegroundColor Cyan
    } else {
        Write-Err 'release/ directory does not exist'
    }

    Write-Host "`n========== ALL DONE ==========" -ForegroundColor Green
}
catch {
    Write-Host ''
    Write-Err ($_.Exception.Message)
    Write-Host "`n========== BUILD INTERRUPTED ==========" -ForegroundColor Red
}
finally {
    try { Stop-Transcript -ErrorAction SilentlyContinue } catch {}

    if ($script:Interactive) {
        Write-Host ''
        Write-Host "Full log saved: $LogPath" -ForegroundColor DarkGray
        Write-Host 'Press any key to close...' -ForegroundColor White
        [Console]::ReadKey($true) | Out-Null
    }
}
