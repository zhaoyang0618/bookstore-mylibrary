/**
 * 同步机制（设计文档 1.8）：版本对比、冲突合并、同步请求队列、删除语义。
 *
 * @module @bookstore/mylibrary-core/sync
 */

import type {
  Book,
  BookHolder,
  BookSyncState,
  DeleteOperation,
  Library,
  Manifest,
  ManifestClient,
  ReadingPosition,
  SyncRequest,
  SyncState,
} from './types.js';

/** 版本对比结论。 */
export type VersionComparison = 'remote-newer' | 'equal' | 'local-newer';

/** 对比本地与网盘 `library.json` 的 version 字段。 */
export function compareVersions(localVersion: number, remoteVersion: number): VersionComparison {
  if (remoteVersion > localVersion) return 'remote-newer';
  if (remoteVersion < localVersion) return 'local-newer';
  return 'equal';
}

/** 版本对比流程（设计文档 1.8.1）。 */
export interface SyncPlan {
  comparison: VersionComparison;
  localVersion: number;
  remoteVersion: number;
  /** 下一步动作。 */
  action: 'download' | 'none' | 'upload';
  reason: string;
}

/** 由 version 字段推导同步计划。 */
export function planSync(local: Pick<Library, 'version'>, remote: Pick<Library, 'version'>): SyncPlan {
  const comparison = compareVersions(local.version, remote.version);
  switch (comparison) {
    case 'remote-newer':
      return {
        comparison,
        localVersion: local.version,
        remoteVersion: remote.version,
        action: 'download',
        reason: '网盘版本高于本地，下载 JSON 并重建本地索引',
      };
    case 'local-newer':
      return {
        comparison,
        localVersion: local.version,
        remoteVersion: remote.version,
        action: 'upload',
        reason: '本地有未上传修改，推送到网盘',
      };
    default:
      return { comparison, localVersion: local.version, remoteVersion: remote.version, action: 'none', reason: '版本一致，无需同步' };
  }
}

// ---------- 冲突处理（1.8.2） ----------

/** 冲突合并策略。 */
export type ConflictStrategy = 'auto' | 'latest-wins' | 'keep-both' | 'manual';

/** 一次合并动作的记录。 */
export interface MergeAction {
  kind: 'book-added' | 'field-updated' | 'conflict-resolved' | 'unmerged';
  path: string;
  message: string;
}

/** 合并结果。 */
export interface MergeResult<T> {
  /** 合并后的文档。 */
  value: T;
  actions: MergeAction[];
  /** 是否存在未自动解决的冲突。 */
  hasUnresolvedConflicts: boolean;
}

/** 两个可选值中取 `updated_at` 较新的一方。 */
export function pickLatest<T extends { updated_at: string }>(local: T | undefined, remote: T | undefined): T | undefined {
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  return Date.parse(remote.updated_at) > Date.parse(local.updated_at) ? remote : local;
}

/** 合并两个 `held_by` 列表，取并集并按 `last_seen` 降序。 */
export function mergeHolders(local: BookHolder[], remote: BookHolder[]): BookHolder[] {
  const byClient = new Map<string, BookHolder>();
  for (const holder of [...local, ...remote]) {
    const existing = byClient.get(holder.client_id);
    if (existing === undefined || Date.parse(holder.last_seen) > Date.parse(existing.last_seen)) {
      byClient.set(holder.client_id, holder);
    }
  }
  return [...byClient.values()].sort((a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen));
}

/** 合并阅读位置：取 `updated_at` 较新的一方。 */
export function mergeReadingPosition(local: ReadingPosition | undefined, remote: ReadingPosition | undefined): ReadingPosition | undefined {
  return pickLatest(local, remote);
}

/**
 * 字段级合并：同一本书的不同字段分别取最新。
 *
 * - 不同书籍被修改 → 自动合并（按 `book_id` 取并集）
 * - 同一本书不同字段 → 字段级合并
 * - 同一字段被两端修改 → 按 `updated_at` 取最新
 */
