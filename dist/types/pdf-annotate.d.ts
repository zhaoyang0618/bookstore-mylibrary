/**
 * PDF 注释写回（设计文档 1.5 / 2.4 / 3.3 / 4.2）。
 *
 * ## 为什么单独一个模块
 *
 * 设计文档规定：PDF 的笔记**直接写回 PDF 文件本身**，不产生边车文件；
 * 并且必须以 **PDF 原生注释对象**为准，这样 dsh 版（PDF.js）与
 * Flutter 版（PDFium）写出的注释才能互相看见（设计文档 4.2「跨端批注」）。
 *
 * 因此这里不定义任何私有格式，只生成 PDF 规范里的原生注释：
 *
 * | 批注类型 | PDF 注释 Subtype |
 * |---|---|
 * | 高亮 | `/Highlight`（带 `/QuadPoints`） |
 * | 文本笔记 | `/Text`（便签） |
 * | 墨迹 | `/Ink`（带 `/InkList` 矢量路径） |
 *
 * 笔迹以**矢量**存储（点 + 压力 + 时间戳），而非截图——与设计文档 3.3 一致。
 *
 * @module @bookstore/mylibrary-core/pdf-annotate
 */
import type { Annotation, InkStroke } from './types.js';
/**
 * 判断文本是否必须用 UTF-16BE（PDF 的 `/HexString`）编码。
 *
 * PDF 的普通字符串（`(...)`）用 PDFDocEncoding，它**装不下中文**——
 * 直接写会变成乱码。凡是含非 ASCII 的文本，必须写成 UTF-16BE 十六进制串
 * `<FEFF...>`（BOM 开头），这样 PDFium / PDF.js / Acrobat 才能正确解码。
 *
 * 这是跨端批注中文乱码的根因，两个实现都必须遵守。
 */
export declare function requiresUtf16(text: string): boolean;
/**
 * 把一个 JS 字符串编码成 PDF 规范要求的字符串字面量形式。
 *
 * - 纯 ASCII → `(escaped text)`
 * - 含非 ASCII → `<FEFF...UTF-16BE hex>`
 *
 * 返回的是 PDF 语法片段，由调用方（pdf-lib / 自研写入器）直接写入。
 */
export declare function encodePdfText(text: string): string;
/**
 * 从 PDF 字符串字面量解码回 JS 字符串（`(...)` 或 `<...>`）。
 *
 * 用于读回另一端写入的注释内容。
 */
export declare function decodePdfText(literal: string): string;
/** PDF 页面尺寸（点，72 dpi）。 */
export interface PageSize {
    width: number;
    height: number;
}
/** 一个矩形区域（PDF 坐标：左下角原点，y 向上）。 */
export interface PdfRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
/**
 * 把「阅读器坐标」转成「PDF 坐标」。
 *
 * 阅读器（浏览器 / 平板）用左上角原点、y 向下；PDF 用左下角原点、y 向上。
 * 这是跨端批注最常见的错位来源，必须集中处理。
 */
export declare function readerToPdfPoint(point: {
    x: number;
    y: number;
}, pageSize: PageSize): {
    x: number;
    y: number;
};
/** 把阅读器坐标系下的矩形转成 PDF Rect 数组 `[x1, y1, x2, y2]`。 */
export declare function readerRectToPdf(rect: PdfRect, pageSize: PageSize): [number, number, number, number];
/**
 * 由 PDF Rect 生成 `/QuadPoints`。
 *
 * QuadPoints 顺序在规范里是：左上、右上、左下、右下（每点 x,y）。
 */
export declare function quadPointsFromRect(rect: [number, number, number, number]): number[];
/** 高亮颜色名 → RGB（0~1）。 */
export declare const HIGHLIGHT_COLORS: Record<string, [number, number, number]>;
/** 颜色名解析；未知颜色回落黄色。 */
export declare function colorFor(name: string | undefined): [number, number, number];
/** `#RRGGBB` / `#AARRGGBB` → PDF 的 0~1 RGB 三元组。 */
export declare function hexToRgb(hex: string): [number, number, number];
/**
 * 一条墨迹 → PDF `/Ink` 注释的 `/InkList`。
 *
 * `/InkList` 是「多条路径」的数组，每条路径是一串 x,y。
 * 这里把每笔的每个点都转成 PDF 坐标。
 */
export declare function inkStrokeToInkList(stroke: InkStroke, pageSize: PageSize): number[][];
/** 从墨迹的所有点算出包围盒（用于 `/Rect`）。 */
export declare function inkBounds(strokes: InkStroke[], pageSize: PageSize): [number, number, number, number];
/**
 * 描述一条待写入的 PDF 注释（与具体 PDF 库解耦）。
 *
 * 之所以不直接依赖 pdf-lib 的类型：Flutter 端用 PDFium 写入，
 * 这里定义的形状是两个实现都能对应上的**中间表示**。
 */
export interface PdfAnnotationSpec {
    /** PDF 注释子类型：Highlight / Text / Ink。 */
    subtype: 'Highlight' | 'Text' | 'Ink';
    /** 页面索引（0 起）。 */
    page: number;
    /** `[x1, y1, x2, y2]`，PDF 坐标。 */
    rect: [number, number, number, number];
    /** 高亮用的四边形点。 */
    quadPoints?: number[];
    /** 颜色 RGB（0~1）。 */
    color: [number, number, number];
    /** 不透明度（0~1）。 */
    opacity: number;
    /** 注释正文。 */
    contents?: string;
    /** 作者（写入 `T`）。 */
    author?: string;
    /** 唯一名（写入 `NM`），用于两端对齐同一条批注。 */
    name?: string;
    /** 修改时间（`D:YYYYMMDDHHmmSSZ`）。 */
    modifiedAt?: string;
    /** Ink 类型的路径列表。 */
    inkList?: number[][];
    /** 线宽（Ink 用）。 */
    borderWidth?: number;
}
/** 由数据层的 Annotation 生成 PDF 注释描述。 */
export declare function annotationToPdfSpec(annotation: Annotation, pageSize: PageSize, options?: {
    author?: string;
    page?: number;
}): PdfAnnotationSpec;
/** ISO 时间 → PDF 日期字符串 `D:YYYYMMDDHHmmSSZ`。 */
export declare function toPdfDate(iso: string): string;
/** PDF 日期字符串 → ISO 时间。 */
export declare function fromPdfDate(value: string): string;
/**
 * 把 PDF 注释描述还原成数据层的 Annotation。
 *
 * 这是「跨端可见」的另一半：从 PDF 里读回另一端写入的注释。
 */
export declare function pdfSpecToAnnotation(spec: PdfAnnotationSpec, annotationId: string, now?: string): Annotation;
/** RGB（0~1）→ `#RRGGBB`。 */
export declare function rgbToHex(rgb: [number, number, number]): string;
