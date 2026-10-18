/**
 * 本地导入流程（设计文档 2.5 / 3.4）：扫描目录、提取元数据、复制到 `books/{书名}/`。
 *
 * @module @bookstore/mylibrary-core/scanner
 */
import { MyLibraryStore } from './store.js';
import type { Book, BookFormat } from './types.js';
/** 扫描到的一个候选书籍文件。 */
export interface ScannedBookFile {
    /** 文件的绝对路径。 */
    absolutePath: string;
    /** 文件名，如 `三体.epub`。 */
    fileName: string;
    /** 去掉扩展名的标题。 */
    title: string;
    format: BookFormat;
    sizeBytes: number;
}
/** 扫描结果。 */
export interface ScanResult {
    books: ScannedBookFile[];
    /** 被跳过的文件及原因。 */
    skipped: {
        path: string;
        reason: string;
    }[];
}
/**
 * 扫描一个目录树，找出可作为书籍导入的文件。
 *
 * 跳过规则：
 * - 边车文件（`.notes.json`）、锁文件（`.lock.json`）
 * - 分片上传临时目录（`.parts/`）
 * - 隐藏文件
 */
export declare function scanDirectory(fs: MyLibraryStore['fs'], root: string): ScanResult;
/** 导入一个候选文件：复制到 `books/{title}/` 并在 library.json 中登记。 */
export declare function importBookFile(store: MyLibraryStore, scanned: ScannedBookFile, options?: {
    author?: string;
    makeId?: () => string;
}): Book;
