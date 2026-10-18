/**
 * Schema 兼容性测试（设计文档 1.9）。
 *
 * @module @bookstore/mylibrary-core/__tests__/schema
 */

import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, checkSchemaCompatibility, parseSchemaVersion, SchemaVersionError } from '../schema.js';

describe('schema 版本兼容性', () => {
  it('相同版本判定为 compatible', () => {
    const check = checkSchemaCompatibility('1.0', '1.0');
    expect(check.verdict).toBe('compatible');
  });

  it('主版本不同判定为 incompatible', () => {
    const check = checkSchemaCompatibility('2.0', '1.0');
    expect(check.verdict).toBe('incompatible');
    expect(check.reason).toContain('主版本');
  });

  it('文档次版本更高判定为 incompatible（需升级客户端）', () => {
    const check = checkSchemaCompatibility('1.3', '1.0');
    expect(check.verdict).toBe('incompatible');
    expect(check.reason).toContain('升级客户端');
  });

  it('文档次版本更低判定为向后兼容', () => {
    const check = checkSchemaCompatibility('1.0', '1.2');
    expect(check.verdict).toBe('compatible-forward');
  });

  it('解析补丁版本', () => {
    expect(parseSchemaVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSchemaVersion('1.2')).toEqual([1, 2, 0]);
  });

  it('非法版本号抛出错误', () => {
    expect(() => parseSchemaVersion('abc')).toThrow(SchemaVersionError);
    const check = checkSchemaCompatibility('not-a-version');
    expect(check.verdict).toBe('incompatible');
  });

  it('当前实现的版本号是 1.0', () => {
    expect(SCHEMA_VERSION).toBe('1.0');
  });
});