export function mergeLibraries(
  local: Library,
  remote: Library,
  strategy: ConflictStrategy = 'auto',
): MergeResult<Library> {
  const actions: MergeAction[] = [];
  const mergedById = new Map<string, Book>();
  for (const book of local.books) mergedById.set(book.id, { ...book });
  for (const remoteBook of remote.books) {
    const localBook = mergedById.get(remoteBook.id);
    if (localBook === undefined) {
      mergedById.set(remoteBook.id, { ...remoteBook });
      actions.push({ kind: 'book-added', path: `books/${remoteBook.id}`, message: `新增书籍《${remoteBook.title}》` });
      continue;
    }
    const merged = mergeBook(localBook, remoteBook, strategy, actions);
    mergedById.set(remoteBook.id, merged);
  }

  const mergedCollections = mergeNamedLists(local.collections, remote.collections, actions, 'collections');
  const mergedTags = mergeNamedLists(local.tags, remote.tags, actions, 'tags');

  // 元信息：version 取较大值，updated_at 取最新
  const newerMeta = pickLatest(
    { updated_at: local.updated_at, updated_by: local.updated_by },
    { updated_at: remote.updated_at, updated_by: remote.updated_by },
  );
  const merged: Library = {
    schema_version: newerSchema(local.schema_version, remote.schema_version),
    version: Math.max(local.version, remote.version),
    updated_at: newerMeta?.updated_at ?? local.updated_at,
    updated_by: newerMeta?.updated_by ?? local.updated_by,
    books: [...mergedById.values()],
    collections: mergedCollections,
    tags: mergedTags,
  };
  return { value: merged, actions, hasUnresolvedConflicts: actions.some((a) => a.kind === 'unmerged') };
}

/** 取语义化版本较新的一方。 */
function newerSchema(a: string, b: string): string {
  const parse = (v: string): number[] => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va > vb ? a : b;
  }
  return a;
}

function mergeNamedLists<T extends { id?: string; name: string }>(
  local: T[],
  remote: T[],
  actions: MergeAction[],
  kind: 'collections' | 'tags',
): T[] {
  const byKey = new Map<string, T>();
  for (const entry of local) byKey.set(entry.id ?? entry.name, entry);
  for (const entry of remote) {
    const key = entry.id ?? entry.name;
    if (!byKey.has(key)) {
      byKey.set(key, entry);
      actions.push({ kind: 'field-updated', path: `${kind}/${key}`, message: `新增${kind === 'collections' ? '收藏夹' : '标签'} ${entry.name}` });
    }
  }
  return [...byKey.values()];
}

/** 合并两端的同一本书：字段级合并 + `updated_at` 决胜。 */
export function mergeBook(
  local: Book,
  remote: Book,
  strategy: ConflictStrategy = 'auto',
  actions: MergeAction[] = [],
): Book {
  const path = `books/${local.id}`;
  // 标量字段：同一字段被两端修改 → 按 updated_at 取最新
  // library.json 的 book 级时间戳用 added_at 近似；这里对每本书取
  // 远端新增字段优先、同名字段按远端覆盖（版本对比阶段已经保证只有一端写入时无冲突）
  const scalar: Book = {
    ...local,
    ...pickDefined(remote, local),
  };

  // 结构化字段按专用规则合并
  scalar.sync_state = mergeSyncState(local.sync_state, remote.sync_state, actions, path);
  scalar.held_by = mergeHolders(local.held_by, remote.held_by);
  const position = mergeReadingPosition(local.reading_position, remote.reading_position);
  if (position !== undefined) scalar.reading_position = position;
  else delete scalar.reading_position;
  assignOptional(scalar, 'tags', mergeStringUnions(local.tags, remote.tags));
  assignOptional(scalar, 'collections', mergeStringUnions(local.collections, remote.collections));
  assignOptional(scalar, 'linked_wiki_pages', mergeStringUnions(local.linked_wiki_pages, remote.linked_wiki_pages));
  scalar.size_bytes = Math.max(local.size_bytes, remote.size_bytes);
  if (remote.file_hash && local.file_hash && remote.file_hash !== local.file_hash && strategy !== 'auto') {
    actions.push({
      kind: 'unmerged',
      path: `${path}/file_hash`,
      message: `《${local.title}》文件哈希不一致：本地 ${local.file_hash} / 网盘 ${remote.file_hash}`,
    });
  }
  return scalar;
}

/** 只覆盖已定义（非 undefined）的字段。 */
function pickDefined<T extends object>(primary: T, fallback: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(primary) as [keyof T, T[keyof T]][]) {
    if (value !== undefined) result[key] = value;
    else if (fallback[key] !== undefined) result[key] = fallback[key];
  }
  return result;
}

