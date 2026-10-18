/**
 * 同步机制测试（设计文档 1.8）。
 *
 * @module @bookstore/mylibrary-core/__tests__/sync
 */

import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  createSyncRequest,
  fulfillRequest,
  mergeHolders,
  mergeLibraries,
  mergeReadingPosition,
  mergeStringUnions,
  mergeSyncState,
  pendingRequestsFor,
  planDelete,
  planSync,
  syncRequestFileName,
  touchClient,
} from '../sync.js';
import type { Book, Library, Manifest, SyncRequest } from '../types.js';

const NOW = '2026-10-16T10:30:00Z';
const EARLIER = '2026-10-16T08:30:00Z';
const LATER = '2026-10-16T11:00:00Z';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'uuid-1',
    title: '三体',
    author: '刘慈欣',
    format: 'epub',
    relative_path: 'books/三体/三体.epub',
    size_bytes: 1048576,
    added_at: EARLIER,
    sync_state: { metadata: 'synced', cover: 'synced', notes: 'synced', file: 'local_only', recordings: 'local_only' },
    held_by: [],
    ...overrides,
  };
}

function makeLibrary(books: Book[], version = 1): Library {
  return {
    schema_version: '1.0',
    version,
    updated_at: NOW,
    updated_by: 'local',
    books,
    collections: [],
    tags: [],
  };
}

describe('版本对比（1.8.1）', () => {
  it('网盘版本更高 → 下载', () => {
    expect(compareVersions(1, 2)).toBe('remote-newer');
    expect(planSync({ version: 1 }, { version: 2 })).toMatchObject({ action: 'download' });
  });

  it('版本一致 → 无需同步', () => {
    expect(compareVersions(7, 7)).toBe('equal');
    expect(planSync({ version: 7 }, { version: 7 }).action).toBe('none');
  });

  it('本地版本更高 → 推送', () => {
    expect(compareVersions(9, 3)).toBe('local-newer');
    expect(planSync({ version: 9 }, { version: 3 })).toMatchObject({ action: 'upload' });
  });
});

describe('冲突合并（1.8.2）', () => {
  it('不同书籍被修改 → 按 book_id 取并集', () => {
    const local = makeLibrary([makeBook({ id: 'a', title: 'A' })]);
    const remote = makeLibrary([makeBook({ id: 'b', title: 'B' })], 5);
    const merged = mergeLibraries(local, remote);
    expect(merged.value.books.map((b) => b.id).sort()).toEqual(['a', 'b']);
    expect(merged.value.version).toBe(5);
    expect(merged.actions.some((action) => action.kind === 'book-added')).toBe(true);
  });

  it('同一本书的 tags / collections / linked_wiki_pages 取并集', () => {
    const local = makeLibrary([makeBook({ tags: ['科幻'], collections: ['待读'], linked_wiki_pages: ['a'] })]);
    const remote = makeLibrary([makeBook({ tags: ['中文', '科幻'], collections: ['已读'], linked_wiki_pages: ['b'] })], 5);
    const merged = mergeLibraries(local, remote);
    const book = merged.value.books[0]!;
    const sorted = (values: string[] | undefined): string[] => [...(values ?? [])].sort((a, b) => a.localeCompare(b));
    expect(sorted(book.tags)).toEqual(sorted(['中文', '科幻']));
    expect(sorted(book.collections)).toEqual(sorted(['待读', '已读']));
    expect(sorted(book.linked_wiki_pages)).toEqual(sorted(['a', 'b']));
  });

  it('reading_position 按 updated_at 取最新', () => {
    const local = makeLibrary([
      makeBook({ reading_position: { position: 'p-local', percentage: 0.2, updated_at: EARLIER, updated_by: 'local' } }),
    ]);
    const remote = makeLibrary(
      [makeBook({ reading_position: { position: 'p-remote', percentage: 0.8, updated_at: LATER, updated_by: 'remote' } })],
      5,
    );
    const merged = mergeLibraries(local, remote);
    expect(merged.value.books[0]?.reading_position?.position).toBe('p-remote');
  });

  it('held_by 取并集并按 last_seen 降序', () => {
    const local = makeLibrary([
      makeBook({
        held_by: [
          { client_id: 'mac', last_seen: EARLIER },
          { client_id: 'ipad', last_seen: LATER },
        ],
      }),
    ]);
    const remote = makeLibrary([makeBook({ held_by: [{ client_id: 'win', last_seen: NOW }] })], 5);
    const merged = mergeLibraries(local, remote);
    expect(merged.value.books[0]?.held_by.map((h) => h.client_id)).toEqual(['ipad', 'win', 'mac']);
  });

  it('sync_state 五个维度各自取更可达的状态', () => {
    const local = { metadata: 'synced', cover: 'local_only', notes: 'synced', file: 'local_only', recordings: 'missing' } as const;
    const remote = { metadata: 'synced', cover: 'synced', notes: 'local_only', file: 'synced', recordings: 'partial' } as const;
    const merged = mergeSyncState(local, remote);
    expect(merged).toEqual({
      metadata: 'synced',
      cover: 'synced',
      notes: 'synced',
      file: 'synced',
      recordings: 'partial',
    });
  });

  it('两端 reading_position 都缺失时不留字段', () => {
    const local = makeLibrary([makeBook()]);
    const remote = makeLibrary([makeBook()], 5);
    const merged = mergeLibraries(local, remote);
    expect('reading_position' in merged.value.books[0]!).toBe(false);
  });

  it('manual 策略下 file_hash 不一致标记为未解决冲突', () => {
    const local = makeLibrary([makeBook({ file_hash: 'sha256:aaa' })]);
    const remote = makeLibrary([makeBook({ file_hash: 'sha256:bbb' })], 5);
    const merged = mergeLibraries(local, remote, 'manual');
    expect(merged.hasUnresolvedConflicts).toBe(true);
    expect(merged.actions.some((action) => action.kind === 'unmerged')).toBe(true);
  });

  it('字符串数组合并', () => {
    expect(mergeStringUnions(['a'], ['b', 'a'])).toEqual(['a', 'b']);
    expect(mergeStringUnions(undefined, undefined)).toBeUndefined();
  });

  it('reading_position 单边存在时保留', () => {
    const position = { position: 'p', percentage: 0.5, updated_at: NOW, updated_by: 'x' };
    expect(mergeReadingPosition(undefined, position)).toBe(position);
    expect(mergeReadingPosition(position, undefined)).toBe(position);
    expect(mergeReadingPosition(undefined, undefined)).toBeUndefined();
  });
});

