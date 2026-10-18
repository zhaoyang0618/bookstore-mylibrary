/**
 * PDF 注释的**实际写入与读取**（设计文档 1.5 / 4.2）。
 *
 * `pdf-annotate.ts` 只负责「什么该写」（与库无关的中间表示）；
 * 本模块负责「怎么写到文件里」，用 `pdf-lib` 生成标准 PDF 注释对象。
 *
 * 拆开的原因：Flutter 版用 PDFium FFI 写入，完全不需要 pdf-lib，
 * 但两个实现必须产出**同一种注释结构**，所以中间表示必须独立。
 *
 * ## 中文编码
 *
 * PDF 的普通字符串 `(...)` 用 PDFDocEncoding，**装不下中文**。
 * 所有含非 ASCII 的文本（`/Contents`、`/T`、`/NM`）必须写成
 * UTF-16BE 的十六进制串 `<FEFF...>`，否则读回是乱码。
 * 这里统一走 `PDFHexString.fromText`，并由测试守护。
 *
 * @module @bookstore/mylibrary-core/pdf-writer
 */
import type { Annotation } from './types.js';
/** 写入结果。 */
export interface WriteAnnotationsResult {
    /** 写入的批注数量。 */
    written: number;
    /** 输出文件路径。 */
    path: string;
    /** 输出字节数。 */
    bytes: number;
}
/**
 * 把一批批注写回 PDF 文件。
 *
 * @param pdfPath - 源 PDF 路径
 * @param annotations - 待写入的批注
 * @param options.outputPath - 输出路径，默认覆盖源文件
 * @param options.author - 写入 `/T` 的作者名（区分客户端）
 */
export declare function writeAnnotationsToPdf(pdfPath: string, annotations: Annotation[], options?: {
    outputPath?: string;
    author?: string;
}): Promise<WriteAnnotationsResult>;
/** 从 PDF 读回的结果。 */
export interface ReadAnnotationsResult {
    annotations: Annotation[];
    /** 被跳过（无法解析）的注释数。 */
    skipped: number;
}
/**
 * 从 PDF 文件读回注释。
 *
 * 用于验证「另一端写入的注释能被看到」（设计文档 4.2 跨端批注）。
 * 只读 `/Highlight` `/Text` `/Ink`，忽略 `/Link` 等排版注释。
 */
export declare function readAnnotationsFromPdf(pdfPath: string, options?: {
    pageIndexes?: number[];
}): Promise<ReadAnnotationsResult>;
