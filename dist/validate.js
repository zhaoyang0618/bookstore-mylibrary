/**
 * Schema 校验（设计文档阶段一任务 2：实现一个 Schema 校验工具，两套软件共用）。
 *
 * 校验器不依赖任何第三方 schema 库，保证 dsh 版（Node）、Flutter 版（Dart 侧子进程）、
 * 以及独立 CLI 都能得到**完全一致**的判定结果。
 *
 * @module @bookstore/mylibrary-core/validate
 */
import { SCHEMA_VERSION, checkSchemaCompatibility, parseSchemaVersion } from './schema.js';
const SYNC_STATES = ['synced', 'local_only', 'partial', 'missing'];
const BOOK_FORMATS = ['epub', 'pdf', 'md', 'markdown', 'txt'];
const ANCHOR_TYPES = ['epubcfi', 'line_range', 'char_offset', 'ink'];
const ANNOTATION_TYPES = ['highlight', 'note', 'ink'];
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isIsoTimestamp(value) {
    if (typeof value !== 'string')
        return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed);
}
function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
}
function isPercentage(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
class IssueCollector {
    issues = [];
    error(path, message) {
        this.issues.push({ severity: 'error', path, message });
    }
    warn(path, message) {
        this.issues.push({ severity: 'warning', path, message });
    }
    requireString(doc, key, path) {
        if (!isNonEmptyString(doc[key])) {
            this.error(path, `缺少必填字段 ${key}（非空字符串）`);
            return false;
        }
        return true;
    }
    requireSchemaVersion(doc, path) {
        const value = doc['schema_version'];
        if (!isNonEmptyString(value)) {
            this.error(path, '缺少必填字段 schema_version（非空字符串）');
            return;
        }
        const check = checkSchemaCompatibility(value);
        if (check.verdict === 'incompatible') {
            this.error(path, `schema_version 不兼容：${check.reason}`);
        }
        else if (check.verdict === 'compatible-forward') {
            this.warn(path, `${check.reason}，未知字段将被忽略`);
        }
    }
}
// ---------- manifest.json ----------
/** 校验 manifest.json 原始值。 */
export function validateManifest(value) {
    const c = new IssueCollector();
    if (!isObject(value)) {
        c.error('/', 'manifest.json 必须是一个 JSON 对象');
        return report('manifest.json', c);
    }
    c.requireSchemaVersion(value, '/');
    if (!isNonEmptyString(value['library_version'])) {
        if (!isInteger(value['library_version'])) {
            c.error('/library_version', '缺少必填字段 library_version（整数）');
        }
    }
    c.requireString(value, 'updated_at', '/');
    if ('updated_at' in value && !isIsoTimestamp(value['updated_at'])) {
        c.error('/updated_at', 'updated_at 不是合法的 ISO 8601 时间戳');
    }
    c.requireString(value, 'updated_by', '/');
    if (!Array.isArray(value['clients'])) {
        c.error('/clients', '缺少必填字段 clients（数组）');
        return report('manifest.json', c);
    }
    value['clients'].forEach((entry, index) => {
        validateClient(entry, `/clients/${index}`, c);
    });
    return report('manifest.json', c);
}
function validateClient(value, path, c) {
    if (!isObject(value)) {
        c.error(path, '客户端条目必须是对象');
        return;
    }
    c.requireString(value, 'id', path);
    const type = value['type'];
    if (!isNonEmptyString(type)) {
        c.error(`${path}/type`, '缺少必填字段 type');
    }
    const platform = value['platform'];
    if (!isNonEmptyString(platform)) {
        c.error(`${path}/platform`, '缺少必填字段 platform');
    }
    if (!isIsoTimestamp(value['last_seen'])) {
        c.error(`${path}/last_seen`, 'last_seen 不是合法的 ISO 8601 时间戳');
    }
}
// ---------- library.json ----------
/** 校验 library.json 原始值。 */
export function validateLibrary(value) {
    const c = new IssueCollector();
    if (!isObject(value)) {
        c.error('/', 'library.json 必须是一个 JSON 对象');
        return report('library.json', c);
    }
    c.requireSchemaVersion(value, '/');
    if (!isInteger(value['version'])) {
        c.error('/version', '缺少必填字段 version（整数）');
    }
    if ('updated_at' in value && !isIsoTimestamp(value['updated_at'])) {
        c.error('/updated_at', 'updated_at 不是合法的 ISO 8601 时间戳');
    }
    c.requireString(value, 'updated_by', '/');
    if (!Array.isArray(value['books'])) {
        c.error('/books', '缺少必填字段 books（数组）');
        return report('library.json', c);
    }
    const seenIds = new Set();
    value['books'].forEach((entry, index) => {
        validateBook(entry, `/books/${index}`, c, seenIds);
    });
    if (!Array.isArray(value['collections'])) {
        c.error('/collections', '缺少必填字段 collections（数组）');
    }
    if (!Array.isArray(value['tags'])) {
        c.error('/tags', '缺少必填字段 tags（数组）');
    }
    return report('library.json', c);
}
function validateBook(value, path, c, seenIds) {
    if (!isObject(value)) {
        c.error(path, '书籍条目必须是对象');
        return;
    }
    c.requireString(value, 'id', path);
    const id = value['id'];
    if (isNonEmptyString(id)) {
        if (seenIds.has(id))
            c.error(`${path}/id`, `书籍 id 重复：${id}`);
        seenIds.add(id);
    }
    c.requireString(value, 'title', path);
    c.requireString(value, 'author', path);
    const format = value['format'];
    if (!BOOK_FORMATS.includes(format)) {
        c.error(`${path}/format`, `format 必须是 ${BOOK_FORMATS.join(' / ')} 之一`);
    }
    c.requireString(value, 'relative_path', path);
    if (!isInteger(value['size_bytes'])) {
        c.error(`${path}/size_bytes`, '缺少必填字段 size_bytes（整数）');
    }
    const fileHash = value['file_hash'];
    if (fileHash !== undefined && typeof fileHash === 'string' && fileHash.length > 0 && !fileHash.startsWith('sha256:')) {
        c.warn(`${path}/file_hash`, 'file_hash 推荐使用 sha256: 前缀');
    }
    if (!isIsoTimestamp(value['added_at'])) {
        c.error(`${path}/added_at`, 'added_at 不是合法的 ISO 8601 时间戳');
    }
    validateSyncState(value['sync_state'], `${path}/sync_state`, c);
    if (!Array.isArray(value['held_by'])) {
        c.error(`${path}/held_by`, '缺少必填字段 held_by（数组）');
    }
    else {
        value['held_by'].forEach((holder, index) => {
            if (!isObject(holder)) {
                c.error(`${path}/held_by/${index}`, 'held_by 条目必须是对象');
                return;
            }
            c.requireString(holder, 'client_id', `${path}/held_by/${index}`);
            if (!isIsoTimestamp(holder['last_seen'])) {
                c.error(`${path}/held_by/${index}/last_seen`, 'last_seen 不是合法的 ISO 8601 时间戳');
            }
        });
    }
    if (value['reading_position'] !== undefined) {
        validateReadingPosition(value['reading_position'], `${path}/reading_position`, c);
    }
    if (value['tags'] !== undefined && !isStringArray(value['tags'])) {
        c.error(`${path}/tags`, 'tags 必须是字符串数组');
    }
    if (value['collections'] !== undefined && !isStringArray(value['collections'])) {
        c.error(`${path}/collections`, 'collections 必须是字符串数组');
    }
    if (value['linked_wiki_pages'] !== undefined && !isStringArray(value['linked_wiki_pages'])) {
        c.error(`${path}/linked_wiki_pages`, 'linked_wiki_pages 必须是字符串数组');
    }
}
function validateSyncState(value, path, c) {
    if (!isObject(value)) {
        c.error(path, '缺少必填字段 sync_state（对象）');
        return;
    }
    const keys = ['metadata', 'cover', 'notes', 'file', 'recordings'];
    for (const key of keys) {
        const state = value[key];
        if (!SYNC_STATES.includes(state)) {
            c.error(`${path}/${key}`, `${key} 必须是 ${SYNC_STATES.join(' / ')} 之一`);
        }
    }
}
function validateReadingPosition(value, path, c) {
    if (!isObject(value)) {
        c.error(path, 'reading_position 必须是对象');
        return;
    }
    c.requireString(value, 'position', path);
    if (!isPercentage(value['percentage'])) {
        c.error(`${path}/percentage`, 'percentage 必须是 0 到 1 之间的数字');
    }
    if (!isIsoTimestamp(value['updated_at'])) {
        c.error(`${path}/updated_at`, 'updated_at 不是合法的 ISO 8601 时间戳');
    }
    c.requireString(value, 'updated_by', path);
}
// ---------- 笔记边车 ----------
/** 校验笔记边车原始值。 */
export function validateNotes(value) {
    const c = new IssueCollector();
    if (!isObject(value)) {
        c.error('/', '笔记边车必须是一个 JSON 对象');
        return report('notes sidecar', c);
    }
    c.requireSchemaVersion(value, '/');
    c.requireString(value, 'book_id', '/');
    const format = value['book_format'];
    if (!BOOK_FORMATS.includes(format)) {
        c.error('/book_format', `book_format 必须是 ${BOOK_FORMATS.join(' / ')} 之一`);
    }
    if (!isInteger(value['version'])) {
        c.error('/version', '缺少必填字段 version（整数）');
    }
    if ('updated_at' in value && !isIsoTimestamp(value['updated_at'])) {
        c.error('/updated_at', 'updated_at 不是合法的 ISO 8601 时间戳');
    }
    c.requireString(value, 'updated_by', '/');
    if (!Array.isArray(value['annotations'])) {
        c.error('/annotations', '缺少必填字段 annotations（数组）');
        return report('notes sidecar', c);
    }
    const seenIds = new Set();
    value['annotations'].forEach((entry, index) => {
        validateAnnotation(entry, `/annotations/${index}`, c, seenIds);
    });
    return report('notes sidecar', c);
}
function validateAnchor(value, path, c) {
    if (!isObject(value)) {
        c.error(path, 'anchor 必须是对象');
        return;
    }
    const type = value['type'];
    if (!ANCHOR_TYPES.includes(type)) {
        c.error(`${path}/type`, `锚定类型必须是 ${ANCHOR_TYPES.join(' / ')} 之一`);
        return;
    }
    switch (type) {
        case 'epubcfi':
            if (!isNonEmptyString(value['value']))
                c.error(`${path}/value`, 'epubcfi 锚点必须有非空 value');
            break;
        case 'line_range':
            if (!isInteger(value['start_line']) || !isInteger(value['end_line'])) {
                c.error(path, 'line_range 锚点必须有整数 start_line 与 end_line');
            }
            else if (value['start_line'] > value['end_line']) {
                c.error(path, 'line_range 锚点 start_line 不能大于 end_line');
            }
            if (!isNonEmptyString(value['text_hash']))
                c.error(`${path}/text_hash`, 'line_range 锚点必须有 text_hash');
            break;
        case 'char_offset':
            if (!isInteger(value['offset']))
                c.error(`${path}/offset`, 'char_offset 锚点必须有整数 offset');
            if (!isNonEmptyString(value['fingerprint']))
                c.error(`${path}/fingerprint`, 'char_offset 锚点必须有 fingerprint');
            break;
        case 'ink':
            if (!isInteger(value['page']))
                c.error(`${path}/page`, 'ink 锚点必须有整数 page');
            break;
    }
}
function validateAnnotation(value, path, c, seenIds) {
    if (!isObject(value)) {
        c.error(path, '批注条目必须是对象');
        return;
    }
    c.requireString(value, 'id', path);
    const id = value['id'];
    if (isNonEmptyString(id)) {
        if (seenIds.has(id))
            c.error(`${path}/id`, `批注 id 重复：${id}`);
        seenIds.add(id);
    }
    const type = value['type'];
    if (!ANNOTATION_TYPES.includes(type)) {
        c.error(`${path}/type`, `批注类型必须是 ${ANNOTATION_TYPES.join(' / ')} 之一`);
    }
    validateAnchor(value['anchor'], `${path}/anchor`, c);
    if (!isIsoTimestamp(value['created_at'])) {
        c.error(`${path}/created_at`, 'created_at 不是合法的 ISO 8601 时间戳');
    }
    if (!isIsoTimestamp(value['updated_at'])) {
        c.error(`${path}/updated_at`, 'updated_at 不是合法的 ISO 8601 时间戳');
    }
    if (type === 'ink') {
        if (!Array.isArray(value['strokes'])) {
            c.error(`${path}/strokes`, 'ink 批注必须有 strokes 数组');
        }
        else {
            value['strokes'].forEach((stroke, index) => {
                if (!isObject(stroke) || !Array.isArray(stroke['points'])) {
                    c.error(`${path}/strokes/${index}`, '笔迹必须有 points 数组');
                    return;
                }
                stroke['points'].forEach((point, pointIndex) => {
                    if (!isObject(point)) {
                        c.error(`${path}/strokes/${index}/points/${pointIndex}`, '点必须是对象');
                        return;
                    }
                    if (typeof point['x'] !== 'number' || typeof point['y'] !== 'number') {
                        c.error(`${path}/strokes/${index}/points/${pointIndex}`, '点必须有数值 x 与 y');
                    }
                });
            });
        }
    }
}
// ---------- 录课视频元数据 ----------
/** 校验录课视频元数据原始值。 */
export function validateRecording(value) {
    const c = new IssueCollector();
    if (!isObject(value)) {
        c.error('/', '录课元数据必须是一个 JSON 对象');
        return report('recording metadata', c);
    }
    c.requireString(value, 'id', '/');
    c.requireString(value, 'book_id', '/');
    c.requireString(value, 'title', '/');
    c.requireString(value, 'file', '/');
    if (!isInteger(value['duration_seconds']))
        c.error('/duration_seconds', 'duration_seconds 必须是整数');
    if (!isInteger(value['size_bytes']))
        c.error('/size_bytes', 'size_bytes 必须是整数');
    if (!isIsoTimestamp(value['created_at']))
        c.error('/created_at', 'created_at 不是合法的 ISO 8601 时间戳');
    c.requireString(value, 'created_by', '/');
    if (value['linked_wiki_pages'] !== undefined && !isStringArray(value['linked_wiki_pages'])) {
        c.error('/linked_wiki_pages', 'linked_wiki_pages 必须是字符串数组');
    }
    return report('recording metadata', c);
}
// ---------- 同步请求 ----------
/** 校验同步请求原始值。 */
export function validateSyncRequest(value) {
    const c = new IssueCollector();
    if (!isObject(value)) {
        c.error('/', '同步请求必须是一个 JSON 对象');
        return report('sync request', c);
    }
    c.requireString(value, 'id', '/');
    c.requireString(value, 'book_id', '/');
    c.requireString(value, 'requested_by', '/');
    if (!isIsoTimestamp(value['requested_at'])) {
        c.error('/requested_at', 'requested_at 不是合法的 ISO 8601 时间戳');
    }
    const status = value['status'];
    if (status !== 'pending' && status !== 'fulfilled' && status !== 'rejected') {
        c.error('/status', 'status 必须是 pending / fulfilled / rejected 之一');
    }
    return report('sync request', c);
}
// ---------- Wiki 索引 ----------
/** 校验 wiki/index.json 原始值。 */
export function validateWikiIndex(value) {
    const c = new IssueCollector();
    if (!isObject(value)) {
        c.error('/', 'wiki/index.json 必须是一个 JSON 对象');
        return report('wiki index', c);
    }
    c.requireSchemaVersion(value, '/');
    if ('updated_at' in value && !isIsoTimestamp(value['updated_at'])) {
        c.error('/updated_at', 'updated_at 不是合法的 ISO 8601 时间戳');
    }
    if (!Array.isArray(value['pages'])) {
        c.error('/pages', '缺少必填字段 pages（数组）');
        return report('wiki index', c);
    }
    const seenSlugs = new Set();
    value['pages'].forEach((entry, index) => {
        const path = `/pages/${index}`;
        if (!isObject(entry)) {
            c.error(path, '索引条目必须是对象');
            return;
        }
        c.requireString(entry, 'id', path);
        c.requireString(entry, 'slug', path);
        const slug = entry['slug'];
        if (isNonEmptyString(slug)) {
            if (seenSlugs.has(slug))
                c.error(`${path}/slug`, `slug 重复：${slug}`);
            seenSlugs.add(slug);
        }
        c.requireString(entry, 'title', path);
        c.requireString(entry, 'path', path);
        if (!isIsoTimestamp(entry['updated_at']))
            c.error(`${path}/updated_at`, 'updated_at 不是合法的 ISO 8601 时间戳');
        if (entry['tags'] !== undefined && !isStringArray(entry['tags']))
            c.error(`${path}/tags`, 'tags 必须是字符串数组');
        if (entry['source_books'] !== undefined && !isStringArray(entry['source_books'])) {
            c.error(`${path}/source_books`, 'source_books 必须是字符串数组');
        }
        if (entry['links'] !== undefined && !isStringArray(entry['links']))
            c.error(`${path}/links`, 'links 必须是字符串数组');
    });
    return report('wiki index', c);
}
// ---------- 网盘源配置 ----------
/**
 * 校验网盘源配置（设计文档 2.5）。
 *
 * 这个配置**不写入 MyLibrary**，只在本客户端本地保存（避免把密码提交到网盘），
 * 因此没有 schema_version 字段。
 */
export function validateRemoteSource(value) {
    const c = new IssueCollector();
    if (!isObject(value)) {
        c.error('/', '网盘源配置必须是一个 JSON 对象');
        return report('remote source', c);
    }
    const isWebDav = value['baseUrl'] !== undefined || value['username'] !== undefined;
    if (isWebDav) {
        if (typeof value['baseUrl'] !== 'string' || !/^https?:\/\//.test(value['baseUrl'])) {
            c.error('/baseUrl', 'WebDAV baseUrl 必须是以 http(s):// 开头的字符串');
        }
        c.requireString(value, 'username', '/');
        c.requireString(value, 'password', '/');
        c.requireString(value, 'rootPath', '/');
    }
    else {
        c.requireString(value, 'accessToken', '/');
        c.requireString(value, 'appName', '/');
    }
    return report('remote source', c);
}
// ---------- 统一入口 ----------
/** 按文档名分派校验。 */
export function validateDocument(kind, value) {
    switch (kind) {
        case 'manifest':
            return validateManifest(value);
        case 'library':
            return validateLibrary(value);
        case 'notes':
            return validateNotes(value);
        case 'recording':
            return validateRecording(value);
        case 'sync-request':
            return validateSyncRequest(value);
        case 'wiki-index':
            return validateWikiIndex(value);
        case 'remote-source':
            return validateRemoteSource(value);
        default:
            return {
                ok: false,
                subject: kind,
                issues: [{ severity: 'error', path: '/', message: `未知文档类型：${kind}` }],
            };
    }
}
/** 汇总多个报告。 */
export function summarizeReports(reports) {
    const issues = reports.flatMap((r) => r.issues);
    return {
        ok: issues.every((issue) => issue.severity !== 'error'),
        subject: reports.map((r) => r.subject).join(', '),
        issues,
    };
}
function report(subject, c) {
    return {
        ok: c.issues.every((issue) => issue.severity !== 'error'),
        subject,
        issues: c.issues,
    };
}
/** 当前 schema 版本号（供外部引用）。 */
export { SCHEMA_VERSION, parseSchemaVersion, checkSchemaCompatibility };
