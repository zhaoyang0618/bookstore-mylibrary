/**
 * MyLibrary 目录的文件系统访问层。
 *
 * 这一层只依赖 `node:fs`，不引入任何宿主框架，因此 dsh 工具插件（Node）、
 * CLI、以及未来的 Flutter 版（通过子进程调用 CLI）都能复用同一份逻辑。
 *
 * @module @bookstore/mylibrary-core/store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import {
  BOOKS_DIR,
  LIBRARY_FILE,
  MANIFEST_FILE,
  MIGRATION_BACKUP_PREFIX,
  PARTS_SUFFIX,
  RECORDINGS_DIRNAME,
  REQUESTS_DIR,
  TRASH_DIR,
  WIKI_DIR,
  WIKI_INDEX_FILE,
} from './layout.js';
import { SCHEMA_VERSION, assertSchemaCompatible } from './schema.js';
import { planDelete } from './sync.js';
import { validateDocument, validateLibrary, validateManifest, validateNotes, validateSyncRequest, type ValidationReport } from './validate.js';
import { parseWikiPage, rebuildWikiIndex, stringifyWikiPage, type WikiGraph, buildWikiGraph } from './wiki.js';
import type {
  Annotation,
  Book,
  BookFormat,
  DeleteOperation,
  Library,
  Manifest,
  NotesSidecar,
  Recording,
  SyncRequest,
  WikiPage,
} from './types.js';

/** 文件系统访问接口（便于测试时替换）。 */
export interface FileSystem {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
  listDir(path: string): string[];
  stat(path: string): { size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean } | undefined;
  remove(path: string): void;
  rename(from: string, to: string): void;
}

/** 基于 `node:fs` 的默认实现。 */
export const nodeFs: FileSystem = {
  exists: (path) => existsSync(path),
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  },
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
  listDir: (path) => {
    if (!existsSync(path)) return [];
    return readdirSync(path);
  },
  stat: (path) => {
    if (!existsSync(path)) return undefined;
    const info = statSync(path);
    return { size: info.size, mtimeMs: info.mtimeMs, isFile: info.isFile(), isDirectory: info.isDirectory() };
  },
  remove: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
  rename: (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  },
};

/** 数据层抛出的可预期错误。 */
export class MyLibraryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MyLibraryError';
    this.code = code;
  }
}

/** 打开 / 初始化一个 MyLibrary 目录的入口。 */
export class MyLibraryStore {
  readonly root: string;
  readonly fs: FileSystem;
  /** 本客户端 id。 */
  clientId: string;

  constructor(root: string, options: { fs?: FileSystem; clientId?: string } = {}) {
    this.root = resolve(root);
    this.fs = options.fs ?? nodeFs;
    this.clientId = options.clientId ?? 'anonymous-client';
  }

  // ---------- 初始化（1.2） ----------

  /** 创建标准目录结构；已存在的目录不覆盖。 */
  init(): void {
    this.fs.mkdir(join(this.root, BOOKS_DIR));
    this.fs.mkdir(join(this.root, REQUESTS_DIR));
    this.fs.mkdir(join(this.root, WIKI_DIR, 'pages'));
    this.fs.mkdir(join(this.root, WIKI_DIR, 'attachments', 'images'));
    this.fs.mkdir(join(this.root, TRASH_DIR));
    if (!this.fs.exists(this.manifestPath())) {
      this.writeManifest({
        schema_version: '1.0',
        library_version: 1,
        updated_at: new Date().toISOString(),
        updated_by: this.clientId,
        clients: [],
      });
    }
    if (!this.fs.exists(this.libraryPath())) {
      this.writeLibrary({
        schema_version: '1.0',
        version: 1,
        updated_at: new Date().toISOString(),
        updated_by: this.clientId,
        books: [],
        collections: [],
        tags: [],
      });
    }
  }

  manifestPath(): string {
    return join(this.root, MANIFEST_FILE);
  }

  libraryPath(): string {
    return join(this.root, LIBRARY_FILE);
  }

  // ---------- manifest.json（1.3） ----------

  readManifest(): Manifest {
    return this.readJson(this.manifestPath(), validateManifest, 'manifest.json');
  }

  writeManifest(manifest: Manifest): void {
    this.writeJson(this.manifestPath(), manifest);
  }

