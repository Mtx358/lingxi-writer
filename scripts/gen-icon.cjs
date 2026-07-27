// 生成应用图标 PNG（512x512），替代无法被 electron-builder 直接使用的 svg。
// 简化绘制 SVG 的视觉主题：深色圆角方块 + 金色羽毛笔笔尖。
// 仅用于打包，运行时图标由 Electron 从 build/icon.png 加载。
const PNG = require('pngjs').PNG;
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const png = new PNG({ width: SIZE, height: SIZE });

// 颜色（RGBA）
const C_BG_TOP = [0x1a, 0x1a, 0x1a, 0xff];
const C_BG_BOT = [0x0a, 0x0a, 0x0a, 0xff];
const C_BORDER = [0xf5, 0x9e, 0x0b, 0xff];
const C_FEATHER = [0x14, 0x14, 0x14, 0xff];
const C_GOLD = [0xfb, 0xbf, 0x24, 0xff];
const C_GOLD_DARK = [0xd9, 0x77, 0x06, 0xff];
const C_GOLD_LIGHT = [0xfd, 0xe0, 0x68, 0xff];
const C_TRANSPARENT = [0, 0, 0, 0];

function setPixel(x, y, c) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (SIZE * y + x) << 2;
  png.data[idx] = c[0];
  png.data[idx + 1] = c[1];
  png.data[idx + 2] = c[2];
  png.data[idx + 3] = c[3];
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(a, b, t) {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t)), 255];
}

// 填充背景：圆角方块（半径 48），从上到下渐变
const R = 48;
const margin = 40;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 圆角判定
    let inside = true;
    const rx = margin, ry = margin, rw = SIZE - 2 * margin, rh = SIZE - 2 * margin;
    if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) { inside = false; }
    else {
      // 四角圆角
      const cx = x - rx, cy = y - ry;
      const corners = [
        [R, R], [rw - R, R], [R, rh - R], [rw - R, rh - R]
      ];
      let inCorner = false;
      for (const [ccx, ccy] of corners) {
        const dx = cx - ccx, dy = cy - ccy;
        const cornerType = (ccx === R ? cx < R : cx > rw - R) && (ccy === R ? cy < R : cy > rh - R);
        if (cornerType && dx * dx + dy * dy > R * R) { inCorner = true; break; }
      }
      if (inCorner) inside = false;
    }
    if (!inside) { setPixel(x, y, C_TRANSPARENT); continue; }
    const t = (y - ry) / rh;
    setPixel(x, y, lerpColor(C_BG_TOP, C_BG_BOT, t));
  }
}

// 绘制边框（2px 金色）
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const rx = margin, ry = margin, rw = SIZE - 2 * margin, rh = SIZE - 2 * margin;
    const onBorder =
      (Math.abs(x - rx) < 2 || Math.abs(x - (rx + rw - 1)) < 2) && y >= ry && y < ry + rh ||
      (Math.abs(y - ry) < 2 || Math.abs(y - (ry + rh - 1)) < 2) && x >= rx && x < rx + rw;
    if (onBorder) setPixel(x, y, C_BORDER);
  }
}

// 绘制羽毛笔（从右上到左下的羽毛 + 左下的金色笔尖）
// 中心 256,256，旋转 -45 度
const cx = 256, cy = 256;
function rotate(p, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c];
}
const angle = -Math.PI / 4;

// 羽毛主体（椭圆，旋转后）
function fillEllipse(center, rx, ry, color, rotAngle) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 反向旋转到本地坐标
      const c = Math.cos(-rotAngle), s = Math.sin(-rotAngle);
      const lx = (x - center[0]) * c - (y - center[1]) * s;
      const ly = (x - center[0]) * s + (y - center[1]) * c;
      if ((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1) {
        setPixel(x, y, color);
      }
    }
  }
}

// 羽毛：沿对角线的细长形状
const featherCenter = rotate([cx + 60, cy - 60], angle);
fillEllipse(featherCenter, 90, 28, C_FEATHER, angle);

// 羽毛纹理（金色细线）
for (let i = -70; i <= 70; i += 8) {
  const p1 = rotate([cx + 60 + i, cy - 60 - 25], angle);
  const p2 = rotate([cx + 60 + i, cy - 60 + 25], angle);
  // 画线
  const steps = 60;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = Math.round(lerp(p1[0], p2[0], t));
    const py = Math.round(lerp(p1[1], p2[1], t));
    setPixel(px, py, C_GOLD);
  }
}

// 笔尖（金色三角形 + 金属环）
const nibTip = rotate([cx - 90, cy + 90], angle);
const nibBase1 = rotate([cx - 70, cy + 70], angle);
const nibBase2 = rotate([cx - 60, cy + 100], angle);

// 填充三角形
function fillTriangle(a, b, c, color) {
  const minX = Math.floor(Math.min(a[0], b[0], c[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1]));
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  function sign(p1, p2, p3) {
    return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = [x, y];
      const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(hasNeg && hasPos)) setPixel(x, y, color);
    }
  }
}
fillTriangle(nibTip, nibBase1, nibBase2, C_GOLD_DARK);
fillTriangle(nibTip, nibBase1, [nibBase2[0] - 4, nibBase2[1]], C_GOLD);

// 金属环（金色矩形，旋转）
const ringCenter = rotate([cx - 75, cy + 75], angle);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const lx = (x - ringCenter[0]) * c - (y - ringCenter[1]) * s;
    const ly = (x - ringCenter[0]) * s + (y - ringCenter[1]) * c;
    if (Math.abs(lx) < 30 && Math.abs(ly) < 8) {
      setPixel(x, y, lx < 0 ? C_GOLD_LIGHT : C_GOLD);
    }
  }
}

// 笔尖小点（墨孔）
const dotCenter = rotate([cx - 66, cy + 66], angle);
setPixel(Math.round(dotCenter[0]), Math.round(dotCenter[1]), [0x1a, 0x1a, 0x1a, 0xff]);
setPixel(Math.round(dotCenter[0]) + 1, Math.round(dotCenter[1]), [0x1a, 0x1a, 0x1a, 0xff]);

const outPath = path.join(__dirname, '..', 'build', 'icon.png');
png.pack().pipe(fs.createWriteStream(outPath)).on('finish', () => {
  const stat = fs.statSync(outPath);
  console.log(`Generated ${outPath} (${stat.size} bytes, ${SIZE}x${SIZE})`);
});
