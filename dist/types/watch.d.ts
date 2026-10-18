/**
 * 桌面端文件监视（设计文档阶段六：`chokidar` 等价实现）。
 *
 * 用途：网盘同步客户端在后台改写 `library.json` / 笔记边车时，
 * 本客户端能感知变化并刷新界面，而不是要求用户手动点"刷新"。
 *
 * 设计取舍：
 * - 用 `node:fs.watch` 而非 chokidar：零依赖，行为足够
 * - 防抖：网盘客户端常连续写多次（临时文件 → 改名），合并成一次回调
 * - 只关心 MyLibrary 里的关键文件，忽略 `.trash/`、`.parts/` 和二进制大文件
 *
 * @module @bookstore/mylibrary-core/watch
 */
import type { FileSystem } from './store.js';
/** 一次文件变化事件。 */
export interface LibraryChange {
    /** 变化类型。 */
    kind: 'library' | 'manifest' | 'notes' | 'wiki' | 'recording' | 'other';
    /** 变化的文件绝对路径。 */
    path: string;
    /** 事件时间（ISO 8601）。 */
    at: string;
}
/** 监视器配置。 */
export interface WatchOptions {
    /** MyLibrary 根目录。 */
    root: string;
    /** 变化回调。 */
    onChange: (change: LibraryChange) => void;
    /** 防抖窗口（毫秒），默认 300。 */
    debounceMs?: number;
    /** 是否递归监视子目录，默认 true。 */
    recursive?: boolean;
    /** 自定义错误处理。 */
    onError?: (error: Error) => void;
}
/** 监视器句柄。 */
export interface WatchHandle {
    /** 停止监视。 */
    close(): void;
    /** 是否仍在运行。 */
    readonly active: boolean;
}
/** 判断一个路径是否值得关心（过滤噪声）。 */
export declare function isRelevantPath(path: string): boolean;
/** 按文件名与路径归类变化类型。 */
export declare function classifyChange(path: string): LibraryChange['kind'];
/**
 * 启动一个 MyLibrary 目录监视器。
 *
 * @returns 句柄，调用 `close()` 停止
 */
export declare function watchLibrary(options: WatchOptions): WatchHandle;
/**
 * 轮询式监视（备选实现）。
 *
 * `fs.watch` 在网盘客户端写入时可能漏事件（尤其是跨设备挂载）。
 * 这里提供基于 mtime 的轮询版本，作为可靠性兜底。
 *
 * @returns 句柄
 */
export declare function pollLibrary(options: {
    fs: FileSystem;
    root: string;
    onChange: (change: LibraryChange) => void;
    intervalMs?: number;
    /** 需要轮询的文件（相对 root）。 */
    files?: string[];
}): WatchHandle;
