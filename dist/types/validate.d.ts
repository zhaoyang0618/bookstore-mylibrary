/**
 * Schema 校验（设计文档阶段一任务 2：实现一个 Schema 校验工具，两套软件共用）。
 *
 * 校验器不依赖任何第三方 schema 库，保证 dsh 版（Node）、Flutter 版（Dart 侧子进程）、
 * 以及独立 CLI 都能得到**完全一致**的判定结果。
 *
 * @module @bookstore/mylibrary-core/validate
 */
import { SCHEMA_VERSION, checkSchemaCompatibility, parseSchemaVersion } from './schema.js';
/** 校验问题严重级别。 */
export type ValidationSeverity = 'error' | 'warning';
/** 一条校验问题。 */
export interface ValidationIssue {
    severity: ValidationSeverity;
    /** JSON Pointer / 相对路径，指向问题所在位置。 */
    path: string;
    message: string;
}
/** 校验结果。 */
export interface ValidationReport {
    ok: boolean;
    /** 被校验的文档名（manifest.json / library.json / ...）。 */
    subject: string;
    issues: ValidationIssue[];
}
/** 校验 manifest.json 原始值。 */
export declare function validateManifest(value: unknown): ValidationReport;
/** 校验 library.json 原始值。 */
export declare function validateLibrary(value: unknown): ValidationReport;
/** 校验笔记边车原始值。 */
export declare function validateNotes(value: unknown): ValidationReport;
/** 校验录课视频元数据原始值。 */
export declare function validateRecording(value: unknown): ValidationReport;
/** 校验同步请求原始值。 */
export declare function validateSyncRequest(value: unknown): ValidationReport;
/** 校验 wiki/index.json 原始值。 */
export declare function validateWikiIndex(value: unknown): ValidationReport;
/**
 * 校验网盘源配置（设计文档 2.5）。
 *
 * 这个配置**不写入 MyLibrary**，只在本客户端本地保存（避免把密码提交到网盘），
 * 因此没有 schema_version 字段。
 */
export declare function validateRemoteSource(value: unknown): ValidationReport;
/** 按文档名分派校验。 */
export declare function validateDocument(kind: string, value: unknown): ValidationReport;
/** 汇总多个报告。 */
export declare function summarizeReports(reports: ValidationReport[]): ValidationReport;
/** 当前 schema 版本号（供外部引用）。 */
export { SCHEMA_VERSION, parseSchemaVersion, checkSchemaCompatibility };
