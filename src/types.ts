/**
 * MyLibrary 共享数据层的类型契约（设计文档第一部分）。
 *
 * 这些类型是 dsh 扩展版与 Flutter 跨平台版之间**唯一的数据契约**。
 * 两套软件都必须以完全一致的形状读写这些结构。
 *
 * @module @bookstore/mylibrary-core/types
 */

// ---------- 通用 ----------

/** 同步状态（设计文档 1.4 `sync_state`）。 */
export type SyncState = 'synced' | 'local_only' | 'partial' | 'missing';

/** 书籍格式。 */
export type BookFormat = 'epub' | 'pdf' | 'md' | 'markdown' | 'txt';

/** 笔记锚定类型（设计文档 1.5）。 */
export type AnchorType = 'epubcfi' | 'line_range' | 'char_offset' | 'ink';

/** 笔记类型。 */
export type AnnotationType = 'highlight' | 'note' | 'ink';

/** 高亮颜色。 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'red' | 'purple';

// ---------- manifest.json（1.3） ----------

/** 客户端类型。 */
export type ClientType = 'dsh-extension' | 'flutter-app' | 'cli' | 'other';

/** 客户端平台。 */
export type ClientPlatform = 'macos' | 'windows' | 'ipad' | 'android' | 'linux' | 'web';

/** manifest.json 中的一个客户端条目。 */
export interface ManifestClient {
  id: string;
  type: ClientType;
  platform: ClientPlatform;
  last_seen: string;
}

/** manifest.json（图书馆入口文件）。 */
export interface Manifest {
  schema_version: string;
  library_version: number;
  updated_at: string;
  updated_by: string;
  clients: ManifestClient[];
}

// ---------- library.json（1.4） ----------

/** 持有某本书文件本体的客户端记录。 */
export interface BookHolder {
  client_id: string;
  last_seen: string;
}

/** 阅读位置。 */
export interface ReadingPosition {
  position: string;
  percentage: number;
  updated_at: string;
  updated_by: string;
}

/** 一本书的五个独立同步维度。 */
export interface BookSyncState {
  metadata: SyncState;
  cover: SyncState;
  notes: SyncState;
  file: SyncState;
  recordings: SyncState;
}

/** 书籍元数据条目。 */
export interface Book {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  /** 相对 MyLibrary 根的路径，如 `books/三体/三体.epub`。 */
  relative_path: string;
  cover_path?: string;
  notes_path?: string;
  recordings_dir?: string;
  size_bytes: number;
  file_hash?: string;
  added_at: string;
  sync_state: BookSyncState;
  held_by: BookHolder[];
  reading_position?: ReadingPosition;
  tags?: string[];
  collections?: string[];
  linked_wiki_pages?: string[];
}

/** 用户收藏夹。 */
export interface Collection {
  id: string;
  name: string;
  created_at: string;
}

/** 用户标签。 */
export interface Tag {
  name: string;
  created_at: string;
}

/** library.json（书籍元数据，权威数据源）。 */
export interface Library {
  schema_version: string;
  version: number;
  updated_at: string;
  updated_by: string;
  books: Book[];
  collections: Collection[];
  tags: Tag[];
}

// ---------- 笔记边车（1.5） ----------

/** EPUB CFI 锚点。 */
export interface EpubCfiAnchor {
  type: 'epubcfi';
  value: string;
}

/** Markdown 行范围锚点（起止行号 + 文本哈希）。 */
export interface LineRangeAnchor {
  type: 'line_range';
  start_line: number;
  end_line: number;
  text_hash: string;
}

/** TXT 字符偏移锚点（偏移量 + 唯一文本片段）。 */
export interface CharOffsetAnchor {
  type: 'char_offset';
  offset: number;
  /** 唯一文本片段，用于内容漂移时重新定位。 */
  fingerprint: string;
}

/** 墨迹锚点（PDF 页面内手写）。 */
export interface InkAnchor {
  type: 'ink';
  page: number;
}

/** 任意笔记锚点。 */
export type AnnotationAnchor = EpubCfiAnchor | LineRangeAnchor | CharOffsetAnchor | InkAnchor;

/** 墨迹笔迹中的一个点。 */
export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
  /** 相对笔迹起点的毫秒数。 */
  t: number;
}

/** 一笔（一次落笔到抬笔）。 */
export interface InkStroke {
  points: InkPoint[];
  color: string;
  width: number;
}

/** 笔记边车中的一条批注。 */
export interface Annotation {
  id: string;
  type: AnnotationType;
  anchor: AnnotationAnchor;
  text?: string;
  note?: string;
  color?: HighlightColor;
  strokes?: InkStroke[];
  created_at: string;
  updated_at: string;
}

/** 笔记边车文件（EPUB / Markdown / TXT）。PDF 笔记直接写回 PDF 本身。 */
export interface NotesSidecar {
  schema_version: string;
  book_id: string;
  book_format: BookFormat;
  version: number;
  updated_at: string;
  updated_by: string;
  annotations: Annotation[];
}

// ---------- Wiki 页面（1.6） ----------

/** Wiki 页面 frontmatter。 */
export interface WikiFrontmatter {
  id: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  source_books: string[];
  links: string[];
}

/** 一个解析后的 Wiki 页面。 */
export interface WikiPage {
  frontmatter: WikiFrontmatter;
  /** 去掉 frontmatter 后的 Markdown 正文。 */
  body: string;
  /** 从正文中提取的全部 `[[双向链接]]` 目标 slug。 */
  wikiLinks: string[];
  /** 页面文件的相对路径（相对 wiki/pages/）。 */
  relativePath: string;
}

/** wiki/index.json 中的一条索引。 */
export interface WikiIndexEntry {
  id: string;
  slug: string;
  title: string;
  path: string;
  updated_at: string;
  tags: string[];
  source_books: string[];
  links: string[];
}

/** wiki/index.json（可从 pages/ 重建）。 */
export interface WikiIndex {
  schema_version: string;
  updated_at: string;
  pages: WikiIndexEntry[];
}

// ---------- 录课视频元数据（1.7） ----------

/** 录课视频元数据。 */
export interface Recording {
  id: string;
  book_id: string;
  title: string;
  file: string;
  duration_seconds: number;
  size_bytes: number;
  created_at: string;
  created_by: string;
  position_at_start?: string;
  position_at_end?: string;
  linked_wiki_pages: string[];
  transcript?: string;
}

// ---------- 同步请求队列（1.8.4） ----------

/** 同步请求状态。 */
export type SyncRequestStatus = 'pending' | 'fulfilled' | 'rejected';

/** requests/ 目录中的一条同步请求。 */
export interface SyncRequest {
  id: string;
  book_id: string;
  requested_by: string;
  requested_at: string;
  status: SyncRequestStatus;
}

// ---------- 删除语义（1.8.5） ----------

/** 删除操作类型。 */
export type DeleteOperation = 'remove_entry' | 'delete_book' | 'delete_local_only' | 'cancel_sync';

/** 删除操作的结果描述。 */
export interface DeletePlan {
  operation: DeleteOperation;
  metadata: 'keep' | 'delete';
  file: 'keep' | 'trash' | 'delete';
  /** 操作后该书在 library.json 中的 sync_state.file（保留元数据时）。 */
  nextFileSyncState?: SyncState;
  description: string;
}

// ---------- 锁文件（1.8.2） ----------

/** 二进制文件旁的 `.lock.json`。 */
export interface FileLock {
  file_hash: string;
  updated_at: string;
  updated_by: string;
}
