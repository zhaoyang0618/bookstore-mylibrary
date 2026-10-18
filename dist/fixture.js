/**
 * 生成一份示例 MyLibrary 数据（本地 + 网盘两份），用于：
 *
 * 1. 两个软件读写同一份数据的端到端联调（设计文档第四部分）
 * 2. CLI `validate` / `compare` 的演示
 *
 * 用法：`pnpm --filter @bookstore/mylibrary-core run fixture`
 *
 * @module @bookstore/mylibrary-core/fixture
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MyLibraryStore, bookFromFile } from './store.js';
import { createWikiPage } from './wiki.js';
import { mergeLibraries, planSync } from './sync.js';
const NOW = '2026-10-16T10:30:00Z';
const EARLIER = '2026-10-16T08:30:00Z';
const LATER = '2026-10-16T11:00:00Z';
const SAN_TI = bookFromFile({
    id: 'uuid-1',
    title: '三体',
    author: '刘慈欣',
    relativePath: 'books/三体/三体.epub',
    sizeBytes: 1048576,
    fileHash: 'sha256:2c6b7b1f9a3d5e8c0f4a7b2d6e9c1f3a5b7d9e0c2f4a6b8d0e2c4f6a8b0d2e4c',
    now: '2026-10-01T00:00:00Z',
});
const JIAN_SHI = bookFromFile({
    id: 'uuid-2',
    title: '人类简史',
    author: '尤瓦尔·赫拉利',
    relativePath: 'books/人类简史/人类简史.pdf',
    sizeBytes: 24117248,
    fileHash: 'sha256:9f8e7d6c5b4a39281706f5e4d3c2b1a0998877665544332211aabbccddeeff00',
    now: '2026-10-05T00:00:00Z',
});
function writeLibraryVariant(root, isLocal) {
    const store = new MyLibraryStore(root, { clientId: isLocal ? 'dsh-macos-client-uuid' : 'flutter-ipad-uuid' });
    store.init();
    store.writeManifest({
        schema_version: '1.0',
        library_version: isLocal ? 42 : 41,
        updated_at: NOW,
        updated_by: isLocal ? 'dsh-macos-client-uuid' : 'flutter-ipad-uuid',
        clients: [
            { id: 'dsh-macos-client-uuid', type: 'dsh-extension', platform: 'macos', last_seen: NOW },
            { id: 'flutter-ipad-uuid', type: 'flutter-app', platform: 'ipad', last_seen: !isLocal ? LATER : EARLIER },
        ],
    });
    // 本地 / 网盘两份数据的差异（用于演示 compare 与冲突合并）
    const books = [SAN_TI, JIAN_SHI];
    const localVariant = books.map((book) => ({
        ...book,
        ...(book.id === 'uuid-1'
            ? { reading_position: { position: 'epubcfi(/6/4[chap01]!/4/2/2)', percentage: 0.35, updated_at: NOW, updated_by: 'flutter-ipad-uuid' } }
            : {}),
        sync_state: book.id === 'uuid-1'
            ? { metadata: 'synced', cover: 'synced', notes: 'synced', file: 'local_only', recordings: 'local_only' }
            : { metadata: 'synced', cover: 'synced', notes: 'local_only', file: 'local_only', recordings: 'local_only' },
        held_by: [{ client_id: 'dsh-macos-client-uuid', last_seen: NOW }],
        tags: book.id === 'uuid-1' ? ['科幻', '中文'] : ['历史', '人类学'],
    }));
    const cloudVariant = books.map((book) => ({
        ...book,
        ...(book.id === 'uuid-1'
            ? { reading_position: { position: 'epubcfi(/6/4[chap03]!/4/2/2)', percentage: 0.62, updated_at: LATER, updated_by: 'flutter-ipad-uuid' } }
            : {}),
        sync_state: { metadata: 'synced', cover: 'synced', notes: 'synced', file: 'synced', recordings: 'local_only' },
        held_by: [
            { client_id: 'flutter-ipad-uuid', last_seen: LATER },
            { client_id: 'dsh-macos-client-uuid', last_seen: EARLIER },
        ],
        tags: book.id === 'uuid-1' ? ['科幻'] : ['历史'],
    }));
    store.writeLibrary({
        schema_version: '1.0',
        version: isLocal ? 42 : 41,
        updated_at: NOW,
        updated_by: isLocal ? 'dsh-macos-client-uuid' : 'flutter-ipad-uuid',
        books: isLocal ? localVariant : cloudVariant,
        collections: [
            { id: 'col-1', name: '待读', created_at: EARLIER },
            { id: 'col-2', name: '科幻经典', created_at: EARLIER },
        ],
        tags: [
            { name: '科幻', created_at: EARLIER },
            { name: '中文', created_at: EARLIER },
            { name: '历史', created_at: EARLIER },
        ],
    });
    // 书籍文件本体（用占位内容，仅用于验证文件层操作）
    mkdirSync(join(root, 'books', '三体', 'recordings'), { recursive: true });
    mkdirSync(join(root, 'books', '人类简史'), { recursive: true });
    writeFileSync(join(root, 'books', '三体', '三体.epub'), 'PK\x03\x04 (epub 占位内容)');
    writeFileSync(join(root, 'books', '三体', 'cover.jpg'), 'jpg 占位内容');
    writeFileSync(join(root, 'books', '人类简史', '人类简史.pdf'), '%PDF-1.7 (pdf 占位内容)');
    // 笔记边车（EPUB：epubcfi 锚点）
    writeFileSync(join(root, 'books', '三体', '三体.notes.json'), `${JSON.stringify({
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
                created_at: '2026-10-15T09:00:00Z',
                updated_at: NOW,
            },
            {
                id: 'anno-2',
                type: 'note',
                anchor: { type: 'epubcfi', value: 'epubcfi(/6/4[chap02]!/4/1/1)' },
                text: '给岁月以文明，而不是给文明以岁月。',
                note: '罗辑的口头禅',
                created_at: '2026-10-15T10:00:00Z',
                updated_at: '2026-10-16T08:00:00Z',
            },
        ],
    }, null, 2)}\n`);
    // 录课视频元数据
    mkdirSync(join(root, 'books', '三体', 'recordings'), { recursive: true });
    writeFileSync(join(root, 'books', '三体', 'recordings', '2026-10-16-黑暗森林解析.json'), `${JSON.stringify({
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
        transcript: '本次讲解主要讨论了黑暗森林法则的两条公理与猜疑链、技术爆炸两个概念。',
    }, null, 2)}\n`);
    // Wiki 页面
    const personPage = createWikiPage({
        id: 'uuid-wiki-1',
        title: '三体人物关系',
        tags: ['三体', '人物'],
        sourceBooks: ['uuid-1'],
        now: '2026-10-16T09:00:00Z',
    });
    personPage.body = `# 三体人物关系\n\n[[叶文洁]] 是《三体》中的核心人物，她在红岸基地向三体世界发出了回应。\n\n## 相关概念\n\n- [[黑暗森林法则]]\n- [[面壁计划]]\n- [[叶文洁]]\n`;
    personPage.wikiLinks = ['叶文洁', '黑暗森林法则', '面壁计划'];
    store.writeWikiPage(personPage);
    const forestPage = createWikiPage({
        id: 'uuid-wiki-2',
        title: '黑暗森林法则',
        tags: ['三体', '理论'],
        sourceBooks: ['uuid-1'],
        now: '2026-10-16T09:30:00Z',
    });
    forestPage.body = `# 黑暗森林法则\n\n两条公理：\n\n1. 生存是文明的第一需要\n2. 文明不断增长扩张，但宇宙物质总量不变\n\n由此推出猜疑链与技术爆炸，参见 [[三体人物关系]]。\n`;
    forestPage.wikiLinks = ['三体人物关系'];
    store.writeWikiPage(forestPage);
    store.rebuildWikiIndex();
    // 一条待处理的同步请求（iPad 请求 Mac 上传三体）
    store.writeSyncRequest({
        id: 'sync-req-uuid-1-flutter-ipad-uuid',
        book_id: 'uuid-1',
        requested_by: 'flutter-ipad-uuid',
        requested_at: NOW,
        status: 'pending',
    });
}
function main() {
    const base = resolve(process.argv[2] ?? './fixtures');
    rmSync(base, { recursive: true, force: true });
    const local = join(base, 'MyLibrary');
    const cloud = join(base, 'MyLibrary-cloud');
    writeLibraryVariant(local, true);
    writeLibraryVariant(cloud, false);
    const localStore = new MyLibraryStore(local);
    const cloudStore = new MyLibraryStore(cloud);
    const plan = planSync(localStore.readLibrary(), cloudStore.readLibrary());
    const merged = mergeLibraries(localStore.readLibrary(), cloudStore.readLibrary());
    process.stdout.write([
        `已生成示例数据：`,
        `  本地：${local}`,
        `  网盘：${cloud}`,
        `同步计划：${plan.action}（本地 v${plan.localVersion} / 网盘 v${plan.remoteVersion}）`,
        `合并结果：${merged.value.books.length} 本书，未解决冲突 ${merged.hasUnresolvedConflicts ? '有' : '无'}`,
        `Wiki 图谱：${localStore.buildWikiGraph().nodes.length} 个页面`,
        '',
        '验证：',
        `  node mylibrary/dist/cli.js validate ${local}`,
        `  node mylibrary/dist/cli.js compare ${local} ${cloud}`,
        `  node mylibrary/dist/cli.js graph ${local}`,
    ].join('\n'));
}
main();