describe('同步请求队列（1.8.4）', () => {
  it('生成规范的文件名', () => {
    expect(syncRequestFileName('uuid-1', 'flutter-ipad')).toBe('sync-req-uuid-1-flutter-ipad.json');
  });

  it('构造 pending 请求', () => {
    const request = createSyncRequest('uuid-1', 'flutter-ipad', NOW, 'sync-req-1');
    expect(request).toEqual({ id: 'sync-req-1', book_id: 'uuid-1', requested_by: 'flutter-ipad', requested_at: NOW, status: 'pending' });
  });

  it('挑出针对其他客户端的待处理请求', () => {
    const requests: SyncRequest[] = [
      { id: 'r1', book_id: 'b1', requested_by: 'ipad', requested_at: NOW, status: 'pending' },
      { id: 'r2', book_id: 'b2', requested_by: 'ipad', requested_at: NOW, status: 'fulfilled' },
      { id: 'r3', book_id: 'b3', requested_by: 'mac', requested_at: NOW, status: 'pending' },
    ];
    expect(pendingRequestsFor(requests, 'mac').map((r) => r.id)).toEqual(['r1']);
  });

  it('完成后请求状态迁移为 fulfilled', () => {
    expect(fulfillRequest({ id: 'r1', book_id: 'b1', requested_by: 'ipad', requested_at: NOW, status: 'pending' }).status).toBe('fulfilled');
  });
});

describe('删除语义（1.8.5）', () => {
  it('移除条目：删元数据，留文件', () => {
    expect(planDelete('remove_entry')).toMatchObject({ metadata: 'delete', file: 'keep' });
  });

  it('删除书籍：删元数据，文件进 .trash', () => {
    expect(planDelete('delete_book')).toMatchObject({ metadata: 'delete', file: 'trash' });
  });

  it('仅删除本地：留元数据，sync_state.file 改 local_only', () => {
    expect(planDelete('delete_local_only')).toMatchObject({ metadata: 'keep', file: 'delete', nextFileSyncState: 'local_only' });
  });

  it('取消同步：留元数据，本地网盘都删', () => {
    expect(planDelete('cancel_sync')).toMatchObject({ metadata: 'keep', file: 'delete' });
  });
});

describe('manifest 客户端列表（1.3）', () => {
  const base: Manifest = {
    schema_version: '1.0',
    library_version: 42,
    updated_at: NOW,
    updated_by: 'x',
    clients: [{ id: 'mac', type: 'dsh-extension', platform: 'macos', last_seen: EARLIER }],
  };

  it('新客户端被追加', () => {
    const next = touchClient(base, { id: 'ipad', type: 'flutter-app', platform: 'ipad' }, NOW);
    expect(next.clients).toHaveLength(2);
    expect(next.clients[1]).toMatchObject({ id: 'ipad', last_seen: NOW });
    expect(next.library_version).toBe(43);
  });

  it('已有客户端只刷新 last_seen', () => {
    const next = touchClient(base, { id: 'mac', type: 'dsh-extension', platform: 'macos' }, LATER);
    expect(next.clients).toHaveLength(1);
    expect(next.clients[0]?.last_seen).toBe(LATER);
  });
});
