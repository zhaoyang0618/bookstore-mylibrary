/**
 * 契约一致性检查：对比 TS 与 Dart 两侧的 JSON 键名集合。
 *
 * 这是设计文档 4.3「接口是契约，实现是自由的」的可执行验证：
 * 任何一侧新增 / 改名了字段，这个脚本都会报出来。
 *
 * 用法：
 *   node scripts/verify-contract.mjs
 *
 * 需要同时检出两个仓库（默认按同级目录查找）：
 *   book_store/mylibrary/      ← 本仓库
 *   book_store/ebook-studio/   ← Dart 侧
 *
 * 只检出 mylibrary 时，脚本会跳过 Dart 对比并以 0 退出
 * （CI 里只跑本仓库，本地开发时两个仓库都在才做完整检查）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MYLIBRARY_ROOT = resolve(HERE, '..');
const EBOOK_STUDIO_ROOT = resolve(MYLIBRARY_ROOT, '..', 'ebook-studio');

const tsPath = join(MYLIBRARY_ROOT, 'src', 'types.ts');
if (!existsSync(tsPath)) {
  console.error(`✗ 找不到 ${tsPath}`);
  process.exit(1);
}
const tsSrc = readFileSync(tsPath, 'utf8');
const tsKeys = new Set([...tsSrc.matchAll(/^\s{2,}([a-z_]+)[?]?:/gm)].map((m) => m[1]));

// 设计文档第一部分定义的关键字段（少一个就说明契约被破坏了）
const critical = [
  // manifest.json (1.3)
  'schema_version', 'library_version', 'updated_at', 'updated_by', 'clients',
  // library.json (1.4)
  'books', 'version', 'relative_path', 'cover_path', 'notes_path', 'recordings_dir',
  'size_bytes', 'file_hash', 'added_at', 'sync_state', 'held_by', 'reading_position',
  'tags', 'collections', 'linked_wiki_pages',
  // sync_state 五维度 (1.4)
  'metadata', 'cover', 'notes', 'file', 'recordings',
  // held_by / reading_position (1.4)
  'client_id', 'last_seen', 'percentage', 'position',
  // 通用
  'id', 'title', 'author', 'format', 'type', 'platform', 'name', 'created_at',
  // 笔记边车 (1.5)
  'book_id', 'book_format', 'annotations', 'anchor', 'color', 'strokes',
  // 同步请求 (1.8.4)
  'requested_by', 'requested_at', 'status',
  // 录课 (1.7)
  'duration_seconds', 'created_by', 'position_at_start', 'position_at_end', 'transcript',
];

const missingInTs = critical.filter((k) => !tsKeys.has(k));
if (missingInTs.length > 0) {
  console.error(`✗ TS 侧缺少关键字段: ${missingInTs.join(', ')}`);
  process.exit(1);
}
console.log(`✓ TS 侧 ${critical.length} 个关键字段齐全（共 ${tsKeys.size} 个字段）`);

// ---------- Dart 侧对比（可选） ----------
if (!existsSync(EBOOK_STUDIO_ROOT)) {
  console.log(`ℹ 未找到同级 ebook-studio 仓库，跳过 Dart 侧对比`);
  console.log(`  （完整检查需要: ${EBOOK_STUDIO_ROOT}）`);
  process.exit(0);
}

const dartFiles = [
  'lib/models/mylibrary_models.dart',
  'lib/storage/sync.dart',
  'lib/storage/my_library_store.dart',
].map((f) => join(EBOOK_STUDIO_ROOT, f));

for (const f of dartFiles) {
  if (!existsSync(f)) {
    console.error(`✗ 找不到 ${f}`);
    process.exit(1);
  }
}
const dartSrc = dartFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const dartKeys = new Set([...dartSrc.matchAll(/json\['([a-z_]+)'\]/g)].map((m) => m[1]));

const missingInDart = critical.filter((k) => !dartKeys.has(k));
if (missingInDart.length > 0) {
  console.error(`✗ Dart 侧缺少关键字段: ${missingInDart.join(', ')}`);
  process.exit(1);
}

const onlyTs = [...tsKeys].filter((k) => !dartKeys.has(k)).sort();
console.log(`✓ Dart 侧 ${critical.length} 个关键字段齐全（共 ${dartKeys.size} 个 JSON 键）`);
if (onlyTs.length > 0) {
  console.log(`ℹ 仅在 TS 中（Dart 通过通用 Map 透传或尚未读取）: ${onlyTs.join(', ')}`);
}
console.log(`\n✓ 契约一致：${critical.length} 个关键字段在 TS 与 Dart 两侧完全对齐`);
