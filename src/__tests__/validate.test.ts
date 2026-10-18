/**
 * Schema 校验器测试（设计文档 1.3 / 1.4 / 1.5 / 1.6 / 1.7 / 1.8.4）。
 *
 * @module @bookstore/mylibrary-core/__tests__/validate
 */

import { describe, expect, it } from 'vitest';

import {
  validateLibrary,
  validateManifest,
  validateNotes,
  validateRecording,
  validateSyncRequest,
  validateWikiIndex,
} from '../validate.js';

const NOW = '2026-10-16T10:30:00Z';

function validManifest(): unknown {
  return {
    schema_version: '1.0',
    library_version: 42,
    updated_at: NOW,
    updated_by: 'dsh-macos-uuid',
    clients: [
      { id: 'dsh-macos-uuid', type: 'dsh-extension', platform: 'macos', last_seen: NOW },
      { id: 'flutter-ipad-uuid', type: 'flutter-app', platform: 'ipad', last_seen: NOW },
    ],
  };
}

function validBook(): unknown {
  return {
    id: 'uuid-1',
    title: '三体',
    author: '刘慈欣',
    format: 'epub',
    relative_path: 'books/三体/三体.epub',
    cover_path: 'books/三体/cover.jpg',
    notes_path: 'books/三体/三体.notes.json',
    recordings_dir: 'books/三体/recordings/',
    size_bytes: 1048576,
    file_hash: 'sha256:abc',
    added_at: '2026-10-01T00:00:00Z',
    sync_state: { metadata: 'synced', cover: 'synced', notes: 'synced', file: 'local_only', recordings: 'local_only' },
    held_by: [{ client_id: 'dsh-macos-uuid', last_seen: NOW }],
    reading_position: {
      position: 'epubcfi(/6/4[chap01]!/4/2/2)',
      percentage: 0.35,
      updated_at: NOW,
      updated_by: 'flutter-ipad-uuid',
    },
    tags: ['科幻', '中文'],
    collections: ['待读'],
    linked_wiki_pages: ['san-ti-ren-wu-guan-xi', 'dark-forest'],
  };
}