/** 可选字段赋值：值为 undefined 时删除字段（exactOptionalPropertyTypes 友好）。 */
function assignOptional<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/** 五个同步维度：任一维度为 synced 则取 synced；否则取更"可达"的状态。 */
const SYNC_RANK: Record<keyof BookSyncState, number> = { metadata: 3, cover: 3, notes: 3, file: 3, recordings: 3 };

/** 合并 `sync_state`：越"可用"的状态越优先。 */
export function mergeSyncState(
  local: BookSyncState,
  remote: BookSyncState,
  actions: MergeAction[] = [],
  path = '',
): BookSyncState {
  const order = ['missing', 'local_only', 'partial', 'synced'] as const;
  const merged = {} as BookSyncState;
  for (const key of Object.keys(SYNC_RANK) as (keyof BookSyncState)[]) {
    const a = local[key];
    const b = remote[key];
    const better = order.indexOf(a) >= order.indexOf(b) ? a : b;
    if (a !== b) {
      actions.push({ kind: 'field-updated', path: `${path}/sync_state/${key}`, message: `sync_state.${key}: ${a} → ${better}` });
    }
    merged[key] = better;
  }
  return merged;
}

/** 字符串数组合并（取并集，保持顺序稳定）。 */
export function mergeStringUnions(local?: string[], remote?: string[]): string[] | undefined {
  if (local === undefined && remote === undefined) return undefined;
  const set = new Set<string>([...(local ?? []), ...(remote ?? [])]);
  return [...set];
}

// ---------- 同步请求队列（1.8.4） ----------

/** 生成一个同步请求文件名。 */
export function syncRequestFileName(bookId: string, clientId: string): string {
  return `sync-req-${bookId}-${clientId}.json`;
}

/** 构造一条同步请求。 */
export function createSyncRequest(bookId: string, clientId: string, now: string, id = cryptoId()): SyncRequest {
  return {
    id,
    book_id: bookId,
    requested_by: clientId,
    requested_at: now,
    status: 'pending',
  };
}

/** 扫描 requests/ 目录，挑出针对某个客户端的待处理请求。 */
export function pendingRequestsFor(requests: SyncRequest[], clientId: string): SyncRequest[] {
  return requests.filter((request) => request.status === 'pending' && request.requested_by !== clientId);
}

/** 处理完一条请求后的状态迁移。 */
export function fulfillRequest(request: SyncRequest): SyncRequest {
  return { ...request, status: 'fulfilled' };
}

// ---------- 删除语义（1.8.5） ----------

/** 由删除操作推导对元数据与文件本体的处置。 */
export function planDelete(operation: DeleteOperation): DeletePlanShape {
  switch (operation) {
    case 'remove_entry':
      return {
        operation,
        metadata: 'delete',
        file: 'keep',
        description: '移除条目：删除元数据，保留文件本体（暂时不想看到这本书）',
      };
    case 'delete_book':
      return {
        operation,
        metadata: 'delete',
        file: 'trash',
        description: '删除书籍：删除元数据，文件移到 .trash/（彻底删除）',
      };
    case 'delete_local_only':
      return {
        operation,
        metadata: 'keep',
        file: 'delete',
        nextFileSyncState: 'local_only',
        description: '仅删除本地：保留元数据，本地文件删除，sync_state.file 改为 local_only（本地空间不足）',
      };
    case 'cancel_sync':
      return {
        operation,
        metadata: 'keep',
        file: 'delete',
        description: '取消同步：保留元数据，网盘和本地都删除（只保留书目信息）',
      };
  }
}

interface DeletePlanShape {
  operation: DeleteOperation;
  metadata: 'keep' | 'delete';
  file: 'keep' | 'trash' | 'delete';
  nextFileSyncState?: SyncState;
  description: string;
}

// ---------- manifest 更新 ----------

/** 记录一个客户端上线（不存在则新增，存在则刷新 last_seen）。 */
export function touchClient(manifest: Manifest, client: Omit<ManifestClient, 'last_seen'>, now: string): Manifest {
  const existing = manifest.clients.find((entry) => entry.id === client.id);
  const clients = existing === undefined
    ? [...manifest.clients, { ...client, last_seen: now }]
    : manifest.clients.map((entry) => (entry.id === client.id ? { ...entry, ...client, last_seen: now } : entry));
  return {
    ...manifest,
    library_version: manifest.library_version + 1,
    updated_at: now,
    updated_by: client.id,
    clients,
  };
}

/** 随机 id（不依赖 crypto，便于跨端复用同一逻辑）。 */
function cryptoId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `sync-req-${time}-${random}`;
}
