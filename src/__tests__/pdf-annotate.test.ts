/**
 * PDF 注释测试（设计文档 1.5 / 2.4 / 3.3 / 4.2）。
 *
 * 重点：坐标翻转（阅读器左上原点 ↔ PDF 左下原点）是跨端批注最常见的错位来源。
 *
 * @module @bookstore/mylibrary-core/__tests__/pdf-annotate
 */

import { describe, expect, it } from 'vitest';

import type { Annotation, InkStroke } from '../types.js';
import {
  HIGHLIGHT_COLORS,
  annotationToPdfSpec,
  colorFor,
  fromPdfDate,
  hexToRgb,
  inkBounds,
  inkStrokeToInkList,
  pdfSpecToAnnotation,
  quadPointsFromRect,
  readerRectToPdf,
  readerToPdfPoint,
  rgbToHex,
  toPdfDate,
  encodePdfText,
  decodePdfText,
  requiresUtf16,
} from '../pdf-annotate.js';

const PAGE = { width: 595.28, height: 841.89 }; // A4

function makeHighlight(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'anno-1',
    type: 'highlight',
    anchor: { type: 'epubcfi', value: '' } as never,
    text: '黑暗森林法则',
    note: '与费米悖论呼应',
    color: 'yellow',
    created_at: '2026-10-16T10:00:00Z',
    updated_at: '2026-10-16T10:30:00Z',
    ...over,
  };
}

describe('坐标翻转（跨端批注的关键）', () => {
  it('阅读器左上原点 → PDF 左下原点', () => {
    // 阅读器顶部 (y=0) → PDF 顶部 (y=pageHeight)
    expect(readerToPdfPoint({ x: 100, y: 0 }, PAGE)).toEqual({ x: 100, y: PAGE.height });
    // 阅读器底部 (y=height) → PDF 的 y=0
    expect(readerToPdfPoint({ x: 100, y: PAGE.height }, PAGE)).toEqual({ x: 100, y: 0 });
    // 中间
    expect(readerToPdfPoint({ x: 0, y: 100 }, PAGE)).toEqual({ x: 0, y: PAGE.height - 100 });
  });

  it('矩形翻转后上下边正确交换', () => {
    // 阅读器里 y=100 起、高 20 的条带
    const rect = readerRectToPdf({ x: 50, y: 100, width: 200, height: 20 }, PAGE);
    expect(rect[0]).toBe(50); // x1 不变
    expect(rect[2]).toBe(250); // x2 不变
    // PDF 的 y1 对应阅读器的下边 y=120
    expect(rect[1]).toBeCloseTo(PAGE.height - 120, 5);
    // PDF 的 y2 对应阅读器的上边 y=100
    expect(rect[3]).toBeCloseTo(PAGE.height - 100, 5);
    // y1 < y2（PDF 里下边小于上边）
    expect(rect[1]).toBeLessThan(rect[3]);
  });

  it('QuadPoints 顺序为 左上 右上 左下 右下', () => {
    const quad = quadPointsFromRect([10, 20, 110, 40]);
    expect(quad).toEqual([
      10, 40, // 左上 (x1, y2)
      110, 40, // 右上 (x2, y2)
      10, 20, // 左下 (x1, y1)
      110, 20, // 右下 (x2, y1)
    ]);
  });
});

describe('颜色处理', () => {
  it('按名字取色，未知回落黄色', () => {
    expect(colorFor('green')).toEqual(HIGHLIGHT_COLORS['green']);
    expect(colorFor('not-a-color')).toEqual(HIGHLIGHT_COLORS['yellow']);
    expect(colorFor(undefined)).toEqual(HIGHLIGHT_COLORS['yellow']);
  });

  it('hex 转 RGB（含 alpha 前缀）', () => {
    expect(hexToRgb('#FF0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#00FF00')).toEqual([0, 1, 0]);
    expect(hexToRgb('#0000FF')).toEqual([0, 0, 1]);
    // 8 位带 alpha
    expect(hexToRgb('#80FF0000')).toEqual([1, 0, 0]);
  });

  it('非法 hex 回落红色', () => {
    expect(hexToRgb('nope')).toEqual([1, 0, 0]);
  });

  it('RGB 转 hex 往返', () => {
    expect(rgbToHex([1, 0, 0])).toBe('#ff0000');
    expect(rgbToHex([0, 0.5, 1])).toBe('#0080ff');
  });
});

