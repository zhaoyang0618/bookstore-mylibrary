/**
 * MyLibrary 目录的文件系统访问层。
 *
 * 这一层只依赖 `node:fs`，不引入任何宿主框架，因此 dsh 工具插件（Node）、
 * CLI、以及未来的 Flutter 版（通过子进程调用 CLI）都能复用同一份逻辑。
 *
 * @module @bookstore/mylibrary-core/store
 */
import { type WikiGraph } from './wiki.js';
import type { Annotation, Book, BookFormat, DeleteOperation, Library, Manifest, NotesSidecar, Recording, SyncRequest, WikiPage } from './types.js';
/** 文件系统访问接口（便于测试时替换）。 */
export interface FileSystem {
    exists(path: string): boolean;
    readFile(path: string): string;
    writeFile(path: string, content: string): void;
    mkdir(path: string): void;
    listDir(path: string): string[];
    stat(path: string): {
        size: number;
        mtimeMs: number;
        isFile: boolean;
        isDirectory: boolean;
    } | undefined;
    remove(path: string): void;
    rename(from: string, to: string): void;
}
/** 基于 `node:fs` 的默认实现。 */
export declare const nodeFs: FileSystem;
/** 数据层抛出的可预期错误。 */
export declare class MyLibraryError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** 打开 / 初始化一个 MyLibrary 目录的入口。 */
export declare class MyLibraryStore {
    readonly root: string;
    readonly fs: FileSystem;
    /** 本客户端 id。 */
    clientId: string;
    constructor(root: string, options?: {
        fs?: FileSystem;
        clientId?: string;
    });
    /** 创建标准目录结构；已存在的目录不覆盖。 */
    init(): void;
    manifestPath(): string;
    libraryPath(): string;
    readManifest(): Manifest;
    writeManifest(manifest: Manifest): void;
    /** 记录本客户端上线。 */
    touchClient(client?: Omit<Manifest['clients'][number], 'last_seen'>): Manifest;
    readLibrary(): Library;
    writeLibrary(library: Library): void;
    /** 按 id 找书。 */
    findBook(id: string): Book | undefined;
    /** 按标题模糊搜索。 */
    searchBooks(query: string): Book[];
    /** 新增一本书（幂等：同 id 已存在则报错）。 */
    addBook(book: Book): Book;
    /** 更新一本书。 */
    updateBook(id: string, patch: Partial<Book>): Book;
    /** 按设计文档 1.8.5 的删除语义删除书籍。 */
    deleteBook(id: string, operation: DeleteOperation): void;
    /** 把相对路径解析为绝对路径。 */
    absolutePath(relativePath: string): string;
    /** 读取某本书的笔记边车（不存在时返回空边车）。 */
    readNotes(book: Book): NotesSidecar;
    /** 写入某本书的笔记边车。 */
    writeNotes(book: Book, notes: NotesSidecar): NotesSidecar;
    /** 追加一条批注。 */
    addAnnotation(book: Book, annotation: Annotation): Annotation;
    /** 删除一条批注。 */
    removeAnnotation(book: Book, annotationId: string): boolean;
    private defaultNotesPath;
    /** 列出全部 Wiki 页面。 */
    listWikiPages(): WikiPage[];
    /** 按 slug 读一个 Wiki 页面。 */
    readWikiPage(slug: string): WikiPage | undefined;
    /** 写入一个 Wiki 页面（按 slug 命名）。 */
    writeWikiPage(page: WikiPage): WikiPage;
    /** 重建 wiki/index.json。 */
    rebuildWikiIndex(): void;
    /** 构建 Wiki 图谱。 */
    buildWikiGraph(): WikiGraph;
    /** 列出某本书的录课视频元数据。 */
    listRecordings(book: Book): Recording[];
    /** 写入一条录课视频元数据（与视频文件同名）。 */
    writeRecording(recording: Recording): Recording;
    /** 大文件分片上传的进度文件（1.8.6）。 */
    partsDir(fileName: string, bookId: string): string;
    /** 列出全部同步请求。 */
    listSyncRequests(): SyncRequest[];
    /** 写入一条同步请求。 */
    writeSyncRequest(request: SyncRequest): SyncRequest;
    /** 完成一条同步请求（删除请求文件）。 */
    fulfillSyncRequest(requestId: string): void;
    /**
     * 迁移到当前 schema 版本。迁移前自动备份到 `.trash/schema-migration-{date}/`。
     *
     * 与 {@link readManifest} / {@link readLibrary} 不同，这里允许读取**次版本更高**的文档
     * （那是迁移的唯一场景），只备份 + 改写 `schema_version`，不改动其它内容。
     */
    migrate(): {
        backedUpTo: string | undefined;
        migrated: string[];
    };
    private readJson;
    /**
     * 解析 + 结构校验，但**不做 schema 兼容性断言**。
     * 迁移流程需要读取次版本更高的文档，因此单独走这条路。
     */
    private readJsonRaw;
    private writeJson;
}
/** 从已有文件提取书籍元数据（设计文档 2.5 / 3.4 的本地导入流程）。 */
export declare function bookFromFile(options: {
    id: string;
    title: string;
    author: string;
    relativePath: string;
    sizeBytes: number;
    format?: BookFormat;
    fileHash?: string;
    now?: string;
}): Book;
/** 由扩展名推断书籍格式。 */
export declare function inferFormat(path: string): BookFormat;
