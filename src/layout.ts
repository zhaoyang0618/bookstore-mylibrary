/**
 * MyLibrary 目录结构常量（设计文档 1.2）。
 *
 * @module @bookstore/mylibrary-core/layout
 */

/** 图书馆根目录名。 */
export const LIBRARY_ROOT_NAME = 'MyLibrary';

/** 删除暂存目录。 */
export const TRASH_DIR = '.trash';

/** 同步请求队列目录。 */
export const REQUESTS_DIR = 'requests';

/** Wiki 目录。 */
export const WIKI_DIR = 'wiki';

/** 书籍目录。 */
export const BOOKS_DIR = 'books';

/** 图书馆入口文件。 */
export const MANIFEST_FILE = 'manifest.json';

/** 书籍元数据（权威数据源）。 */
export const LIBRARY_FILE = 'library.json';

/** Wiki 索引。 */
export const WIKI_INDEX_FILE = 'index.json';

/** 笔记边车后缀（EPUB / Markdown / TXT）。 */
export const NOTES_SUFFIX = '.notes.json';

/** 并发控制锁文件后缀。 */
export const LOCK_SUFFIX = '.lock.json';

/** 录课视频目录名。 */
export const RECORDINGS_DIRNAME = 'recordings';

/** 大文件分片临时目录后缀。 */
export const PARTS_SUFFIX = '.parts';

/** 分片上传进度文件。 */
export const UPLOAD_PARTS_FILE = 'upload.json';

/** 同步请求文件名前缀。 */
export const SYNC_REQUEST_PREFIX = 'sync-req-';

/** 迁移备份目录名前缀。 */
export const MIGRATION_BACKUP_PREFIX = 'schema-migration-';

/** 一个 MyLibrary 目录中的标准相对路径集合。 */
export interface MyLibraryLayout {
  root: string;
  manifest: string;
  library: string;
  requests: string;
  wiki: string;
  wikiIndex: string;
  wikiPages: string;
  wikiAttachments: string;
  books: string;
  trash: string;
}

/** 由根目录推导 MyLibrary 的全部标准相对路径。 */
export function resolveLayout(root: string): MyLibraryLayout {
  const join = (...parts: string[]): string => `${root.replace(/\/+$/, '')}/${parts.filter(Boolean).join('/')}`;
  return {
    root,
    manifest: join(MANIFEST_FILE),
    library: join(LIBRARY_FILE),
    requests: join(REQUESTS_DIR),
    wiki: join(WIKI_DIR),
    wikiIndex: join(WIKI_DIR, WIKI_INDEX_FILE),
    wikiPages: join(WIKI_DIR, 'pages'),
    wikiAttachments: join(WIKI_DIR, 'attachments'),
    books: join(BOOKS_DIR),
    trash: join(TRASH_DIR),
  };
}

/** 某本书的目录中的标准相对路径集合。 */
export interface BookLayout {
  dir: string;
  /** 电子书本体（可选同步）。 */
  file?: string;
  /** 封面（始终同步）。 */
  cover?: string;
  /** 笔记边车（始终同步）。 */
  notes?: string;
  /** 并发控制锁。 */
  lock?: string;
  /** 录课视频目录。 */
  recordings?: string;
}

/** 判断路径是否位于 MyLibrary 根目录内。 */
export function isInsideLibrary(root: string, path: string): boolean {
  const normalizedRoot = root.replace(/\/+$/, '');
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}
