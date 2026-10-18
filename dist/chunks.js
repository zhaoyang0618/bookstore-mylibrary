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
import { createHash } from 'node:crypto';
/** 默认分片大小：8 MiB（网盘通常限制单请求大小，8 MiB 足够安全）。 */
export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
/** 分片文件名（固定宽度，保证字典序 = 数字序）。 */
export function partFileName(index) {
    return `part-${String(index).padStart(4, '0')}`;
}
/** 计算分片目录路径。 */
export function planChunks(sourcePath, sizeBytes, chunkSize = DEFAULT_CHUNK_SIZE) {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        throw new Error(`文件大小非法：${sizeBytes}`);
    }
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
        throw new Error(`分片大小非法：${chunkSize}`);
    }
    const partsDir = `${sourcePath}.parts`;
    return {
        partsDir,
        progressPath: `${partsDir}/upload.json`,
        sourcePath,
        totalParts: sizeBytes === 0 ? 0 : Math.ceil(sizeBytes / chunkSize),
        chunkSize,
    };
}
/** 计算第 index 个分片的字节范围。 */
export function chunkRange(index, chunkSize, totalBytes) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    return { start, end };
}
/**
 * 计算一个文件的分片哈希（用于校验断点续传的源文件没变）。
 *
 * 只哈希首尾各 64 KiB + 总长度，避免大文件全量读取。
 */
export function quickFileHash(fs, path) {
    const content = fs.readFile(path);
    const buffer = Buffer.from(content, 'utf8');
    const head = buffer.subarray(0, Math.min(64 * 1024, buffer.length));
    const tail = buffer.subarray(Math.max(0, buffer.length - 64 * 1024));
    return `sha256:${createHash('sha256').update(head).update(tail).update(String(buffer.length)).digest('hex')}`;
}
/** 读取上传进度；不存在或损坏时返回全新进度。 */
export function readProgress(fs, plan, fileHash, now) {
    if (!fs.exists(plan.progressPath)) {
        return {
            total_bytes: 0,
            chunk_size: plan.chunkSize,
            total_parts: plan.totalParts,
            completed_parts: [],
            file_hash: fileHash,
            updated_at: now,
        };
    }
    try {
        const parsed = JSON.parse(fs.readFile(plan.progressPath));
        // 源文件变了就重头开始，避免把两代文件的分片拼在一起
        if (parsed.file_hash !== fileHash || parsed.chunk_size !== plan.chunkSize || parsed.total_parts !== plan.totalParts) {
            return {
                total_bytes: parsed.total_bytes ?? 0,
                chunk_size: plan.chunkSize,
                total_parts: plan.totalParts,
                completed_parts: [],
                file_hash: fileHash,
                updated_at: now,
            };
        }
        const valid = (parsed.completed_parts ?? []).filter((index) => Number.isInteger(index) && index >= 0 && index < plan.totalParts);
        return { ...parsed, completed_parts: [...new Set(valid)].sort((a, b) => a - b) };
    }
    catch {
        // upload.json 损坏：重新开始，不抛错（云盘同步场景要求容错）
        return {
            total_bytes: 0,
            chunk_size: plan.chunkSize,
            total_parts: plan.totalParts,
            completed_parts: [],
            file_hash: fileHash,
            updated_at: now,
        };
    }
}
/** 写入上传进度。 */
export function writeProgress(fs, plan, progress) {
    fs.writeFile(plan.progressPath, `${JSON.stringify(progress, null, 2)}\n`);
}
/** 尚未完成的分片索引。 */
export function pendingParts(progress) {
    const done = new Set(progress.completed_parts);
    const pending = [];
    for (let index = 0; index < progress.total_parts; index += 1) {
        if (!done.has(index))
            pending.push(index);
    }
    return pending;
}
/** 是否已完成全部分片。 */
export function isComplete(progress) {
    return progress.total_parts > 0 && progress.completed_parts.length === progress.total_parts;
}
/** 进度百分比（0 ~ 1）。 */
export function progressRatio(progress) {
    if (progress.total_parts === 0)
        return 1;
    return progress.completed_parts.length / progress.total_parts;
}
/**
 * 把源文件切成单个分片并落盘，返回该分片的大小。
 *
 * 调用方（网盘适配器）随后会读取这个分片文件上传。
 */
export function writePart(fs, plan, sourceContent, index, totalBytes) {
    const { start, end } = chunkRange(index, plan.chunkSize, totalBytes);
    const buffer = Buffer.from(sourceContent, 'utf8');
    const slice = buffer.subarray(start, end);
    const path = `${plan.partsDir}/${partFileName(index)}`;
    fs.writeFile(path, slice.toString('utf8'));
    return { path, sizeBytes: slice.length };
}
/** 标记某个分片完成并写回进度。 */
export function markPartDone(fs, plan, progress, index, now) {
    if (progress.completed_parts.includes(index))
        return progress;
    const next = {
        ...progress,
        completed_parts: [...progress.completed_parts, index].sort((a, b) => a - b),
        updated_at: now,
    };
    writeProgress(fs, plan, next);
    return next;
}
/**
 * 合并全部分片为完整文件。
 *
 * 合并前校验分片齐全、大小一致；合并后删除 `.parts/` 目录。
 *
 * @returns 合并后的字节数
 */
export function mergeParts(fs, plan, progress, targetPath) {
    if (!isComplete(progress)) {
        throw new Error(`分片未完成：${progress.completed_parts.length}/${progress.total_parts}`);
    }
    const buffers = [];
    for (let index = 0; index < progress.total_parts; index += 1) {
        const partPath = `${plan.partsDir}/${partFileName(index)}`;
        if (!fs.exists(partPath)) {
            throw new Error(`分片缺失：${partFileName(index)}`);
        }
        buffers.push(Buffer.from(fs.readFile(partPath), 'utf8'));
    }
    const merged = Buffer.concat(buffers);
    fs.writeFile(targetPath, merged.toString('utf8'));
    // 合并成功后清理分片目录
    fs.remove(plan.partsDir);
    return merged.length;
}
/**
 * 端到端执行一次分片上传（本地部分）。
 *
 * 供测试与 CLI 使用；真实上传时由适配器逐片上传，
 * 每片成功后调用 {@link markPartDone} 即可实现断点续传。
 */
export function runChunkedUpload(options) {
    const { fs, sourcePath } = options;
    const now = options.now ?? new Date().toISOString();
    if (!fs.exists(sourcePath))
        throw new Error(`源文件不存在：${sourcePath}`);
    const info = fs.stat(sourcePath);
    if (info === undefined || !info.isFile)
        throw new Error(`不是文件：${sourcePath}`);
    const plan = planChunks(sourcePath, info.size, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    const fileHash = quickFileHash(fs, sourcePath);
    const existing = readProgress(fs, plan, fileHash, now);
    const resumed = existing.completed_parts.length > 0;
    let progress = { ...existing, total_bytes: info.size, file_hash: fileHash };
    writeProgress(fs, plan, progress);
    const content = fs.readFile(sourcePath);
    for (const index of pendingParts(progress)) {
        const part = writePart(fs, plan, content, index, info.size);
        options.onPart?.({ index, ...part });
        progress = markPartDone(fs, plan, progress, index, now);
    }
    return { progress, plan, resumed };
}