  /** 记录本客户端上线。 */
  touchClient(client: Omit<Manifest['clients'][number], 'last_seen'> = {
    id: this.clientId,
    type: 'cli',
    platform: 'macos',
  }): Manifest {
    const manifest = this.readManifest();
    const now = new Date().toISOString();
    const existing = manifest.clients.find((entry) => entry.id === client.id);
    const clients = existing === undefined
      ? [...manifest.clients, { ...client, last_seen: now }]
      : manifest.clients.map((entry) => (entry.id === client.id ? { ...entry, ...client, last_seen: now } : entry));
    const next: Manifest = { ...manifest, updated_at: now, updated_by: client.id, clients };
    this.writeManifest(next);
    return next;
  }

  // ---------- library.json（1.4） ----------

  readLibrary(): Library {
    return this.readJson(this.libraryPath(), validateLibrary, 'library.json');
  }

  writeLibrary(library: Library): void {
    this.writeJson(this.libraryPath(), library);
  }

  /** 按 id 找书。 */
  findBook(id: string): Book | undefined {
    return this.readLibrary().books.find((book) => book.id === id);
  }

  /** 按标题模糊搜索。 */
  searchBooks(query: string): Book[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return this.readLibrary().books.filter((book) => {
      const haystack = [book.title, book.author, ...(book.tags ?? []), ...(book.collections ?? [])].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }

  /** 新增一本书（幂等：同 id 已存在则报错）。 */
  addBook(book: Book): Book {
    const library = this.readLibrary();
    if (library.books.some((existing) => existing.id === book.id)) {
      throw new MyLibraryError('BOOK_EXISTS', `书籍 id 已存在：${book.id}`);
    }
    const next: Library = {
      ...library,
      version: library.version + 1,
      updated_at: new Date().toISOString(),
      updated_by: this.clientId,
      books: [...library.books, book],
      tags: mergeTags(library.tags, book.tags ?? []),
    };
    this.writeLibrary(next);
    return book;
  }

  /** 更新一本书。 */
  updateBook(id: string, patch: Partial<Book>): Book {
    const library = this.readLibrary();
    const index = library.books.findIndex((book) => book.id === id);
    if (index < 0) throw new MyLibraryError('BOOK_NOT_FOUND', `书籍不存在：${id}`);
    const current = library.books[index]!;
    const updated: Book = { ...current, ...patch, id: current.id };
    const books = [...library.books];
    books[index] = updated;
    this.writeLibrary({
      ...library,
      version: library.version + 1,
      updated_at: new Date().toISOString(),
      updated_by: this.clientId,
      books,
    });
    return updated;
  }

  /** 按设计文档 1.8.5 的删除语义删除书籍。 */
  deleteBook(id: string, operation: DeleteOperation): void {
    const library = this.readLibrary();
    const book = library.books.find((entry) => entry.id === id);
    if (book === undefined) throw new MyLibraryError('BOOK_NOT_FOUND', `书籍不存在：${id}`);
    const plan = planDelete(operation);
    // 书籍目录 = 文件本体所在的目录（一本书的所有资产都在这里）
    const bookDir = this.absolutePath(book.relative_path).replace(/\/[^/]*$/, '');
    if (operation === 'delete_book') {
      this.fs.rename(bookDir, join(this.root, TRASH_DIR, 'books', book.id));
    } else if (plan.file === 'delete') {
      this.fs.remove(bookDir);
    }
    if (plan.metadata === 'delete') {
      this.writeLibrary({
        ...library,
        version: library.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: this.clientId,
        books: library.books.filter((entry) => entry.id !== id),
      });
    } else {
      this.updateBook(id, {
        sync_state: { ...book.sync_state, file: plan.nextFileSyncState ?? 'local_only' },
        held_by: book.held_by.filter((holder) => holder.client_id !== this.clientId),
      });
    }
  }

  /** 把相对路径解析为绝对路径。 */
  absolutePath(relativePath: string): string {
    return resolve(this.root, relativePath);
  }

  // ---------- 笔记边车（1.5） ----------

  /** 读取某本书的笔记边车（不存在时返回空边车）。 */
  readNotes(book: Book): NotesSidecar {
    const path = book.notes_path ? this.absolutePath(book.notes_path) : this.defaultNotesPath(book);
    if (!this.fs.exists(path)) {
      return {
        schema_version: '1.0',
        book_id: book.id,
        book_format: book.format,
        version: 0,
        updated_at: new Date().toISOString(),
        updated_by: this.clientId,
        annotations: [],
      };
    }
    return this.readJson(path, validateNotes, 'notes sidecar');
  }

  /** 写入某本书的笔记边车。 */
  writeNotes(book: Book, notes: NotesSidecar): NotesSidecar {
    const path = book.notes_path ? this.absolutePath(book.notes_path) : this.defaultNotesPath(book);
    const next: NotesSidecar = {
      ...notes,
      schema_version: '1.0',
      book_id: book.id,
      book_format: book.format,
      version: notes.version + 1,
      updated_at: new Date().toISOString(),
      updated_by: this.clientId,
    };
    this.writeJson(path, next);
    return next;
  }

  /** 追加一条批注。 */
  addAnnotation(book: Book, annotation: Annotation): Annotation {
    const notes = this.readNotes(book);
    const next: NotesSidecar = { ...notes, annotations: [...notes.annotations, annotation] };
    this.writeNotes(book, next);
    return annotation;
  }

  /** 删除一条批注。 */
  removeAnnotation(book: Book, annotationId: string): boolean {
    const notes = this.readNotes(book);
    const annotations = notes.annotations.filter((annotation) => annotation.id !== annotationId);
    if (annotations.length === notes.annotations.length) return false;
    this.writeNotes(book, { ...notes, annotations });
    return true;
  }

  private defaultNotesPath(book: Book): string {
    const base = book.relative_path.replace(/\.[^./]+$/, '');
    return `${base}.notes.json`;
  }

  // ---------- Wiki（1.6） ----------

  /** 列出全部 Wiki 页面。 */
  listWikiPages(): WikiPage[] {
    const dir = join(this.root, WIKI_DIR, 'pages');
    const pages: WikiPage[] = [];
    for (const name of this.fs.listDir(dir)) {
      if (!name.endsWith('.md')) continue;
      const path = join(dir, name);
      const info = this.fs.stat(path);
      if (info === undefined || !info.isFile) continue;
      try {
        pages.push(parseWikiPage(this.fs.readFile(path), name));
      } catch (error) {
        throw new MyLibraryError('WIKI_PARSE_FAILED', `解析 ${name} 失败：${(error as Error).message}`);
      }
    }
    return pages;
  }

  /** 按 slug 读一个 Wiki 页面。 */
  readWikiPage(slug: string): WikiPage | undefined {
    return this.listWikiPages().find((page) => page.frontmatter.slug === slug);
  }

  /** 写入一个 Wiki 页面（按 slug 命名）。 */
  writeWikiPage(page: WikiPage): WikiPage {
    const path = join(this.root, WIKI_DIR, 'pages', page.relativePath);
    this.fs.writeFile(path, stringifyWikiPage(page));
    return page;
  }

  /** 重建 wiki/index.json。 */
  rebuildWikiIndex(): void {
    const pages = this.listWikiPages();
    const index = rebuildWikiIndex(pages, new Date().toISOString());
    this.fs.writeFile(join(this.root, WIKI_DIR, WIKI_INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
  }

  /** 构建 Wiki 图谱。 */
  buildWikiGraph(): WikiGraph {
    return buildWikiGraph(this.listWikiPages());
  }

  // ---------- 录课视频（1.7） ----------

  /** 列出某本书的录课视频元数据。 */
  listRecordings(book: Book): Recording[] {
    const dir = book.recordings_dir ? this.absolutePath(book.recordings_dir) : undefined;
    if (dir === undefined || !this.fs.exists(dir)) return [];
    const recordings: Recording[] = [];
    for (const name of this.fs.listDir(dir)) {
      if (!name.endsWith('.json') || name.endsWith('.parts.json')) continue;
      if (name === 'upload.json') continue;
      try {
        recordings.push(this.readJson(join(dir, name), (value) => validateDocument('recording', value), 'recording'));
      } catch (error) {
        throw new MyLibraryError('RECORDING_PARSE_FAILED', `解析 ${name} 失败：${(error as Error).message}`);
      }
    }
    return recordings;
  }

  /** 写入一条录课视频元数据（与视频文件同名）。 */
  writeRecording(recording: Recording): Recording {
    const book = this.findBook(recording.book_id);
    const base = book !== undefined ? book.relative_path.replace(/\/[^/]*$/, '') : `${BOOKS_DIR}/${recording.book_id}`;
    const dir = `${this.absolutePath(base)}/${RECORDINGS_DIRNAME}`;
    const jsonName = recording.file.replace(/\.[^.]+$/, '.json');
    this.fs.writeFile(join(dir, jsonName), `${JSON.stringify(recording, null, 2)}\n`);
    return recording;
  }

  /** 大文件分片上传的进度文件（1.8.6）。 */
  partsDir(fileName: string, bookId: string): string {
    return join(this.root, BOOKS_DIR, bookId, RECORDINGS_DIRNAME, `${fileName}${PARTS_SUFFIX}`);
  }

  // ---------- 同步请求队列（1.8.4） ----------

  /** 列出全部同步请求。 */
  listSyncRequests(): SyncRequest[] {
    const dir = join(this.root, REQUESTS_DIR);
    const requests: SyncRequest[] = [];
    for (const name of this.fs.listDir(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        requests.push(this.readJson(join(dir, name), validateSyncRequest, 'sync request'));
      } catch (error) {
        throw new MyLibraryError('SYNC_REQUEST_PARSE_FAILED', `解析 ${name} 失败：${(error as Error).message}`);
      }
    }
    return requests;
  }

  /** 写入一条同步请求。 */
  writeSyncRequest(request: SyncRequest): SyncRequest {
    const path = join(this.root, REQUESTS_DIR, `${request.id}.json`);
    this.fs.writeFile(path, `${JSON.stringify(request, null, 2)}\n`);
    return request;
  }

  /** 完成一条同步请求（删除请求文件）。 */
  fulfillSyncRequest(requestId: string): void {
    this.fs.remove(join(this.root, REQUESTS_DIR, `${requestId}.json`));
  }

  // ---------- 迁移（1.9） ----------

  /**
   * 迁移到当前 schema 版本。迁移前自动备份到 `.trash/schema-migration-{date}/`。
   *
   * 与 {@link readManifest} / {@link readLibrary} 不同，这里允许读取**次版本更高**的文档
   * （那是迁移的唯一场景），只备份 + 改写 `schema_version`，不改动其它内容。
   */
  migrate(): { backedUpTo: string | undefined; migrated: string[] } {
    const migrated: string[] = [];
    let backedUpTo: string | undefined;
    const backupIfNeeded = (path: string): void => {
      if (!this.fs.exists(path)) return;
      if (backedUpTo === undefined) {
        const stamp = new Date().toISOString().slice(0, 10);
        backedUpTo = join(this.root, TRASH_DIR, `${MIGRATION_BACKUP_PREFIX}${stamp}`);
      }
      const target = join(backedUpTo, relative(this.root, path));
      this.fs.rename(path, target);
    };
    const migrateFile = (
      path: string,
      validator: (value: unknown) => ValidationReport,
      subject: string,
      label: string,
    ): void => {
      if (!this.fs.exists(path)) return;
      // 迁移校验器只检查结构，把 schema 版本差异当作 warning 而不是 error，
      // 否则次版本更高的文档在读阶段就会抛错，永远走不到迁移。
      const permissive: (value: unknown) => ValidationReport = (value) => {
        const report = validator(value);
        // 先把 schema 版本相关的 error 降级为 warning，再基于降级后的 issues 计算 ok
        const issues = report.issues.map((issue) =>
          issue.severity === 'error' && issue.message.includes('schema_version') ? { ...issue, severity: 'warning' as const } : issue,
        );
        return {
          subject: report.subject,
          ok: issues.every((issue) => issue.severity !== 'error'),
          issues,
        };
      };
      const parsed = this.readJsonRaw(path, permissive, subject) as { schema_version?: string };
      if (parsed.schema_version === SCHEMA_VERSION) return;
      backupIfNeeded(path);
      this.writeJson(path, { ...parsed, schema_version: SCHEMA_VERSION });
      migrated.push(label);
    };
    migrateFile(this.manifestPath(), validateManifest, 'manifest.json', 'manifest.json');
    migrateFile(this.libraryPath(), validateLibrary, 'library.json', 'library.json');
    return { backedUpTo, migrated };
  }

  // ---------- 内部工具 ----------

  private readJson<T>(path: string, validator: (value: unknown) => ValidationReport, subject: string): T {
    if (!this.fs.exists(path)) {
      throw new MyLibraryError('FILE_NOT_FOUND', `${subject} 不存在：${path}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fs.readFile(path));
    } catch (error) {
      throw new MyLibraryError('JSON_PARSE_FAILED', `${subject} 不是合法 JSON：${(error as Error).message}`);
    }
    const report = validator(parsed);
    if (!report.ok) {
      const errors = report.issues.filter((issue) => issue.severity === 'error');
      throw new MyLibraryError('SCHEMA_INVALID', `${subject} 校验失败：${errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
    }
    assertSchemaCompatible((parsed as { schema_version?: string }).schema_version ?? '1.0');
    return parsed as T;
  }

  /**
   * 解析 + 结构校验，但**不做 schema 兼容性断言**。
   * 迁移流程需要读取次版本更高的文档，因此单独走这条路。
   */
  private readJsonRaw<T>(path: string, validator: (value: unknown) => ValidationReport, subject: string): T {
    if (!this.fs.exists(path)) {
      throw new MyLibraryError('FILE_NOT_FOUND', `${subject} 不存在：${path}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fs.readFile(path));
    } catch (error) {
      throw new MyLibraryError('JSON_PARSE_FAILED', `${subject} 不是合法 JSON：${(error as Error).message}`);
    }
    const report = validator(parsed);
    if (!report.ok) {
      const errors = report.issues.filter((issue) => issue.severity === 'error');
      throw new MyLibraryError('SCHEMA_INVALID', `${subject} 校验失败：${errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
    }
    return parsed as T;
  }

  private writeJson(path: string, value: unknown): void {
    this.fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }
}

/** 合并标签：新增书籍上的标签进入 library.json 的 tags。 */
function mergeTags(existing: Library['tags'], incoming: string[]): Library['tags'] {
  const now = new Date().toISOString();
  const byName = new Map(existing.map((tag) => [tag.name, tag]));
  for (const name of incoming) {
    if (!byName.has(name)) byName.set(name, { name, created_at: now });
  }
  return [...byName.values()];
}

/** 从已有文件提取书籍元数据（设计文档 2.5 / 3.4 的本地导入流程）。 */
export function bookFromFile(options: {
  id: string;
  title: string;
  author: string;
  relativePath: string;
  sizeBytes: number;
  format?: BookFormat;
  fileHash?: string;
  now?: string;
}): Book {
  const now = options.now ?? new Date().toISOString();
  const format = options.format ?? inferFormat(options.relativePath);
  // 设计文档 1.2：一本书的所有资产都在 `books/{书名}/` 目录下，
  // 因此 cover / notes / recordings 都相对**书籍目录**而非文件主干名推导。
  const bookDir = options.relativePath.replace(/\/[^/]*$/, '');
  const fileStem = options.relativePath.replace(/\.[^./]+$/, '');
  return {
    id: options.id,
    title: options.title,
    author: options.author,
    format,
    relative_path: options.relativePath,
    cover_path: `${bookDir}/cover.jpg`,
    notes_path: `${fileStem}.notes.json`,
    recordings_dir: `${bookDir}/recordings/`,
    size_bytes: options.sizeBytes,
    ...(options.fileHash !== undefined ? { file_hash: options.fileHash } : {}),
    added_at: now,
    sync_state: { metadata: 'synced', cover: 'local_only', notes: 'local_only', file: 'local_only', recordings: 'local_only' },
    held_by: [],
  };
}

/** 由扩展名推断书籍格式。 */
export function inferFormat(path: string): BookFormat {
  const ext = path.toLowerCase().split('.').pop();
  switch (ext) {
    case 'epub':
      return 'epub';
    case 'pdf':
      return 'pdf';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'txt':
      return 'txt';
    default:
      throw new MyLibraryError('UNSUPPORTED_FORMAT', `不支持的书籍格式：${path}`);
  }
}
