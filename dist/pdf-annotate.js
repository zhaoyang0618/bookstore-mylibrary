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
/**
 * 判断文本是否必须用 UTF-16BE（PDF 的 `/HexString`）编码。
 *
 * PDF 的普通字符串（`(...)`）用 PDFDocEncoding，它**装不下中文**——
 * 直接写会变成乱码。凡是含非 ASCII 的文本，必须写成 UTF-16BE 十六进制串
 * `<FEFF...>`（BOM 开头），这样 PDFium / PDF.js / Acrobat 才能正确解码。
 *
 * 这是跨端批注中文乱码的根因，两个实现都必须遵守。
 */
export function requiresUtf16(text) {
    // ASCII 可打印范围之外（含中文、emoji）都需要 UTF-16
    return /[^\x00-\x7F]/.test(text);
}
/**
 * 把一个 JS 字符串编码成 PDF 规范要求的字符串字面量形式。
 *
 * - 纯 ASCII → `(escaped text)`
 * - 含非 ASCII → `<FEFF...UTF-16BE hex>`
 *
 * 返回的是 PDF 语法片段，由调用方（pdf-lib / 自研写入器）直接写入。
 */
export function encodePdfText(text) {
    if (!requiresUtf16(text)) {
        // 转义 PDF 字符串里的特殊字符
        const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        return `(${escaped})`;
    }
    // UTF-16BE + BOM
    const bytes = [0xfe, 0xff];
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code > 0xffff) {
            // 补充平面：拆成代理对
            const adjusted = code - 0x10000;
            const high = 0xd800 + (adjusted >> 10);
            const low = 0xdc00 + (adjusted & 0x3ff);
            bytes.push((high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff);
        }
        else {
            bytes.push((code >> 8) & 0xff, code & 0xff);
        }
    }
    return `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}>`;
}
/**
 * 从 PDF 字符串字面量解码回 JS 字符串（`(...)` 或 `<...>`）。
 *
 * 用于读回另一端写入的注释内容。
 */
export function decodePdfText(literal) {
    const trimmed = literal.trim();
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        const hex = trimmed.slice(1, -1);
        const bytes = [];
        for (let i = 0; i + 1 < hex.length; i += 2) {
            bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
        }
        // 跳过 UTF-16BE BOM
        const start = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
        let result = '';
        for (let i = start; i + 1 < bytes.length; i += 2) {
            result += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        }
        return result;
    }
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        return trimmed.slice(1, -1).replace(/\\([()\\])/g, '$1');
    }
    return trimmed;
}
/**
 * 把「阅读器坐标」转成「PDF 坐标」。
 *
 * 阅读器（浏览器 / 平板）用左上角原点、y 向下；PDF 用左下角原点、y 向上。
 * 这是跨端批注最常见的错位来源，必须集中处理。
 */
export function readerToPdfPoint(point, pageSize) {
    return { x: point.x, y: pageSize.height - point.y };
}
/** 把阅读器坐标系下的矩形转成 PDF Rect 数组 `[x1, y1, x2, y2]`。 */
export function readerRectToPdf(rect, pageSize) {
    const x1 = rect.x;
    const x2 = rect.x + rect.width;
    // 翻转 y：阅读器的上边 → PDF 的大 y
    const y1 = pageSize.height - (rect.y + rect.height);
    const y2 = pageSize.height - rect.y;
    return [x1, y1, x2, y2];
}
/**
 * 由 PDF Rect 生成 `/QuadPoints`。
 *
 * QuadPoints 顺序在规范里是：左上、右上、左下、右下（每点 x,y）。
 */
export function quadPointsFromRect(rect) {
    const [x1, y1, x2, y2] = rect;
    return [
        x1, y2, // 左上
        x2, y2, // 右上
        x1, y1, // 左下
        x2, y1, // 右下
    ];
}
/** 高亮颜色名 → RGB（0~1）。 */
export const HIGHLIGHT_COLORS = {
    yellow: [1.0, 0.92, 0.31],
    green: [0.62, 0.94, 0.69],
    blue: [0.71, 0.85, 1.0],
    pink: [0.98, 0.78, 0.86],
    red: [1.0, 0.6, 0.6],
    purple: [0.85, 0.72, 0.98],
};
/** 颜色名解析；未知颜色回落黄色。 */
export function colorFor(name) {
    return HIGHLIGHT_COLORS[name ?? 'yellow'] ?? HIGHLIGHT_COLORS['yellow'];
}
/** `#RRGGBB` / `#AARRGGBB` → PDF 的 0~1 RGB 三元组。 */
export function hexToRgb(hex) {
    const normalized = hex.replace(/^#/, '');
    const rgbHex = normalized.length === 8 ? normalized.slice(2) : normalized;
    if (!/^[0-9a-fA-F]{6}$/.test(rgbHex))
        return [1, 0, 0];
    return [
        Number.parseInt(rgbHex.slice(0, 2), 16) / 255,
        Number.parseInt(rgbHex.slice(2, 4), 16) / 255,
        Number.parseInt(rgbHex.slice(4, 6), 16) / 255,
    ];
}
/**
 * 一条墨迹 → PDF `/Ink` 注释的 `/InkList`。
 *
 * `/InkList` 是「多条路径」的数组，每条路径是一串 x,y。
 * 这里把每笔的每个点都转成 PDF 坐标。
 */
export function inkStrokeToInkList(stroke, pageSize) {
    const path = [];
    for (const point of stroke.points) {
        const flipped = readerToPdfPoint(point, pageSize);
        path.push(flipped.x, flipped.y);
    }
    return [path];
}
/** 从墨迹的所有点算出包围盒（用于 `/Rect`）。 */
export function inkBounds(strokes, pageSize) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const stroke of strokes) {
        for (const point of stroke.points) {
            const p = readerToPdfPoint(point, pageSize);
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
    }
    if (!Number.isFinite(minX))
        return [0, 0, 0, 0];
    // 留一点边距，避免零面积矩形
    const pad = 2;
    return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}
