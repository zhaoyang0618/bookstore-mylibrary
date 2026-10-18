/**
 * MyLibraryStore 与扫描导入测试（设计文档 1.2 / 1.4 / 1.5 / 1.6 / 1.7 / 1.8.4 / 1.9）。
 *
 * @module @bookstore/mylibrary-core/__tests__/store
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryFs } from './memfs.js';
import { MyLibraryError, MyLibraryStore, bookFromFile } from '../store.js';
import { importBookFile, scanDirectory } from '../scanner.js';
import { createWikiPage } from '../wiki.js';
import { mergeLibraries } from '../sync.js';
import type { Book } from '../types.js';

const NOW = '2026-10-16T10:30:00Z';

function makeBook(overrides: Partial<Book> = {}): Book {
  return bookFromFile({
    id: 'uuid-1',
    title: '三体',
    author: '刘慈欣',
    relativePath: 'books/三体/三体.epub',
    sizeBytes: 1048576,
    fileHash: 'sha256:aaa',
    now: NOW,
    ...overrides,
  });
}

describe('MyLibraryStore', () => {
  let store: MyLibraryStore;

  beforeEach(() => {
    store = new MyLibraryStore('/Library', { fs: new MemoryFs(), clientId: 'test-client' });
    store.init();
  });

  it('init 创建标准目录与 manifest / library', () => {
    expect(store.fs.exists('/Library/manifest.json')).toBe(true);
    expect(store.fs.exists('/Library/library.json')).toBe(true);
    expect(store.fs.exists('/Library/books/')).toBe(true);
    expect(store.fs.exists('/Library/requests/')).toBe(true);
    expect(store.fs.exists('/Library/wiki/pages/')).toBe(true);
    expect(store.fs.exists('/Library/.trash/')).toBe(true);
    expect(store.readManifest().schema_version).toBe('1.0');
    expect(store.readLibrary().books).toEqual([]);
  });

  it('init 不覆盖已有数据', () => {
    store.addBook(makeBook());
    store.init();
    expect(store.readLibrary().books).toHaveLength(1);
  });

  it('touchClient 追加并刷新客户端', () => {
    store.touchClient({ id: 'ipad', type: 'flutter-app', platform: 'ipad' });
    expect(store.readManifest().clients).toHaveLength(1);
    store.touchClient({ id: 'ipad', type: 'flutter-app', platform: 'ipad' });
    expect(store.readManifest().clients).toHaveLength(1);
  });

  it('addBook / findBook / searchBooks', () => {
    const book = store.addBook({ ...makeBook(), tags: ['科幻'] });
    expect(store.findBook('uuid-1')?.title).toBe('三体');
    expect(store.searchBooks('刘慈欣')).toHaveLength(1);
    expect(store.searchBooks('科幻')).toHaveLength(1);
    expect(store.searchBooks('不存在的书')).toHaveLength(0);
    expect(book.sync_state.file).toBe('local_only');
    // 标签汇入 library.json 的 tags
    expect(store.readLibrary().tags.map((t) => t.name)).toEqual(['科幻']);
  });

  it('重复 id 报错', () => {
    store.addBook(makeBook());
    expect(() => store.addBook(makeBook())).toThrow(MyLibraryError);
  });

  it('updateBook 递增 version', () => {
    store.addBook(makeBook());
    const before = store.readLibrary().version;
    store.updateBook('uuid-1', { author: '刘慈欣（修订）' });
    const after = store.readLibrary();
    expect(after.version).toBe(before + 1);
    expect(after.books[0]?.author).toBe('刘慈欣（修订）');
  });

  it('笔记边车：不存在时返回空边车，写入后可读回', () => {
    const book = store.addBook(makeBook());
    const empty = store.readNotes(book);
    expect(empty.annotations).toEqual([]);
    store.addAnnotation(book, {
      id: 'anno-1',
      type: 'highlight',
      anchor: { type: 'epubcfi', value: 'epubcfi(/6/4[chap01]!/4/2/2)' },
      text: '给岁月以文明',
      color: 'yellow',
      created_at: NOW,
      updated_at: NOW,
    });
    const notes = store.readNotes(book);
    expect(notes.annotations).toHaveLength(1);
    expect(notes.version).toBe(1);
    expect(notes.book_format).toBe('epub');
  });

  it('removeAnnotation 返回是否删除成功', () => {
    const book = store.addBook(makeBook());
    store.addAnnotation(book, {
      id: 'anno-1',
      type: 'highlight',
      anchor: { type: 'epubcfi', value: 'epubcfi(/6/4)' },
      created_at: NOW,
      updated_at: NOW,
    });
    expect(store.removeAnnotation(book, 'anno-1')).toBe(true);
    expect(store.removeAnnotation(book, 'anno-1')).toBe(false);
    expect(store.readNotes(book).annotations).toHaveLength(0);
  });

  it('PDF 不使用边车（notes_path 缺失时仍可读写）', () => {
    const book = store.addBook(
      bookFromFile({ id: 'p1', title: '人类简史', author: '赫拉利', relativePath: 'books/人类简史/人类简史.pdf', sizeBytes: 100, now: NOW }),
    );
    expect(book.format).toBe('pdf');
    expect(store.readNotes(book).annotations).toEqual([]);
  });

  it('删除语义：remove_entry 删元数据留文件', () => {
    const book = store.addBook(makeBook());
    store.fs.writeFile('/Library/books/三体/三体.epub', 'binary-ish');
    store.deleteBook('uuid-1', 'remove_entry');
    expect(store.readLibrary().books).toHaveLength(0);
    expect(store.fs.exists('/Library/books/三体/三体.epub')).toBe(true);
    expect(book.id).toBe('uuid-1');
  });

  it('删除语义：delete_book 文件移到 .trash', () => {
    store.addBook(makeBook());
    store.fs.writeFile('/Library/books/三体/三体.epub', 'binary-ish');
    store.fs.writeFile('/Library/books/三体/三体.notes.json', '{}');
    store.deleteBook('uuid-1', 'delete_book');
    expect(store.readLibrary().books).toHaveLength(0);
    // 整本书的目录进入 .trash/books/{book_id}/
    expect(store.fs.exists('/Library/.trash/books/uuid-1/三体.epub')).toBe(true);
    expect(store.fs.exists('/Library/.trash/books/uuid-1/三体.notes.json')).toBe(true);
    expect(store.fs.exists('/Library/books/三体/三体.epub')).toBe(false);
  });

  it('删除语义：delete_local_only 保留元数据并改 sync_state', () => {
    const book = store.addBook(makeBook());
    store.fs.writeFile('/Library/books/三体/三体.epub', 'binary-ish');
    store.deleteBook('uuid-1', 'delete_local_only');
    const after = store.findBook('uuid-1');
    expect(after).toBeDefined();
    expect(after?.sync_state.file).toBe('local_only');
    expect(store.fs.exists('/Library/books/三体/三体.epub')).toBe(false);
    expect(book.id).toBe('uuid-1');
  });

  it('Wiki 页面读写与索引重建', () => {
    const page = createWikiPage({ id: 'w1', title: '黑暗森林法则', tags: ['三体'], sourceBooks: ['uuid-1'], now: NOW });
    store.writeWikiPage(page);
    expect(store.readWikiPage('黑暗森林法则')?.frontmatter.title).toBe('黑暗森林法则');
    store.rebuildWikiIndex();
    const index = JSON.parse(store.fs.readFile('/Library/wiki/index.json'));
    expect(index.pages).toHaveLength(1);
    expect(index.pages[0].slug).toBe('黑暗森林法则');
  });

  it('Wiki 图谱', () => {
    const a = createWikiPage({ id: 'a', title: '叶文洁', now: NOW });
    const b = { ...createWikiPage({ id: 'b', title: '黑暗森林法则', now: NOW }), frontmatter: { ...createWikiPage({ id: 'b', title: '黑暗森林法则', now: NOW }).frontmatter, links: ['叶文洁'] } };
    store.writeWikiPage(a);
    store.writeWikiPage(b);
    expect(store.buildWikiGraph().backlinks['叶文洁']).toEqual(['黑暗森林法则']);
  });

  it('录课视频元数据读写', () => {
    store.addBook(makeBook());
    store.writeRecording({
      id: 'rec-1',
      book_id: 'uuid-1',
      title: '黑暗森林法则讲解',
      file: '2026-10-16-黑暗森林解析.mp4',
      duration_seconds: 1250,
      size_bytes: 158000000,
      created_at: NOW,
      created_by: 'flutter-ipad-uuid',
      linked_wiki_pages: ['黑暗森林法则'],
    });
    const recordings = store.listRecordings(store.findBook('uuid-1')!);
    expect(recordings).toHaveLength(1);
    expect(recordings[0]?.file).toBe('2026-10-16-黑暗森林解析.mp4');
  });

  it('大文件分片目录按书籍目录定位（1.8.6）', () => {
    const book = store.addBook(makeBook());
    // 与 writeRecording 的落点一致：books/{书名}/recordings/，而不是 books/{id}/
    expect(store.partsDir('video.mp4', book)).toBe('/Library/books/三体/recordings/video.mp4.parts');
  });

  it('同步请求队列', () => {
    store.addBook(makeBook());
    store.writeSyncRequest({ id: 'sync-req-1', book_id: 'uuid-1', requested_by: 'ipad', requested_at: NOW, status: 'pending' });
    expect(store.listSyncRequests()).toHaveLength(1);
    store.fulfillSyncRequest('sync-req-1');
    expect(store.listSyncRequests()).toHaveLength(0);
  });

  it('迁移前自动备份到 .trash（1.9）', () => {
    store.fs.writeFile('/Library/library.json', JSON.stringify({ ...store.readLibrary(), schema_version: '1.1' }));
    const result = store.migrate();
    expect(result.migrated).toContain('library.json');
    expect(result.backedUpTo).toMatch(/\.trash\/schema-migration-\d{4}-\d{2}-\d{2}/);
    expect(store.readLibrary().schema_version).toBe('1.0');
  });

  it('schema 不兼容时读取报错', () => {
    store.fs.writeFile('/Library/library.json', JSON.stringify({ ...store.readLibrary(), schema_version: '2.0' }));
    expect(() => store.readLibrary()).toThrow(/schema_version 不兼容/);
  });

  it('非 JSON 内容报 JSON_PARSE_FAILED', () => {
    store.fs.writeFile('/Library/library.json', 'not json');
    expect(() => store.readLibrary()).toThrow(/不是合法 JSON/);
  });

  it('读取不存在的文件报 FILE_NOT_FOUND', () => {
    const empty = new MyLibraryStore('/Empty', { fs: new MemoryFs(), clientId: 'x' });
    expect(() => empty.readManifest()).toThrow(MyLibraryError);
  });
});

describe('scanDirectory + importBookFile（2.5 / 3.4）', () => {
  let store: MyLibraryStore;

  beforeEach(() => {
    store = new MyLibraryStore('/Library', { fs: new MemoryFs(), clientId: 'test-client' });
    store.init();
  });

  it('扫描目录树找出书籍文件并跳过元数据', () => {
    store.fs.writeFile('/src/三体.epub', 'epub-content');
    store.fs.writeFile('/src/人类简史.pdf', 'pdf-content');
    store.fs.writeFile('/src/notes.md', 'md-content');
    store.fs.writeFile('/src/三体.notes.json', '{}');
    store.fs.writeFile('/src/三体.epub.lock.json', '{}');
    store.fs.writeFile('/src/cover.png', 'png');
    store.fs.writeFile('/src/.hidden.epub', 'x');
    store.fs.writeFile('/src/video.mp4.parts/part-0001', 'x');
    const result = scanDirectory(store.fs, '/src');
    expect(result.books.map((b) => b.fileName).sort()).toEqual(['notes.md', '三体.epub', '人类简史.pdf']);
    expect(result.skipped.some((s) => s.reason === '元数据 / 锁文件')).toBe(true);
    expect(result.skipped.some((s) => s.reason === '分片上传临时目录')).toBe(true);
    expect(result.skipped.some((s) => s.reason === '隐藏文件或目录')).toBe(true);
    expect(result.skipped.some((s) => s.reason === '不支持的扩展名')).toBe(true);
  });

  it('导入：复制到 books/{title}/ 并登记元数据', () => {
    store.fs.writeFile('/src/三体.epub', 'epub-content');
    const [scanned] = scanDirectory(store.fs, '/src').books;
    const book = importBookFile(store, scanned!, { author: '刘慈欣', makeId: () => 'uuid-1' });
    expect(book.relative_path).toBe('books/三体/三体.epub');
    expect(store.fs.readFile('/Library/books/三体/三体.epub')).toBe('epub-content');
    expect(store.fs.exists('/Library/books/三体/recordings/')).toBe(true);
    expect(store.findBook('uuid-1')?.format).toBe('epub');
  });
});

describe('端到端：两个客户端读写同一份数据（第四部分）', () => {
  it('Mac 端导入的书，iPad 端图书馆可见', () => {
    const fs = new MemoryFs();
    const mac = new MyLibraryStore('/Library', { fs, clientId: 'dsh-macos-uuid' });
    const ipad = new MyLibraryStore('/Library', { fs, clientId: 'flutter-ipad-uuid' });
    mac.init();
    ipad.init();

    // Mac 端导入
    fs.writeFile('/src/三体.epub', 'epub-content');
    const [scanned] = scanDirectory(fs, '/src').books;
    importBookFile(mac, scanned!, { author: '刘慈欣', makeId: () => 'uuid-1' });

    // iPad 端读到同一本书，并追加自己的阅读位置
    const book = ipad.findBook('uuid-1')!;
    ipad.updateBook('uuid-1', {
      reading_position: { position: 'epubcfi(/6/4[chap03])', percentage: 0.62, updated_at: NOW, updated_by: 'flutter-ipad-uuid' },
      held_by: [{ client_id: 'flutter-ipad-uuid', last_seen: NOW }],
    });
    expect(mac.findBook('uuid-1')?.reading_position?.percentage).toBe(0.62);

    // iPad 端写 Wiki，Mac 端可见
    ipad.writeWikiPage(createWikiPage({ id: 'w1', title: '黑暗森林法则', sourceBooks: ['uuid-1'], now: NOW }));
    expect(mac.readWikiPage('黑暗森林法则')?.frontmatter.source_books).toEqual(['uuid-1']);
  });

  it('本地与网盘两份 library.json 合并', () => {
    const fs = new MemoryFs();
    const local = new MyLibraryStore('/Local', { fs, clientId: 'local' });
    const remote = new MyLibraryStore('/Remote', { fs, clientId: 'remote' });
    local.init();
    remote.init();
    local.addBook(makeBook({ id: 'a', title: '三体' }));
    remote.addBook(makeBook({ id: 'b', title: '人类简史', relative_path: 'books/人类简史/人类简史.pdf' }));
    const merged = mergeLibraries(local.readLibrary(), remote.readLibrary());
    expect(merged.value.books.map((b) => b.id).sort()).toEqual(['a', 'b']);
    expect(merged.hasUnresolvedConflicts).toBe(false);
  });
});

describe('真实文件系统（nodeFs）往返', () => {
  let dir: string;
  let store: MyLibraryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mylibrary-'));
    store = new MyLibraryStore(dir, { clientId: 'node-test' });
    store.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('落盘后可被重新打开', () => {
    store.addBook(makeBook());
    store.writeWikiPage(createWikiPage({ id: 'w1', title: '面壁计划', now: NOW }));
    const reopened = new MyLibraryStore(dir, { clientId: 'node-test-2' });
    expect(reopened.findBook('uuid-1')?.title).toBe('三体');
    expect(reopened.readWikiPage('面壁计划')).toBeDefined();
  });
});
