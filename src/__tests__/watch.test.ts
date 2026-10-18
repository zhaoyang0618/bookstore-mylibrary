/**
 * 文件监视测试（设计文档阶段六）。
 *
 * @module @bookstore/mylibrary-core/__tests__/watch
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryFs } from './memfs.js';
import { classifyChange, isRelevantPath, pollLibrary, watchLibrary, type LibraryChange } from '../watch.js';

describe('isRelevantPath 过滤噪声', () => {
  it('关心 library.json / 边车 / wiki', () => {
    expect(isRelevantPath('/lib/library.json')).toBe(true);
    expect(isRelevantPath('/lib/manifest.json')).toBe(true);
    expect(isRelevantPath('/lib/books/三体/三体.notes.json')).toBe(true);
    expect(isRelevantPath('/lib/wiki/pages/黑暗森林法则.md')).toBe(true);
  });

  it('忽略隐藏文件与编辑器临时文件', () => {
    expect(isRelevantPath('/lib/.DS_Store')).toBe(false);
    expect(isRelevantPath('/lib/library.json~')).toBe(false);
    expect(isRelevantPath('/lib/library.json.swp')).toBe(false);
    expect(isRelevantPath('/lib/library.json.tmp')).toBe(false);
  });

  it('忽略分片目录与删除暂存区', () => {
    expect(isRelevantPath('/lib/books/三体/recordings/v.mp4.parts/part-0001')).toBe(false);
    expect(isRelevantPath('/lib/.trash/books/三体/三体.epub')).toBe(false);
  });

  it('忽略视频本体（由 sync_state 表达）', () => {
    expect(isRelevantPath('/lib/books/三体/recordings/a.mp4')).toBe(false);
    expect(isRelevantPath('/lib/books/三体/recordings/a.webm')).toBe(false);
    expect(isRelevantPath('/lib/books/三体/recordings/a.json')).toBe(true);
  });
});

describe('classifyChange 归类', () => {
  it('按文件名与目录归类', () => {
    expect(classifyChange('/lib/library.json')).toBe('library');
    expect(classifyChange('/lib/manifest.json')).toBe('manifest');
    expect(classifyChange('/lib/books/三体/三体.notes.json')).toBe('notes');
    expect(classifyChange('/lib/wiki/pages/a.md')).toBe('wiki');
    expect(classifyChange('/lib/books/三体/recordings/a.json')).toBe('recording');
    expect(classifyChange('/lib/other.txt')).toBe('other');
  });
});

describe('watchLibrary 真实文件系统', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watch-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('写入 library.json 触发回调', async () => {
    const changes: LibraryChange[] = [];
    const handle = watchLibrary({ root: dir, onChange: (c) => changes.push(c), debounceMs: 50 });
    try {
      // 稍等让 watcher 就绪
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(join(dir, 'library.json'), '{"version":2}');
      await new Promise((r) => setTimeout(r, 400));

      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some((c) => c.kind === 'library')).toBe(true);
    } finally {
      handle.close();
    }
  });

  it('忽略不关心的文件', async () => {
    const changes: LibraryChange[] = [];
    const handle = watchLibrary({ root: dir, onChange: (c) => changes.push(c), debounceMs: 50 });
    try {
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(join(dir, 'a.mp4'), 'video');
      writeFileSync(join(dir, '.DS_Store'), 'x');
      await new Promise((r) => setTimeout(r, 400));

      expect(changes).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it('close 后不再触发', async () => {
    const changes: LibraryChange[] = [];
    const handle = watchLibrary({ root: dir, onChange: (c) => changes.push(c), debounceMs: 50 });
    await new Promise((r) => setTimeout(r, 100));
    handle.close();
    expect(handle.active).toBe(false);

    writeFileSync(join(dir, 'library.json'), '{}');
    await new Promise((r) => setTimeout(r, 300));
    expect(changes).toHaveLength(0);
  });

  it('根目录不存在时通过 onError 报告，不抛异常', () => {
    const errors: Error[] = [];
    const handle = watchLibrary({
      root: join(dir, 'nonexistent'),
      onChange: () => {},
      onError: (e) => errors.push(e),
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(handle.active).toBe(false);
  });
});

describe('pollLibrary 轮询兜底', () => {
  it('mtime 变化时触发', async () => {
    const fs = new MemoryFs();
    const root = '/lib';
    fs.writeFile(`${root}/library.json`, '{"version":1}');
    const changes: LibraryChange[] = [];
    const handle = pollLibrary({
      fs,
      root,
      onChange: (c) => changes.push(c),
      intervalMs: 40,
    });
    try {
      await new Promise((r) => setTimeout(r, 100));
      // 改内容（MemoryFs 的 mtime 用 Date.now()，需保证不同）
      await new Promise((r) => setTimeout(r, 20));
      fs.writeFile(`${root}/library.json`, '{"version":2}');
      await new Promise((r) => setTimeout(r, 200));

      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0]?.kind).toBe('library');
    } finally {
      handle.close();
    }
  });

  it('首次轮询只建立基线，不触发回调', async () => {
    const fs = new MemoryFs();
    fs.writeFile('/lib/library.json', '{}');
    const changes: LibraryChange[] = [];
    const handle = pollLibrary({ fs, root: '/lib', onChange: (c) => changes.push(c), intervalMs: 30 });
    try {
      await new Promise((r) => setTimeout(r, 100));
      expect(changes).toHaveLength(0);
    } finally {
      handle.close();
    }
  });

  it('close 后停止轮询', async () => {
    const fs = new MemoryFs();
    fs.writeFile('/lib/library.json', '{}');
    const changes: LibraryChange[] = [];
    const handle = pollLibrary({ fs, root: '/lib', onChange: (c) => changes.push(c), intervalMs: 30 });
    await new Promise((r) => setTimeout(r, 80));
    handle.close();
    expect(handle.active).toBe(false);

    fs.writeFile('/lib/library.json', '{"v":2}');
    await new Promise((r) => setTimeout(r, 150));
    expect(changes).toHaveLength(0);
  });
});
