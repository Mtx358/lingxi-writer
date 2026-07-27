/**
 * electron/handlers/exportFile.logic.ts 单元测试
 *
 * 测试目标：导出文件扩展名提取 / 白名单校验 / 编码归一化 / base64 解码
 * - getExportFileExtension：小写、无点、空扩展名
 * - isAllowedExportExtension：白名单内 / 外、空扩展名
 * - normalizeExportEncoding：合法 / undefined / 空串 / 非字符串
 * - buildExportWriteOptions：与 normalizeExportEncoding 一致
 * - decodeBase64ToBuffer：合法 base64 / 非法字符静默忽略 / 空串
 *
 * 本测试无需 mock electron：exportFile.logic.ts 仅依赖 node:path + Buffer。
 * 不 import security.ts（其顶层 import electron app），改用本地构造的 Set
 * 复刻 EXPORT_ALLOWED_EXTENSIONS 形状（带点号小写扩展名集合）。
 */
import { describe, it, expect } from 'vitest';
import {
  getExportFileExtension,
  isAllowedExportExtension,
  normalizeExportEncoding,
  buildExportWriteOptions,
  decodeBase64ToBuffer,
} from './exportFile.logic';

// 复刻 security.ts 的 EXPORT_ALLOWED_EXTENSIONS 形状（带点号小写扩展名集合），
// 避免引入 electron 依赖。两者形状必须保持一致。
const EXPORT_ALLOWED_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.html', '.htm', '.docx', '.pdf', '.epub',
]);

describe('exportFile.logic / getExportFileExtension', () => {
  it('小写扩展名原样返回（不含点号）', () => {
    expect(getExportFileExtension('/path/file.txt')).toBe('txt');
  });

  it('大写扩展名归一化为小写', () => {
    expect(getExportFileExtension('/path/file.PDF')).toBe('pdf');
  });

  it('混合大小写扩展名归一化为小写', () => {
    expect(getExportFileExtension('/path/file.DocX')).toBe('docx');
  });

  it('无扩展名返回空字符串', () => {
    expect(getExportFileExtension('/path/noext')).toBe('');
  });

  it('仅点号结尾返回空字符串', () => {
    expect(getExportFileExtension('/path/file.')).toBe('');
  });

  it('多级扩展名取最后一段', () => {
    expect(getExportFileExtension('/path/file.tar.gz')).toBe('gz');
  });
});

describe('exportFile.logic / isAllowedExportExtension', () => {
  it('白名单内扩展名返回 true', () => {
    expect(isAllowedExportExtension('txt', EXPORT_ALLOWED_EXTENSIONS)).toBe(true);
    expect(isAllowedExportExtension('md', EXPORT_ALLOWED_EXTENSIONS)).toBe(true);
    expect(isAllowedExportExtension('pdf', EXPORT_ALLOWED_EXTENSIONS)).toBe(true);
    expect(isAllowedExportExtension('docx', EXPORT_ALLOWED_EXTENSIONS)).toBe(true);
    expect(isAllowedExportExtension('epub', EXPORT_ALLOWED_EXTENSIONS)).toBe(true);
  });

  it('白名单外扩展名返回 false（防 .exe/.bat 等可执行文件）', () => {
    expect(isAllowedExportExtension('exe', EXPORT_ALLOWED_EXTENSIONS)).toBe(false);
    expect(isAllowedExportExtension('bat', EXPORT_ALLOWED_EXTENSIONS)).toBe(false);
    expect(isAllowedExportExtension('sh', EXPORT_ALLOWED_EXTENSIONS)).toBe(false);
    expect(isAllowedExportExtension('js', EXPORT_ALLOWED_EXTENSIONS)).toBe(false);
  });

  it('空扩展名返回 false', () => {
    expect(isAllowedExportExtension('', EXPORT_ALLOWED_EXTENSIONS)).toBe(false);
  });

  it('大写扩展名不被白名单匹配（白名单是小写带点号）', () => {
    // 白名单集合是 { '.txt', '.md', ... }，isAllowedExportExtension 内部组装成 .${ext}
    // 传 'TXT' 会组装成 '.TXT' 不匹配 '.txt'
    expect(isAllowedExportExtension('TXT', EXPORT_ALLOWED_EXTENSIONS)).toBe(false);
  });

  it('自定义白名单可生效（不依赖 security 常量）', () => {
    const custom = new Set(['.csv', '.json']);
    expect(isAllowedExportExtension('csv', custom)).toBe(true);
    expect(isAllowedExportExtension('json', custom)).toBe(true);
    expect(isAllowedExportExtension('xml', custom)).toBe(false);
  });
});

