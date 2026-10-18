/**
 * 大文件分片上传（设计文档 1.8.6）。
 *
 * 录课视频等大文件使用分片上传，支持断点续传：
 *
 * ```
 * recordings/
 * ├── video.mp4.parts/
 * │   ├── part-0001
 * │   ├── part-0002
 * │   └── upload.json    # 记录已完成分片，支持断点续传
 * └── video.mp4          # 合并后的完整文件
 * ```
 *
 * 这一层只负责**本地分片与合并**，实际上传由 `RemoteProvider` 完成。
 * 拆开的原因：分片逻辑与网盘协议无关，dsh 版（WebDAV / 百度）和
 * Flutter 版（同样两种）都能复用同一套规则。
 *
 * @module @bookstore/mylibrary-core/chunks
 */
import type { FileSystem } from './store.js';
/** 分片上传进度文件（`upload.json`）的结构。 */
export interface UploadProgress {
    /** 源文件总字节数。 */
    total_bytes: number;
    /** 分片大小（字节）。 */
    chunk_size: number;
    /** 总分片数。 */
    total_parts: number;
    /** 已完成的分片索引（0 起，升序）。 */
    completed_parts: number[];
    /** 源文件哈希，用于校验分片是否属于同一版本。 */
    file_hash: string;
    /** 最后更新时间，ISO 8601。 */
    updated_at: string;
}
/** 分片上传计划。 */
export interface ChunkPlan {
    /** 分片目录（`<file>.parts/`）。 */
    partsDir: string;
    /** 进度文件路径（`<file>.parts/upload.json`）。 */
    progressPath: string;
    /** 源文件路径。 */
    sourcePath: string;
    /** 总分片数。 */
    totalParts: number;
    /** 分片大小。 */
    chunkSize: number;
}
/** 默认分片大小：8 MiB（网盘通常限制单请求大小，8 MiB 足够安全）。 */
export declare const DEFAULT_CHUNK_SIZE: number;
/** 分片文件名（固定宽度，保证字典序 = 数字序）。 */
export declare function partFileName(index: number): string;
/** 计算分片目录路径。 */
export declare function planChunks(sourcePath: string, sizeBytes: number, chunkSize?: number): ChunkPlan;
/** 计算第 index 个分片的字节范围。 */
export declare function chunkRange(index: number, chunkSize: number, totalBytes: number): {
    start: number;
    end: number;
};
/**
 * 计算一个文件的分片哈希（用于校验断点续传的源文件没变）。
 *
 * 只哈希首尾各 64 KiB + 总长度，避免大文件全量读取。
 */
export declare function quickFileHash(fs: FileSystem, path: string): string;
/** 读取上传进度；不存在或损坏时返回全新进度。 */
export declare function readProgress(fs: FileSystem, plan: ChunkPlan, fileHash: string, now: string): UploadProgress;
/** 写入上传进度。 */
export declare function writeProgress(fs: FileSystem, plan: ChunkPlan, progress: UploadProgress): void;
/** 尚未完成的分片索引。 */
export declare function pendingParts(progress: UploadProgress): number[];
/** 是否已完成全部分片。 */
export declare function isComplete(progress: UploadProgress): boolean;
/** 进度百分比（0 ~ 1）。 */
export declare function progressRatio(progress: UploadProgress): number;
/**
 * 把源文件切成单个分片并落盘，返回该分片的大小。
 *
 * 调用方（网盘适配器）随后会读取这个分片文件上传。
 */
export declare function writePart(fs: FileSystem, plan: ChunkPlan, sourceContent: string, index: number, totalBytes: number): {
    path: string;
    sizeBytes: number;
};
/** 标记某个分片完成并写回进度。 */
export declare function markPartDone(fs: FileSystem, plan: ChunkPlan, progress: UploadProgress, index: number, now: string): UploadProgress;
/**
 * 合并全部分片为完整文件。
 *
 * 合并前校验分片齐全、大小一致；合并后删除 `.parts/` 目录。
 *
 * @returns 合并后的字节数
 */
export declare function mergeParts(fs: FileSystem, plan: ChunkPlan, progress: UploadProgress, targetPath: string): number;
/**
 * 端到端执行一次分片上传（本地部分）。
 *
 * 供测试与 CLI 使用；真实上传时由适配器逐片上传，
 * 每片成功后调用 {@link markPartDone} 即可实现断点续传。
 */
export declare function runChunkedUpload(options: {
    fs: FileSystem;
    sourcePath: string;
    /** 每完成一片调用的回调（例如上传这一片）。 */
    onPart?: (part: {
        index: number;
        path: string;
        sizeBytes: number;
    }) => void | Promise<void>;
    now?: string;
    chunkSize?: number;
}): {
    progress: UploadProgress;
    plan: ChunkPlan;
    resumed: boolean;
};
