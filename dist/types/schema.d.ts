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
export declare const SCHEMA_VERSION: "1.0";
/** 兼容性判定结果。 */
export type SchemaCompatibility = 'compatible' | 'compatible-forward' | 'incompatible';
/** 一次兼容性判定的完整结论。 */
export interface SchemaCheck {
    /** 文档中声明的 `schema_version`。 */
    readonly declared: string;
    /** 本客户端实现的 `schema_version`。 */
    readonly implemented: string;
    /** 判定结果。 */
    readonly verdict: SchemaCompatibility;
    /** 给人看的说明。 */
    readonly reason: string;
}
/** 解析 `major.minor` 或 `major.minor.patch` 形式的版本号。 */
export declare function parseSchemaVersion(version: string): [number, number, number];
/** 文档版本与本实现版本的兼容性检查。 */
export declare function checkSchemaCompatibility(declared: string, implemented?: string): SchemaCheck;
/** 断言兼容，不兼容时抛出可读错误。 */
export declare function assertSchemaCompatible(declared: string, implemented?: string): SchemaCheck;
/** schema 版本错误。 */
export declare class SchemaVersionError extends Error {
    readonly check: SchemaCheck | undefined;
    constructor(message: string, check?: SchemaCheck);
}
