/**
 * TS 侧自检：确认设计文档第一部分定义的关键字段在本仓库的 types.ts 中都存在。
 *
 * 这是**单仓库可跑的快速检查**，用于本仓库 CI。
 * 完整的跨语言契约验证在 bookstore-shared 仓库：
 *   node ../shared/scripts/verify-contract.mjs
 *
 * 两者的关键字段清单必须保持一致（shared 那份是权威版本）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 设计文档第一部分定义的关键字段。 */
const CRITICAL_FIELDS = [
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
  // 通用字段
  'id', 'title', 'author', 'format', 'type', 'platform', 'name', 'created_at',
  // 笔记边车 (1.5)
  'book_id', 'book_format', 'annotations', 'anchor', 'color', 'strokes',
  // 同步请求 (1.8.4)
  'requested_by', 'requested_at', 'status',
  // 录课视频 (1.7)
  'duration_seconds', 'created_by', 'position_at_start', 'position_at_end', 'transcript',
];

const typesPath = join(ROOT, 'src', 'types.ts');
if (!existsSync(typesPath)) {
  console.error(`✗ 找不到 ${typesPath}`);
  process.exit(1);
}

const src = readFileSync(typesPath, 'utf8');
const keys = new Set([...src.matchAll(/^\s{2,}([a-z_]+)[?]?:/gm)].map((m) => m[1]));
const missing = CRITICAL_FIELDS.filter((k) => !keys.has(k));

if (missing.length > 0) {
  console.error(`✗ types.ts 缺少关键字段: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`✓ TS 侧 ${CRITICAL_FIELDS.length} 个关键字段齐全（共 ${keys.size} 个字段）`);
console.log('ℹ 跨语言契约验证请运行 bookstore-shared 仓库的 scripts/verify-contract.mjs');