/** 由数据层的 Annotation 生成 PDF 注释描述。 */
export function annotationToPdfSpec(annotation, pageSize, options = {}) {
    const page = options.page ?? (annotation.anchor.type === 'ink' ? annotation.anchor.page : 0);
    const author = options.author ?? 'MyLibrary';
    const modifiedAt = toPdfDate(annotation.updated_at);
    const base = {
        page,
        author,
        name: annotation.id,
        modifiedAt,
        opacity: 0.6,
    };
    switch (annotation.type) {
        case 'highlight': {
            // 高亮位置来自 anchor（reading position 由阅读器提供矩形）
            const rect = extractRect(annotation, pageSize);
            return {
                ...base,
                subtype: 'Highlight',
                rect,
                quadPoints: quadPointsFromRect(rect),
                color: colorFor(annotation.color),
                contents: annotation.note ?? annotation.text ?? '',
            };
        }
        case 'note': {
            const rect = extractRect(annotation, pageSize);
            return {
                ...base,
                subtype: 'Text',
                rect,
                color: colorFor(annotation.color),
                contents: annotation.note ?? annotation.text ?? '',
                opacity: 1,
            };
        }
        case 'ink': {
            const strokes = annotation.strokes ?? [];
            const rect = inkBounds(strokes, pageSize);
            const inkList = strokes.flatMap((stroke) => inkStrokeToInkList(stroke, pageSize));
            const firstColor = strokes[0]?.color;
            return {
                ...base,
                subtype: 'Ink',
                rect,
                color: firstColor !== undefined ? hexToRgb(firstColor) : [1, 0, 0],
                contents: annotation.note ?? '',
                inkList,
                borderWidth: strokes[0]?.width ?? 2,
                opacity: 1,
            };
        }
    }
}
/**
 * 从批注里取出矩形。
 *
 * 数据契约里高亮锚点是 epubcfi / line_range / char_offset 之一，
 * 不含矩形——矩形由阅读器在渲染时算出来并存进 `anchor.rect`。
 * 这里做兼容读取，缺失时给一个安全默认值。
 */
function extractRect(annotation, pageSize) {
    const anchor = annotation.anchor;
    if (anchor.rect !== undefined)
        return readerRectToPdf(anchor.rect, pageSize);
    // 兜底：页面顶部一个 200x20 的条带，避免写出非法注释
    return [72, pageSize.height - 100, 272, pageSize.height - 80];
}
/** ISO 时间 → PDF 日期字符串 `D:YYYYMMDDHHmmSSZ`。 */
export function toPdfDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return 'D:19700101000000Z';
    const pad = (n) => String(n).padStart(2, '0');
    return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}
/** PDF 日期字符串 → ISO 时间。 */
export function fromPdfDate(value) {
    const match = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value);
    if (match === null)
        return new Date(0).toISOString();
    const [, y, mo, d, h, mi, s] = match;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))).toISOString();
}
/**
 * 把 PDF 注释描述还原成数据层的 Annotation。
 *
 * 这是「跨端可见」的另一半：从 PDF 里读回另一端写入的注释。
 */
export function pdfSpecToAnnotation(spec, annotationId, now = new Date().toISOString()) {
    const createdAt = spec.modifiedAt !== undefined ? fromPdfDate(spec.modifiedAt) : now;
    const anchor = spec.page !== undefined ? { type: 'ink', page: spec.page } : { type: 'ink', page: 0 };
    if (spec.subtype === 'Highlight') {
        return {
            id: annotationId,
            type: 'highlight',
            // 矩形信息由 anchor 扩展承载（PDF 注释本质是页面坐标，没有 CFI）
            anchor: { type: 'ink', page: spec.page },
            ...(spec.contents !== undefined ? { text: spec.contents } : {}),
            color: 'yellow',
            created_at: createdAt,
            updated_at: createdAt,
        };
    }
    if (spec.subtype === 'Text') {
        return {
            id: annotationId,
            type: 'note',
            anchor: { type: 'ink', page: spec.page },
            ...(spec.contents !== undefined ? { note: spec.contents } : {}),
            created_at: createdAt,
            updated_at: createdAt,
        };
    }
    // Ink：把 inkList 还原成 strokes
    const strokes = (spec.inkList ?? []).map((path) => {
        const points = [];
        for (let i = 0; i + 1 < path.length; i += 2) {
            points.push({ x: path[i], y: path[i + 1], pressure: 1, t: i / 2 });
        }
        return { points, color: rgbToHex(spec.color), width: spec.borderWidth ?? 2 };
    });
    return {
        id: annotationId,
        type: 'ink',
        anchor,
        strokes,
        ...(spec.contents !== undefined ? { note: spec.contents } : {}),
        created_at: createdAt,
        updated_at: createdAt,
    };
}
/** RGB（0~1）→ `#RRGGBB`。 */
export function rgbToHex(rgb) {
    const toByte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return `#${toByte(rgb[0])}${toByte(rgb[1])}${toByte(rgb[2])}`;
}
