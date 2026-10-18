/**
 * 本地导入流程（设计文档 2.5 / 3.4）：扫描目录、提取元数据、复制到 `books/{书名}/`。
 *
 * @module @bookstore/mylibrary-core/scanner
 */
import { basename, extname } from 'node:path';
import { bookFromFile, inferFormat, MyLibraryStore } from './store.js';
/** 支持的书籍扩展名。 */
const SCANNABLE = {
    '.epub': 'epub',
    '.pdf': 'pdf',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.txt': 'txt',
};
/**
 * 扫描一个目录树，找出可作为书籍导入的文件。
 *
 * 跳过规则：
 * - 边车文件（`.notes.json`）、锁文件（`.lock.json`）
 * - 分片上传临时目录（`.parts/`）
 * - 隐藏文件
 */
export function scanDirectory(fs, root) {
    const books = [];
    const skipped = [];
    const walk = (dir) => {
        for (const name of fs.listDir(dir)) {
            if (name.startsWith('.')) {
                skipped.push({ path: `${dir}/${name}`, reason: '隐藏文件或目录' });
                continue;
            }
            const path = `${dir}/${name}`;
            const info = fs.stat(path);
            if (info === undefined)
                continue;
            if (info.isDirectory) {
                if (name.endsWith('.parts')) {
                    skipped.push({ path, reason: '分片上传临时目录' });
                    continue;
                }
                walk(path);
                continue;
            }
            if (!info.isFile)
                continue;
            const ext = extname(name).toLowerCase();
            if (name.endsWith('.notes.json') || name.endsWith('.lock.json')) {
                skipped.push({ path, reason: '元数据 / 锁文件' });
                continue;
            }
            const format = SCANNABLE[ext];
            if (format === undefined) {
                skipped.push({ path, reason: '不支持的扩展名' });
                continue;
            }
            books.push({
                absolutePath: path,
                fileName: name,
                title: basename(name, ext),
                format,
                sizeBytes: info.size,
            });
        }
    };
    walk(root);
    return { books, skipped };
}
/** 导入一个候选文件：复制到 `books/{title}/` 并在 library.json 中登记。 */
export function importBookFile(store, scanned, options = {}) {
    const format = inferFormat(scanned.absolutePath);
    const relativePath = `books/${scanned.title}/${scanned.fileName}`;
    const book = bookFromFile({
        id: options.makeId?.() ?? `book-${scanned.title}`,
        title: scanned.title,
        author: options.author ?? '未知作者',
        relativePath,
        sizeBytes: scanned.sizeBytes,
        format,
    });
    // 复制文件本体（复制而非移动，保留源目录）
    const content = store.fs.readFile(scanned.absolutePath);
    store.fs.writeFile(store.absolutePath(relativePath), content);
    store.fs.mkdir(store.absolutePath(`books/${scanned.title}/recordings`));
    return store.addBook(book);
}
