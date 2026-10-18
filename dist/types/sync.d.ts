/**
 * 同步机制（设计文档 1.8）：版本对比、冲突合并、同步请求队列、删除语义。
 *
 * @module @bookstore/mylibrary-core/sync
 */
import type { Book, BookHolder, BookSyncState, DeleteOperation, Library, Manifest, ManifestClient, ReadingPosition, SyncRequest, SyncState } from './types.js';
/** 版本对比结论。 */
export type VersionComparison = 'remote-newer' | 'equal' | 'local-newer';
/** 对比本地与网盘 `library.json` 的 version 字段。 */
export declare function compareVersions(localVersion: number, remoteVersion: number): VersionComparison;
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
export declare function planSync(local: Pick<Library, 'version'>, remote: Pick<Library, 'version'>): SyncPlan;
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
export declare function pickLatest<T extends {
    updated_at: string;
}>(local: T | undefined, remote: T | undefined): T | undefined;
/** 合并两个 `held_by` 列表，取并集并按 `last_seen` 降序。 */
export declare function mergeHolders(local: BookHolder[], remote: BookHolder[]): BookHolder[];
/** 合并阅读位置：取 `updated_at` 较新的一方。 */
export declare function mergeReadingPosition(local: ReadingPosition | undefined, remote: ReadingPosition | undefined): ReadingPosition | undefined;
/**
 * 字段级合并：同一本书的不同字段分别取最新。
 *
 * - 不同书籍被修改 → 自动合并（按 `book_id` 取并集）
 * - 同一本书不同字段 → 字段级合并
 * - 同一字段被两端修改 → 按 `updated_at` 取最新
 */
export declare function mergeLibraries(local: Library, remote: Library, strategy?: ConflictStrategy): MergeResult<Library>;
/** 合并两端的同一本书：字段级合并 + `updated_at` 决胜。 */
export declare function mergeBook(local: Book, remote: Book, strategy?: ConflictStrategy, actions?: MergeAction[]): Book;
/** 合并 `sync_state`：越"可用"的状态越优先。 */
export declare function mergeSyncState(local: BookSyncState, remote: BookSyncState, actions?: MergeAction[], path?: string): BookSyncState;
/** 字符串数组合并（取并集，保持顺序稳定）。 */
export declare function mergeStringUnions(local?: string[], remote?: string[]): string[] | undefined;
/** 生成一个同步请求文件名。 */
export declare function syncRequestFileName(bookId: string, clientId: string): string;
/** 构造一条同步请求。 */
export declare function createSyncRequest(bookId: string, clientId: string, now: string, id?: string): SyncRequest;
/** 扫描 requests/ 目录，挑出针对某个客户端的待处理请求。 */
export declare function pendingRequestsFor(requests: SyncRequest[], clientId: string): SyncRequest[];
/** 处理完一条请求后的状态迁移。 */
export declare function fulfillRequest(request: SyncRequest): SyncRequest;
/** 由删除操作推导对元数据与文件本体的处置。 */
export declare function planDelete(operation: DeleteOperation): DeletePlanShape;
interface DeletePlanShape {
    operation: DeleteOperation;
    metadata: 'keep' | 'delete';
    file: 'keep' | 'trash' | 'delete';
    nextFileSyncState?: SyncState;
    description: string;
}
/** 记录一个客户端上线（不存在则新增，存在则刷新 last_seen）。 */
export declare function touchClient(manifest: Manifest, client: Omit<ManifestClient, 'last_seen'>, now: string): Manifest;
export {};