describe('validateManifest', () => {
  it('接受文档中的合法 manifest', () => {
    const report = validateManifest(validManifest());
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('拒绝 schema_version 不兼容', () => {
    const report = validateManifest({ ...validManifest() as object, schema_version: '2.0' });
    expect(report.ok).toBe(false);
    expect(report.issues[0]?.message).toContain('主版本');
  });

  it('拒绝缺少 clients', () => {
    const manifest = validManifest() as Record<string, unknown>;
    delete manifest['clients'];
    const report = validateManifest(manifest);
    expect(report.ok).toBe(false);
  });

  it('拒绝非法时间戳', () => {
    const report = validateManifest({ ...validManifest() as object, updated_at: '昨天' });
    expect(report.ok).toBe(false);
  });

  it('拒绝非对象根', () => {
    expect(validateManifest([]).ok).toBe(false);
    expect(validateManifest('x').ok).toBe(false);
  });
});

describe('validateLibrary', () => {
  it('接受文档中的合法 library.json', () => {
    const report = validateLibrary({
      schema_version: '1.0',
      version: 42,
      updated_at: NOW,
      updated_by: 'dsh-macos-uuid',
      books: [validBook()],
      collections: [],
      tags: [],
    });
    expect(report.ok).toBe(true);
  });

  it('检测重复的书籍 id', () => {
    const report = validateLibrary({
      schema_version: '1.0',
      version: 1,
      updated_at: NOW,
      updated_by: 'x',
      books: [validBook(), validBook()],
      collections: [],
      tags: [],
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.message.includes('id 重复'))).toBe(true);
  });

  it('拒绝非法的 sync_state 值', () => {
    const book = validBook() as Record<string, unknown>;
    book['sync_state'] = { metadata: 'synced', cover: 'synced', notes: 'synced', file: 'everywhere', recordings: 'synced' };
    const report = validateLibrary({
      schema_version: '1.0',
      version: 1,
      updated_at: NOW,
      updated_by: 'x',
      books: [book],
      collections: [],
      tags: [],
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.path === '/books/0/sync_state/file')).toBe(true);
  });

  it('拒绝 percentage 越界', () => {
    const book = validBook() as Record<string, unknown>;
    (book['reading_position'] as Record<string, unknown>)['percentage'] = 1.5;
    const report = validateLibrary({
      schema_version: '1.0',
      version: 1,
      updated_at: NOW,
      updated_by: 'x',
      books: [book],
      collections: [],
      tags: [],
    });
    expect(report.ok).toBe(false);
  });

  it('拒绝不支持的 format', () => {
    const book = validBook() as Record<string, unknown>;
    book['format'] = 'mobi';
    const report = validateLibrary({
      schema_version: '1.0',
      version: 1,
      updated_at: NOW,
      updated_by: 'x',
      books: [book],
      collections: [],
      tags: [],
    });
    expect(report.ok).toBe(false);
  });

  it('缺少 version 报错', () => {
    const report = validateLibrary({ schema_version: '1.0', updated_at: NOW, updated_by: 'x', books: [], collections: [], tags: [] });
    expect(report.ok).toBe(false);
  });
});

describe('validateNotes', () => {
  it('接受 EPUB 高亮批注', () => {
    const report = validateNotes({
      schema_version: '1.0',
      book_id: 'uuid-1',
      book_format: 'epub',
      version: 5,
      updated_at: NOW,
      updated_by: 'flutter-ipad-uuid',
      annotations: [
        {
          id: 'anno-1',
          type: 'highlight',
          anchor: { type: 'epubcfi', value: 'epubcfi(/6/4[chap01]!/4/2/2,/1:0,/1:42)' },
          text: '黑暗森林法则的核心是...',
          note: '这里与费米悖论呼应',
          color: 'yellow',
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it('接受 ink 矢量笔迹', () => {
    const report = validateNotes({
      schema_version: '1.0',
      book_id: 'uuid-1',
      book_format: 'pdf',
      version: 1,
      updated_at: NOW,
      updated_by: 'x',
      annotations: [
        {
          id: 'anno-2',
          type: 'ink',
          anchor: { type: 'ink', page: 3 },
          strokes: [{ points: [{ x: 100, y: 200, pressure: 0.5, t: 0 }], color: '#FF0000', width: 2.0 }],
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    });
    expect(report.ok).toBe(true);
  });

  it('拒绝 line_range 起止行号颠倒', () => {
    const report = validateNotes({
      schema_version: '1.0',
      book_id: 'uuid-1',
      book_format: 'markdown',
      version: 1,
      updated_at: NOW,
      updated_by: 'x',
      annotations: [
        {
          id: 'a',
          type: 'note',
          anchor: { type: 'line_range', start_line: 10, end_line: 2, text_hash: 'sha256:x' },
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    });
    expect(report.ok).toBe(false);
  });

  it('检测重复的批注 id', () => {
    const annotation = {
      id: 'dup',
      type: 'highlight',
      anchor: { type: 'epubcfi', value: 'epubcfi(/6/4)' },
      created_at: NOW,
      updated_at: NOW,
    };
    const report = validateNotes({
      schema_version: '1.0',
      book_id: 'uuid-1',
      book_format: 'epub',
      version: 1,
      updated_at: NOW,
      updated_by: 'x',
      annotations: [annotation, annotation],
    });
    expect(report.ok).toBe(false);
  });
});

describe('validateRecording / validateSyncRequest / validateWikiIndex', () => {
  it('接受录课视频元数据', () => {
    const report = validateRecording({
      id: 'rec-1',
      book_id: 'uuid-1',
      title: '黑暗森林法则讲解',
      file: '2026-10-16-黑暗森林解析.mp4',
      duration_seconds: 1250,
      size_bytes: 158000000,
      created_at: NOW,
      created_by: 'flutter-ipad-uuid',
      position_at_start: 'epubcfi(/6/4[chap05]!/4/2/2)',
      position_at_end: 'epubcfi(/6/4[chap05]!/4/10/2)',
      linked_wiki_pages: ['dark-forest'],
      transcript: '本次讲解主要讨论了...',
    });
    expect(report.ok).toBe(true);
  });

  it('拒绝 duration_seconds 非整数', () => {
    const report = validateRecording({
      id: 'rec-1',
      book_id: 'uuid-1',
      title: 't',
      file: 'f.mp4',
      duration_seconds: 1.5,
      size_bytes: 1,
      created_at: NOW,
      created_by: 'x',
      linked_wiki_pages: [],
    });
    expect(report.ok).toBe(false);
  });

  it('接受 pending 同步请求', () => {
    const report = validateSyncRequest({
      id: 'sync-req-uuid-1',
      book_id: 'uuid-1',
      requested_by: 'flutter-ipad-uuid',
      requested_at: NOW,
      status: 'pending',
    });
    expect(report.ok).toBe(true);
  });

  it('拒绝未知 status', () => {
    const report = validateSyncRequest({
      id: 'x',
      book_id: 'uuid-1',
      requested_by: 'x',
      requested_at: NOW,
      status: 'maybe',
    });
    expect(report.ok).toBe(false);
  });

  it('接受 wiki 索引并检测 slug 重复', () => {
    const entry = {
      id: 'w1',
      slug: 'dark-forest',
      title: '黑暗森林法则',
      path: 'dark-forest.md',
      updated_at: NOW,
      tags: [],
      source_books: [],
      links: [],
    };
    expect(validateWikiIndex({ schema_version: '1.0', updated_at: NOW, pages: [entry] }).ok).toBe(true);
    const dup = validateWikiIndex({ schema_version: '1.0', updated_at: NOW, pages: [entry, entry] });
    expect(dup.ok).toBe(false);
    expect(dup.issues.some((issue) => issue.message.includes('slug 重复'))).toBe(true);
  });
});
