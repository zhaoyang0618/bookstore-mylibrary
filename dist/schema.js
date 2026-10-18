/**
 * Schema 版本兼容性（设计文档 1.9）。
 *
 * - 主版本（1.x → 2.x）：不兼容，旧客户端拒绝操作
 * - 次版本（1.0 → 1.1）：向后兼容，忽略未知字段
 * - 补丁版本：无破坏性变更
 *
 * @module @bookstore/mylibrary-core/schema
 */
/** 数据层当前实现的 schema 版本。 */
export const SCHEMA_VERSION = '1.0';
/** 解析 `major.minor` 或 `major.minor.patch` 形式的版本号。 */
export function parseSchemaVersion(version) {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.trim());
    if (!match)
        throw new SchemaVersionError(`无法解析 schema_version: ${JSON.stringify(version)}`);
    return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}
/** 文档版本与本实现版本的兼容性检查。 */
export function checkSchemaCompatibility(declared, implemented = SCHEMA_VERSION) {
    let declaredParts;
    let implementedParts;
    try {
        declaredParts = parseSchemaVersion(declared);
        implementedParts = parseSchemaVersion(implemented);
    }
    catch {
        return {
            declared,
            implemented,
            verdict: 'incompatible',
            reason: 'schema_version 不是合法的语义化版本号',
        };
    }
    const [declaredMajor, declaredMinor] = declaredParts;
    const [implementedMajor, implementedMinor] = implementedParts;
    if (declaredMajor !== implementedMajor) {
        return {
            declared,
            implemented,
            verdict: 'incompatible',
            reason: `主版本不兼容：文档 ${declared} 与本实现 ${implemented}`,
        };
    }
    if (declaredMinor > implementedMinor) {
        return {
            declared,
            implemented,
            verdict: 'incompatible',
            reason: `文档次版本 ${declared} 高于本实现 ${implemented}，请升级客户端`,
        };
    }
    if (declaredMinor < implementedMinor) {
        return {
            declared,
            implemented,
            verdict: 'compatible-forward',
            reason: `文档次版本 ${declared} 低于本实现 ${implemented}，向后兼容，将忽略未知字段`,
        };
    }
    return { declared, implemented, verdict: 'compatible', reason: 'schema 版本一致' };
}
/** 断言兼容，不兼容时抛出可读错误。 */
export function assertSchemaCompatible(declared, implemented) {
    const check = checkSchemaCompatibility(declared, implemented);
    if (check.verdict === 'incompatible')
        throw new SchemaVersionError(check.reason, check);
    return check;
}
/** schema 版本错误。 */
export class SchemaVersionError extends Error {
    check;
    constructor(message, check) {
        super(message);
        this.name = 'SchemaVersionError';
        this.check = check;
    }
}
