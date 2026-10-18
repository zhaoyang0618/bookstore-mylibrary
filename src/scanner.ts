/**
 * 本地导入流程（设计文档 2.5 / 3.4）：扫描目录、提取元数据、复制到 `books/{书名}/`。
 *
 * @module @bookstore/mylibrary-core/scanner
 */

import { basename, extname } from 'node:path';

import { bookFromFile, inferFormat, MyLibraryStore } from './store.js';
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
  skipped: { path: string; reason: string }[];
}

/** 支持的书籍扩展名。 */
const SCANNABLE: Record<string, BookFormat> = {
  '.epub': 'epub',
  '.pdf': 'pdf',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'txt',
};

/**
 * 阅读器不能直接渲染、需要先转换的格式（设计文档 2.3 / 阶段六）。
 *
 * 这些不是"不支持"，而是"要先转换"——扫描时给出明确提示，
 * 而不是静默跳过，否则用户会以为文件丢了。
 */
const NEEDS_CONVERSION: Record<string, { target: string; hint: string }> = {
  '.djvu': { target: 'pdf', hint: '用 convert_djvu_to_pdf（ddjvu）先转成 PDF 再导入' },
  '.djv': { target: 'pdf', hint: '用 convert_djvu_to_pdf（ddjvu）先转成 PDF 再导入' },
  '.mobi': { target: 'epub', hint: '用 convert_and_open（pandoc / calibre）先转成 EPUB 再导入' },
  '.azw3': { target: 'epub', hint: '用 convert_and_open 先转成 EPUB 再导入' },
  '.chm': { target: 'epub', hint: '用 convert_and_open 先转成 EPUB 再导入' },
};

/**
 * 扫描一个目录树，找出可作为书籍导入的文件。
 *
 * 跳过规则：
 * - 边车文件（`.notes.json`）、锁文件（`.lock.json`）
 * - 分片上传临时目录（`.parts/`）
 * - 隐藏文件
 */
export function scanDirectory(fs: MyLibraryStore['fs'], root: string): ScanResult {
  const books: ScannedBookFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.listDir(dir)) {
      if (name.startsWith('.')) {
        skipped.push({ path: `${dir}/${name}`, reason: '隐藏文件或目录' });
        continue;
      }
      const path = `${dir}/${name}`;
      const info = fs.stat(path);
      if (info === undefined) continue;
      if (info.isDirectory) {
        if (name.endsWith('.parts')) {
          skipped.push({ path, reason: '分片上传临时目录' });
          continue;
        }
        walk(path);
        continue;
      }
      if (!info.isFile) continue;
      const ext = extname(name).toLowerCase();
      if (name.endsWith('.notes.json') || name.endsWith('.lock.json')) {
        skipped.push({ path, reason: '元数据 / 锁文件' });
        continue;
      }
      const format = SCANNABLE[ext];
      if (format === undefined) {
        const conversion = NEEDS_CONVERSION[ext];
        if (conversion !== undefined) {
          skipped.push({
            path,
            reason: `需要先转换为 ${conversion.target.toUpperCase()}：${conversion.hint}`,
          });
          continue;
        }
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
export function importBookFile(store: MyLibraryStore, scanned: ScannedBookFile, options: { author?: string; makeId?: () => string } = {}): Book {
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
