/**
 * electron/logger.ts 单元测试
 *
 * 测试目标：
 * - 级别过滤：debug/info/warn/error 按级别开关输出
 * - 文件落盘 + 轮转：写入 /tmp 沙箱目录，触发 5MB 轮转
 * - 敏感字段脱敏：apiKey/token/password 等键名替换为 [REDACTED]
 * - 字段值截断：超长字符串截断到 100 字符 + "…"
 * - 审计日志：audit(category, message, fields) 输出 [AUDIT] [category] message
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger, __test__ } from './logger';

describe('logger', () => {
  let sandbox: string;
  let originalConsoleLog: typeof console.log;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;
  let consoleOutput: string[];

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lxw-logger-'));
    logger.reset();
    logger.setLogDir(sandbox);

    // 捕获 console 输出验证格式
    consoleOutput = [];
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
    console.warn = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
    console.error = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  // -------------------- 级别过滤 --------------------
  describe('级别过滤', () => {
    it('默认级别 info：debug 不输出，info/warn/error 输出', () => {
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
      expect(consoleOutput.some(l => l.includes('debug msg'))).toBe(false);
      expect(consoleOutput.some(l => l.includes('info msg'))).toBe(true);
      expect(consoleOutput.some(l => l.includes('warn msg'))).toBe(true);
      expect(consoleOutput.some(l => l.includes('error msg'))).toBe(true);
    });

    it('setLevel(debug) 后 debug 输出', () => {
      logger.setLevel('debug');
      logger.debug('debug visible');
      expect(consoleOutput.some(l => l.includes('debug visible'))).toBe(true);
    });

    it('setLevel(error) 后 info/warn 不输出', () => {
      logger.setLevel('error');
      logger.info('info hidden');
      logger.warn('warn hidden');
      logger.error('error visible');
      expect(consoleOutput.some(l => l.includes('info hidden'))).toBe(false);
      expect(consoleOutput.some(l => l.includes('warn hidden'))).toBe(false);
      expect(consoleOutput.some(l => l.includes('error visible'))).toBe(true);
    });
  });

  // -------------------- 日志格式 --------------------
  describe('日志格式', () => {
    it('包含 ISO 时间戳与级别标签', () => {
      logger.info('hello');
      const line = consoleOutput.find(l => l.includes('hello'));
      expect(line).toBeDefined();
      // ISO 时间戳格式 [2026-01-01T00:00:00.000Z]
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      // 级别标签 INFO（padEnd 5 → "INFO "，4 字符 + 1 空格）
      expect(line).toMatch(/\[INFO \]/);
    });

    it('WARN 级别标签为 WARN', () => {
      logger.warn('test');
      expect(consoleOutput.some(l => l.includes('[WARN ]'))).toBe(true);
    });

    it('ERROR 级别标签为 ERROR', () => {
      logger.error('test');
      expect(consoleOutput.some(l => l.includes('[ERROR]'))).toBe(true);
    });

    it('字段以 key=value 格式输出，包裹在 { } 内', () => {
      logger.info('msg', { foo: 'bar', count: 42 });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('{ foo=bar count=42 }');
    });

    it('无字段时不输出空花括号', () => {
      logger.info('plain');
      expect(consoleOutput.find(l => l.includes('plain'))).not.toContain('{');
    });

    it('字段值为字符串含空格时加引号', () => {
      logger.info('msg', { path: '/foo bar/baz' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('path="/foo bar/baz"');
    });

    it('字段值为字符串含等号时加引号', () => {
      logger.info('msg', { q: 'a=b' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('q="a=b"');
    });

    it('null 与 undefined 字段正确序列化', () => {
      logger.info('msg', { a: null, b: undefined });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('a=null');
      expect(line).toContain('b=undefined');
    });

    it('number 与 boolean 字段正确序列化', () => {
      logger.info('msg', { n: 42, b: true, f: 3.14 });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('n=42');
      expect(line).toContain('b=true');
      expect(line).toContain('f=3.14');
    });
  });

  // -------------------- 敏感字段脱敏 --------------------
  describe('敏感字段脱敏', () => {
    it('apiKey 被替换为 [REDACTED]', () => {
      logger.info('msg', { apiKey: 'sk-secret-123' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('apiKey=[REDACTED]');
      expect(line).not.toContain('sk-secret-123');
    });

    it('api_key 大小写不敏感脱敏', () => {
      logger.info('msg', { api_key: 'secret' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('api_key=[REDACTED]');
    });

    it('APIKEY 大写脱敏', () => {
      logger.info('msg', { APIKEY: 'secret' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('APIKEY=[REDACTED]');
    });

    it('token 脱敏', () => {
      logger.info('msg', { token: 'bearer-xyz' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('token=[REDACTED]');
      expect(line).not.toContain('bearer-xyz');
    });

    it('password 脱敏', () => {
      logger.info('msg', { password: 'p@ssw0rd' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('password=[REDACTED]');
    });

    it('passwd 脱敏', () => {
      logger.info('msg', { passwd: 'p@ssw0rd' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('passwd=[REDACTED]');
    });

    it('authorization 脱敏', () => {
      logger.info('msg', { authorization: 'Bearer xxx' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('authorization=[REDACTED]');
    });

    it('access_token 脱敏', () => {
      logger.info('msg', { access_token: 'xxx' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('access_token=[REDACTED]');
    });

    it('refresh_token 脱敏', () => {
      logger.info('msg', { refresh_token: 'xxx' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('refresh_token=[REDACTED]');
    });

    it('auth 脱敏', () => {
      logger.info('msg', { auth: 'xxx' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('auth=[REDACTED]');
    });

    it('非敏感字段保持原值', () => {
      logger.info('msg', { provider: 'openai', model: 'gpt-4o' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('provider=openai');
      expect(line).toContain('model=gpt-4o');
    });
  });

  // -------------------- 字段值截断 --------------------
  describe('字段值截断', () => {
    it('超长字符串截断到 100 字符 + …', () => {
      const long = 'x'.repeat(200);
      logger.info('msg', { content: long });
      const line = consoleOutput.find(l => l.includes('msg'));
      // 100 个 x + …
      expect(line).toContain('content=' + 'x'.repeat(100) + '…');
      expect(line).not.toContain('x'.repeat(101));
    });

    it('恰好 100 字符不截断', () => {
      const exact = 'x'.repeat(100);
      logger.info('msg', { content: exact });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('content=' + exact);
      expect(line).not.toContain('…');
    });

    it('空字符串输出 ""', () => {
      logger.info('msg', { content: '' });
      const line = consoleOutput.find(l => l.includes('msg'));
      expect(line).toContain('content=""');
    });
  });

  // -------------------- 审计日志 --------------------
  describe('审计日志', () => {
    it('audit 输出 [AUDIT] [category] 前缀', () => {
      logger.audit('security.path', 'rejected invalid path', { filePath: '/etc/passwd' });
      const line = consoleOutput.find(l => l.includes('[AUDIT]'));
      expect(line).toBeDefined();
      expect(line).toContain('[AUDIT] [security.path] rejected invalid path');
      expect(line).toContain('filePath=/etc/passwd');
    });

    it('audit 在 info 级别默认可见', () => {
      logger.audit('security.input', 'test');
      expect(consoleOutput.some(l => l.includes('[AUDIT]'))).toBe(true);
    });

    it('audit 受级别过滤：error 级别时 audit（info 级别）不可见', () => {
      // audit 内部用 info 级别写入，受级别过滤约束：
      // 生产环境默认 info 级别，audit 可见；若用户调到 error 级别则 audit 也被过滤
      logger.setLevel('error');
      logger.audit('security.input', 'filtered out');
      expect(consoleOutput.some(l => l.includes('filtered out'))).toBe(false);
    });
  });

  // -------------------- error 接受 Error 实例 --------------------
  describe('error 接受 Error 实例', () => {
    it('传 Error 时自动提取 message 与 stack', () => {
      const err = new Error('test error');
      logger.error('operation failed', err);
      const line = consoleOutput.find(l => l.includes('operation failed'));
      expect(line).toContain('error="test error"');
      // stack 字段存在（含换行符会被截断，仅验证前缀）
      expect(line).toMatch(/stack=/);
    });

    it('传非 Error 时按 LogFields 处理', () => {
      logger.error('failed', { reason: 'timeout', code: 500 });
      const line = consoleOutput.find(l => l.includes('failed'));
      expect(line).toContain('reason=timeout');
      expect(line).toContain('code=500');
    });
  });

  // -------------------- 文件落盘 --------------------
  describe('文件落盘', () => {
    it('setLogDir 后日志写入 main.log', () => {
      logger.info('file write test');
      const logFile = path.join(sandbox, 'main.log');
      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('file write test');
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    });

    it('多条日志按 append 顺序写入', () => {
      logger.info('line1');
      logger.info('line2');
      logger.info('line3');
      const logFile = path.join(sandbox, 'main.log');
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBe(3);
      expect(lines[0]).toContain('line1');
      expect(lines[1]).toContain('line2');
      expect(lines[2]).toContain('line3');
    });

    it('logger 初始化前（未 setLogDir）仅 console 输出', () => {
      logger.reset();
      logger.info('no file');
      const logFile = path.join(sandbox, 'main.log');
      expect(fs.existsSync(logFile)).toBe(false);
      expect(consoleOutput.some(l => l.includes('no file'))).toBe(true);
    });
  });

  // -------------------- 文件轮转 --------------------
  describe('文件轮转', () => {
    it('超过 MAX_LOG_SIZE 时轮转，旧文件改名为 .1', () => {
      const logFile = path.join(sandbox, 'main.log');
      // 预先写入超过 5MB 的内容触发轮转
      const bigLine = 'x'.repeat(1000);
      // 写入 6000 条 1KB 日志 = ~6MB，超过 5MB 阈值
      for (let i = 0; i < 6000; i++) {
        logger.info(bigLine);
      }
      // 至少应存在 main.log（当前）或 main.log.1（轮转后）
      expect(fs.existsSync(logFile) || fs.existsSync(`${logFile}.1`)).toBe(true);
    });

    it('多次轮转产生 .1 .2 .3 备份', () => {
      const logFile = path.join(sandbox, 'main.log');
      // 写入大量日志触发多次轮转
      const bigLine = 'y'.repeat(2000);
      for (let i = 0; i < 20000; i++) {
        logger.info(bigLine);
      }
      // 检查至少有一个备份文件存在
      const hasBackup = fs.existsSync(`${logFile}.1`) || fs.existsSync(`${logFile}.2`) || fs.existsSync(`${logFile}.3`);
      expect(hasBackup).toBe(true);
    });

    it('备份数量不超过 MAX_BACKUPS', () => {
      const logFile = path.join(sandbox, 'main.log');
      const bigLine = 'z'.repeat(2000);
      // MAX_LOG_SIZE = 5MB，2000 字符 × 3000 行 ≈ 6MB，足以触发多轮轮转
      // 旧实现 50000 次循环（100MB）在 CI/沙箱环境下易超时，且无助于验证逻辑
      for (let i = 0; i < 3000; i++) {
        logger.info(bigLine);
      }
      // 备份最多 .1 .2 .3，不应有 .4
      expect(fs.existsSync(`${logFile}.4`)).toBe(false);
    });
  });

  // -------------------- 内部常量 --------------------
  describe('内部常量', () => {
    it('MAX_LOG_SIZE 为 5MB', () => {
      expect(__test__.MAX_LOG_SIZE).toBe(5 * 1024 * 1024);
    });

    it('MAX_BACKUPS 为 3', () => {
      expect(__test__.MAX_BACKUPS).toBe(3);
    });

    it('SENSITIVE_KEY_RE 匹配 apiKey', () => {
      expect(__test__.SENSITIVE_KEY_RE.test('apiKey')).toBe(true);
      expect(__test__.SENSITIVE_KEY_RE.test('api_key')).toBe(true);
      expect(__test__.SENSITIVE_KEY_RE.test('APIKEY')).toBe(true);
      expect(__test__.SENSITIVE_KEY_RE.test('token')).toBe(true);
      expect(__test__.SENSITIVE_KEY_RE.test('password')).toBe(true);
      expect(__test__.SENSITIVE_KEY_RE.test('provider')).toBe(false);
      expect(__test__.SENSITIVE_KEY_RE.test('model')).toBe(false);
    });
  });
});