describe('exportFile.logic / normalizeExportEncoding', () => {
  it('合法编码原值透传', () => {
    expect(normalizeExportEncoding('utf-8')).toBe('utf-8');
    expect(normalizeExportEncoding('utf8')).toBe('utf8');
    expect(normalizeExportEncoding('ascii')).toBe('ascii');
    expect(normalizeExportEncoding('base64')).toBe('base64');
    expect(normalizeExportEncoding('latin1')).toBe('latin1');
  });

  it('undefined 回退为 utf-8', () => {
    expect(normalizeExportEncoding(undefined)).toBe('utf-8');
  });

  it('空字符串回退为 utf-8', () => {
    expect(normalizeExportEncoding('')).toBe('utf-8');
  });

  it('非字符串值回退为 utf-8（防御性，TS 签名仅接 string）', () => {
    expect(normalizeExportEncoding(null as unknown as string)).toBe('utf-8');
    expect(normalizeExportEncoding(123 as unknown as string)).toBe('utf-8');
  });
});

describe('exportFile.logic / buildExportWriteOptions', () => {
  it('返回 { encoding } 对象，与 normalizeExportEncoding 一致', () => {
    expect(buildExportWriteOptions('utf-8')).toEqual({ encoding: 'utf-8' });
    expect(buildExportWriteOptions('ascii')).toEqual({ encoding: 'ascii' });
  });

  it('undefined 编码回退为 { encoding: utf-8 }', () => {
    expect(buildExportWriteOptions(undefined)).toEqual({ encoding: 'utf-8' });
  });

  it('空编码回退为 { encoding: utf-8 }', () => {
    expect(buildExportWriteOptions('')).toEqual({ encoding: 'utf-8' });
  });
});

describe('exportFile.logic / decodeBase64ToBuffer', () => {
  it('合法 base64 解码为正确字节', () => {
    // 'Hello' 的 base64
    const buf = decodeBase64ToBuffer('SGVsbG8=');
    expect(buf.toString('utf-8')).toBe('Hello');
  });

  it('空字符串解码为空 Buffer', () => {
    const buf = decodeBase64ToBuffer('');
    expect(buf.length).toBe(0);
  });

  it('二进制内容（非文本）正确解码', () => {
    // 构造 8 字节二进制：0x00 0x01 0x02 ... 0x07
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const b64 = bytes.toString('base64');
    const decoded = decodeBase64ToBuffer(b64);
    expect(decoded).toEqual(bytes);
  });

  it('非法字符静默忽略（Node Buffer.from 行为，与 handler 一致）', () => {
    // base64 字母表外的字符（如 '!' '@'）会被 Buffer.from 静默忽略，不抛错
    // 与原 handler `Buffer.from(base64Data, 'base64')` 行为一致
    const buf = decodeBase64ToBuffer('SGVsbG8=!@#');
    expect(buf.toString('utf-8')).toBe('Hello');
  });

  it('非 base64 字符串解码为尽力而为的字节（不抛错）', () => {
    // 纯文本非 base64：Buffer.from 会按 base64 字母表尽力解码
    // 此处验证不抛错且返回 Buffer（具体字节内容不强制断言）
    const buf = decodeBase64ToBuffer('not-base64-at-all');
    expect(buf).toBeInstanceOf(Buffer);
  });
});
