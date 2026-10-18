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

import { readFileSync, writeFileSync } from 'node:fs';

import { annotationToPdfSpec, type PageSize, type PdfAnnotationSpec } from './pdf-annotate.js';
import type { Annotation } from './types.js';

/** 动态加载 pdf-lib（可选依赖，未安装时给出清晰错误）。 */
async function loadPdfLib(): Promise<typeof import('pdf-lib')> {
  try {
    return await import('pdf-lib');
  } catch {
    throw new Error(
      '写回 PDF 注释需要 pdf-lib。请安装：npm install pdf-lib（或 pnpm add pdf-lib）。' +
        '若你只需要读取/校验 PDF，可以不装。',
    );
  }
}

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
export async function writeAnnotationsToPdf(
  pdfPath: string,
  annotations: Annotation[],
  options: { outputPath?: string; author?: string } = {},
): Promise<WriteAnnotationsResult> {
  const { PDFDocument, PDFName, PDFArray, PDFHexString, PDFString, PDFDict } = await loadPdfLib();

  const bytes = readFileSync(pdfPath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const sizes = new Map<number, PageSize>();
  const pageSize = (index: number): PageSize => {
    const cached = sizes.get(index);
    if (cached !== undefined) return cached;
    const page = doc.getPage(index);
    const { width, height } = page.getSize();
    const size = { width, height };
    sizes.set(index, size);
    return size;
  };

  let written = 0;
  for (const annotation of annotations) {
    const pageIndex = resolvePageIndex(annotation);
    if (pageIndex < 0 || pageIndex >= doc.getPageCount()) continue;
    const size = pageSize(pageIndex);
    const spec = annotationToPdfSpec(annotation, size, {
      author: options.author ?? 'MyLibrary',
      page: pageIndex,
    });
    appendAnnotation(doc, pageIndex, spec, { PDFName, PDFArray, PDFHexString, PDFString, PDFDict });
    written += 1;
  }

  const saved = await doc.save({ useObjectStreams: false });
  const target = options.outputPath ?? pdfPath;
  writeFileSync(target, saved);
  return { written, path: target, bytes: saved.length };
}

/** 由批注推断页索引。 */
function resolvePageIndex(annotation: Annotation): number {
  const anchor = annotation.anchor as unknown as { page?: number };
  return typeof anchor.page === 'number' ? anchor.page : 0;
}

/** 把一个注释描述追加到指定页的 `/Annots` 数组。 */
function appendAnnotation(
  doc: Awaited<ReturnType<typeof import('pdf-lib').PDFDocument.load>>,
  pageIndex: number,
  spec: PdfAnnotationSpec,
  pdf: Pick<typeof import('pdf-lib'), 'PDFName' | 'PDFArray' | 'PDFHexString' | 'PDFString' | 'PDFDict'>,
): void {
  const { PDFName, PDFArray, PDFHexString, PDFString, PDFDict } = pdf;
  const page = doc.getPage(pageIndex);

  // 用 PDFDict 逐项 set，避免 context.obj 的联合类型限制
  const dict = doc.context.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Subtype'), PDFName.of(spec.subtype));
  dict.set(PDFName.of('Rect'), doc.context.obj(spec.rect));
  dict.set(PDFName.of('C'), doc.context.obj(spec.color));
  dict.set(PDFName.of('CA'), doc.context.obj(spec.opacity));
  dict.set(PDFName.of('F'), doc.context.obj(4)); // Print
  // 中文必须 UTF-16BE，否则读回乱码
  dict.set(PDFName.of('T'), PDFHexString.fromText(spec.author ?? 'MyLibrary'));
  dict.set(PDFName.of('Contents'), PDFHexString.fromText(spec.contents ?? ''));
  dict.set(PDFName.of('NM'), PDFHexString.fromText(spec.name ?? ''));
  if (spec.modifiedAt !== undefined) {
    dict.set(PDFName.of('M'), PDFString.of(spec.modifiedAt));
  }
  if (spec.quadPoints !== undefined) {
    dict.set(PDFName.of('QuadPoints'), doc.context.obj(spec.quadPoints));
  }
  if (spec.inkList !== undefined) {
    dict.set(PDFName.of('InkList'), doc.context.obj(spec.inkList));
  }
  if (spec.borderWidth !== undefined) {
    const bs = doc.context.obj({});
    bs.set(PDFName.of('W'), doc.context.obj(spec.borderWidth));
    dict.set(PDFName.of('BS'), bs);
  }

  const ref = doc.context.register(dict);

  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (existing !== undefined) {
    existing.push(ref);
  } else {
    const array = doc.context.obj([ref]);
    page.node.set(PDFName.of('Annots'), array);
  }
}

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
export async function readAnnotationsFromPdf(
  pdfPath: string,
  options: { pageIndexes?: number[] } = {},
): Promise<ReadAnnotationsResult> {
  const { PDFDocument, PDFName, PDFArray, PDFDict } = await loadPdfLib();
  const doc = await PDFDocument.load(readFileSync(pdfPath), { updateMetadata: false });

  const pages = options.pageIndexes ?? Array.from({ length: doc.getPageCount() }, (_, index) => index);
  const annotations: Annotation[] = [];
  let skipped = 0;

  for (const pageIndex of pages) {
    if (pageIndex < 0 || pageIndex >= doc.getPageCount()) continue;
    const page = doc.getPage(pageIndex);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots === undefined) continue;

    for (let i = 0; i < annots.size(); i += 1) {
      const dict = doc.context.lookupMaybe(annots.get(i), PDFDict);
      if (dict === undefined) {
        skipped += 1;
        continue;
      }
      const subtype = dict.get(PDFName.of('Subtype'))?.toString();
      if (subtype !== '/Highlight' && subtype !== '/Text' && subtype !== '/Ink') continue;

      try {
        const contents = decodeTextValue(dict.get(PDFName.of('Contents')));
        const name = decodeTextValue(dict.get(PDFName.of('NM')));
        const modified = decodeTextValue(dict.get(PDFName.of('M')));
        const rect = readNumberArray(dict.get(PDFName.of('Rect')));
        const color = readNumberArray(dict.get(PDFName.of('C')));
        const inkList = readInkList(dict.get(PDFName.of('InkList')));

        annotations.push(buildAnnotation({
          subtype,
          pageIndex,
          ...(contents !== undefined ? { contents } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(modified !== undefined ? { modified } : {}),
          ...(rect !== undefined ? { rect } : {}),
          color: color !== undefined && color.length >= 3 ? [color[0]!, color[1]!, color[2]!] : [1, 0.92, 0.31],
          ...(inkList !== undefined ? { inkList } : {}),
        }));
      } catch {
        skipped += 1;
      }
    }
  }

  return { annotations, skipped };
}

/** 把 PDF 里的值解码成字符串（兼容普通串与十六进制串）。 */
function decodeTextValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const candidate = value as { decodeText?: () => string; toString: () => string };
  if (typeof candidate.decodeText === 'function') {
    try {
      return candidate.decodeText();
    } catch {
      // 落到 toString
    }
  }
  const raw = candidate.toString();
  if (raw.startsWith('<') && raw.endsWith('>')) {
    const hex = raw.slice(1, -1);
    const bytes: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
    const start = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
    let out = '';
    for (let i = start; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return out;
  }
  return raw.replace(/^\(|\)$/g, '');
}

/** 读取 PDF 数字数组（`[1 2 3]`）。 */
function readNumberArray(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  const arr = value as { asArray?: () => unknown[]; toString: () => string };
  if (typeof arr.asArray === 'function') {
    const items = arr.asArray();
    const numbers = items.map((item) => Number((item as { asNumber?: () => number }).asNumber?.() ?? Number.NaN));
    if (numbers.every((n) => Number.isFinite(n))) return numbers;
  }
  // 兜底：从字符串解析
  const raw = arr.toString().replace(/[[\]]/g, ' ');
  const numbers = raw.split(/\s+/).filter((s) => s.length > 0).map(Number);
  return numbers.every((n) => Number.isFinite(n)) ? numbers : undefined;
}

/** 读取 `/InkList`：数组的数组。 */
function readInkList(value: unknown): number[][] | undefined {
  if (value === undefined || value === null) return undefined;
  const outer = value as { asArray?: () => unknown[] };
  if (typeof outer.asArray !== 'function') return undefined;
  const paths: number[][] = [];
  for (const pathValue of outer.asArray()) {
    const numbers = readNumberArray(pathValue);
    if (numbers !== undefined && numbers.length > 0) paths.push(numbers);
  }
  return paths.length > 0 ? paths : undefined;
}

/** 由读回的原始字段构造数据层批注。 */
function buildAnnotation(input: {
  subtype: string;
  pageIndex: number;
  contents?: string;
  name?: string;
  modified?: string;
  rect?: number[];
  color: [number, number, number];
  inkList?: number[][];
}): Annotation {
  const id = input.name !== undefined && input.name.length > 0
    ? input.name
    : `pdf-anno-${input.pageIndex}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const timestamp = input.modified !== undefined ? fromPdfDateSafe(input.modified) : now;
  const anchor = { type: 'ink' as const, page: input.pageIndex };

  if (input.subtype === '/Highlight') {
    return {
      id,
      type: 'highlight',
      anchor,
      ...(input.contents !== undefined && input.contents.length > 0 ? { text: input.contents } : {}),
      color: 'yellow',
      created_at: timestamp,
      updated_at: timestamp,
    };
  }
  if (input.subtype === '/Text') {
    return {
      id,
      type: 'note',
      anchor,
      ...(input.contents !== undefined && input.contents.length > 0 ? { note: input.contents } : {}),
      created_at: timestamp,
      updated_at: timestamp,
    };
  }
  const strokes = (input.inkList ?? []).map((path) => {
    const points = [];
    for (let i = 0; i + 1 < path.length; i += 2) {
      points.push({ x: path[i]!, y: path[i + 1]!, pressure: 1, t: i / 2 });
    }
    return { points, color: rgbToHexLocal(input.color), width: 2 };
  });
  return {
    id,
    type: 'ink',
    anchor,
    strokes,
    ...(input.contents !== undefined && input.contents.length > 0 ? { note: input.contents } : {}),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/** 宽松解析 PDF 日期，失败回落到当前时间。 */
function fromPdfDateSafe(value: string): string {
  const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value);
  if (match === null) return new Date().toISOString();
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toISOString();
}

/** RGB（0~1）→ `#RRGGBB`。 */
function rgbToHexLocal(rgb: [number, number, number]): string {
  const toByte = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${toByte(rgb[0])}${toByte(rgb[1])}${toByte(rgb[2])}`;
}