describe('墨迹路径', () => {
  const stroke: InkStroke = {
    color: '#FF0000',
    width: 3,
    points: [
      { x: 100, y: 200, pressure: 0.5, t: 0 },
      { x: 120, y: 220, pressure: 0.6, t: 16 },
      { x: 140, y: 240, pressure: 0.7, t: 32 },
    ],
  };

  it('每笔每个点都转成 PDF 坐标并展开为扁平数组', () => {
    const inkList = inkStrokeToInkList(stroke, PAGE);
    expect(inkList).toHaveLength(1); // 一条路径
    expect(inkList[0]).toHaveLength(6); // 3 点 × 2 坐标
    expect(inkList[0]![0]).toBe(100);
    expect(inkList[0]![1]).toBeCloseTo(PAGE.height - 200, 5);
  });

  it('包围盒覆盖所有点并留边距', () => {
    const bounds = inkBounds([stroke], PAGE);
    // x 范围 100~140，留 2 边距
    expect(bounds[0]).toBeCloseTo(98, 5);
    expect(bounds[2]).toBeCloseTo(142, 5);
    // y 翻转后 240 变小、200 变大
    expect(bounds[1]).toBeCloseTo(PAGE.height - 240 - 2, 5);
    expect(bounds[3]).toBeCloseTo(PAGE.height - 200 + 2, 5);
  });

  it('空笔迹返回零矩形，不产生 NaN', () => {
    expect(inkBounds([], PAGE)).toEqual([0, 0, 0, 0]);
    expect(inkBounds([{ color: '#000', width: 1, points: [] }], PAGE)).toEqual([0, 0, 0, 0]);
  });
});

describe('annotationToPdfSpec', () => {
  it('高亮 → Highlight + QuadPoints', () => {
    const spec = annotationToPdfSpec(makeHighlight(), PAGE, { author: 'dsh' });
    expect(spec.subtype).toBe('Highlight');
    expect(spec.quadPoints).toHaveLength(8);
    expect(spec.color).toEqual(HIGHLIGHT_COLORS['yellow']);
    expect(spec.author).toBe('dsh');
    expect(spec.name).toBe('anno-1');
    expect(spec.contents).toContain('费米悖论');
  });

  it('笔记 → Text 便签', () => {
    const noteOnly: Annotation = {
      id: 'anno-note',
      type: 'note',
      anchor: { type: 'ink', page: 0 },
      note: '笔记正文',
      created_at: '2026-10-16T10:00:00Z',
      updated_at: '2026-10-16T10:00:00Z',
    };
    const spec = annotationToPdfSpec(noteOnly, PAGE);
    expect(spec.subtype).toBe('Text');
    expect(spec.opacity).toBe(1);
    expect(spec.contents).toContain('笔记正文');
  });

  it('墨迹 → Ink + InkList + 线宽', () => {
    const annotation: Annotation = {
      id: 'ink-1',
      type: 'ink',
      anchor: { type: 'ink', page: 3 },
      strokes: [{ color: '#00FF00', width: 4, points: [{ x: 10, y: 10, pressure: 1, t: 0 }, { x: 20, y: 20, pressure: 1, t: 8 }] }],
      created_at: '2026-10-16T10:00:00Z',
      updated_at: '2026-10-16T10:00:00Z',
    };
    const spec = annotationToPdfSpec(annotation, PAGE);
    expect(spec.subtype).toBe('Ink');
    expect(spec.page).toBe(3);
    expect(spec.inkList).toHaveLength(1);
    expect(spec.borderWidth).toBe(4);
    expect(spec.color).toEqual([0, 1, 0]);
  });

  it('缺少矩形时给出安全兜底，不写非法注释', () => {
    const spec = annotationToPdfSpec(makeHighlight(), PAGE);
    const [x1, y1, x2, y2] = spec.rect;
    expect(x2).toBeGreaterThan(x1);
    expect(y2).toBeGreaterThan(y1);
  });
});

describe('PDF 日期', () => {
  it('ISO → PDF 格式', () => {
    expect(toPdfDate('2026-10-16T10:30:00Z')).toBe('D:20261016103000Z');
  });

  it('PDF 格式 → ISO', () => {
    expect(fromPdfDate('D:20261016103000Z')).toBe('2026-10-16T10:30:00.000Z');
  });

  it('往返一致', () => {
    const iso = '2026-10-16T10:30:00.000Z';
    expect(fromPdfDate(toPdfDate(iso))).toBe(iso);
  });

  it('非法值回落到 epoch', () => {
    expect(toPdfDate('not-a-date')).toBe('D:19700101000000Z');
    expect(fromPdfDate('garbage')).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('pdfSpecToAnnotation（读回另一端写入的注释）', () => {
  it('Highlight 还原为 highlight 批注', () => {
    const annotation = pdfSpecToAnnotation(
      {
        subtype: 'Highlight',
        page: 2,
        rect: [10, 20, 110, 40],
        quadPoints: quadPointsFromRect([10, 20, 110, 40]),
        color: [1, 0.92, 0.31],
        opacity: 0.6,
        contents: '来自 dsh 的高亮',
        modifiedAt: 'D:20261016103000Z',
      },
      'read-1',
    );
    expect(annotation.type).toBe('highlight');
    expect(annotation.text).toBe('来自 dsh 的高亮');
    expect(annotation.updated_at).toBe('2026-10-16T10:30:00.000Z');
  });

  it('Text 还原为 note 批注', () => {
    const annotation = pdfSpecToAnnotation(
      { subtype: 'Text', page: 0, rect: [0, 0, 10, 10], color: [1, 1, 0], opacity: 1, contents: '便签内容' },
      'read-2',
    );
    expect(annotation.type).toBe('note');
    expect(annotation.note).toBe('便签内容');
  });

  it('Ink 还原为矢量笔迹（点坐标成对还原）', () => {
    const annotation = pdfSpecToAnnotation(
      {
        subtype: 'Ink',
        page: 1,
        rect: [0, 0, 100, 100],
        color: [1, 0, 0],
        opacity: 1,
        inkList: [[10, 20, 30, 40]],
        borderWidth: 3,
      },
      'read-3',
    );
    expect(annotation.type).toBe('ink');
    expect(annotation.strokes).toHaveLength(1);
    expect(annotation.strokes![0]!.points).toHaveLength(2);
    expect(annotation.strokes![0]!.points[0]).toMatchObject({ x: 10, y: 20 });
    expect(annotation.strokes![0]!.width).toBe(3);
    expect(annotation.strokes![0]!.color).toBe('#ff0000');
  });
});

describe('PDF 文本编码（中文乱码的根因）', () => {
  it('纯 ASCII 用普通字符串', () => {
    expect(encodePdfText('hello')).toBe('(hello)');
    expect(requiresUtf16('hello')).toBe(false);
  });

  it('中文必须用 UTF-16BE 十六进制串', () => {
    expect(requiresUtf16('黑暗森林')).toBe(true);
    const encoded = encodePdfText('黑暗');
    expect(encoded.startsWith('<FEFF')).toBe(true);
    expect(encoded.endsWith('>')).toBe(true);
  });

  it('编码后能解码回原文（中文）', () => {
    const text = '黑暗森林法则：猜疑链与技术爆炸';
    expect(decodePdfText(encodePdfText(text))).toBe(text);
  });

  it('编码后能解码回原文（ASCII）', () => {
    expect(decodePdfText(encodePdfText('hello world'))).toBe('hello world');
  });

  it('含 emoji 的补充平面字符也能往返', () => {
    const text = '三体 📚 黑暗森林';
    expect(decodePdfText(encodePdfText(text))).toBe(text);
  });

  it('ASCII 里的括号与反斜杠被转义', () => {
    const encoded = encodePdfText('a(b)c\\d');
    expect(encoded).toContain('\\\\');
    expect(encoded).toContain('\\(');
    expect(decodePdfText(encoded)).toBe('a(b)c\\d');
  });

  it('UTF-16 十六进制串按规范带 BOM', () => {
    const hex = encodePdfText('黑').slice(1, -1);
    expect(hex.startsWith('FEFF')).toBe(true);
    // 黑的码点 U+9ED1
    expect(hex.slice(4)).toBe('9ED1');
  });
});
