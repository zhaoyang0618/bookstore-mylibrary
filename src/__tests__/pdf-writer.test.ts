/**
 * PDF 注释写入/读回测试（设计文档 1.5 / 4.2 跨端批注）。
 *
 * 这些测试**真的读写 PDF 文件**，验证：
 * - 标准 PDF 注释对象（/Highlight /Text /Ink）被生成
 * - 中文内容不亂码（UTF-16BE 编码）
 * - 写入后能原样读回（模拟另一端的读取）
 *
 * @module @bookstore/mylibrary-core/__tests__/pdf-writer
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Annotation } from '../types.js';
import { readAnnotationsFromPdf, writeAnnotationsToPdf } from '../pdf-writer.js';

// describe.skipIf 在模块加载时求值，早于 beforeAll，必须用顶层 await 探测
const hasPdfLib = await import('pdf-lib').then(
  () => true,
  () => false,
);

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pdf-writer-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** 造一个最小 PDF（用 pdf-lib）。 */
async function makeBasePdf(path: string, pages = 2): Promise<void> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([595.28, 841.89]); // A4
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path, await doc.save({ useObjectStreams: false }));
}

const HIGHLIGHT: Annotation = {
  id: 'hl-1',
  type: 'highlight',
  anchor: { type: 'ink', page: 0, rect: { x: 72, y: 120, width: 300, height: 18 } } as never,
  text: '黑暗森林法则',
  note: '跨端批注测试',
  color: 'yellow',
  created_at: '2026-10-18T13:00:00Z',
  updated_at: '2026-10-18T13:00:00Z',
};

const NOTE: Annotation = {
  id: 'note-1',
  type: 'note',
  anchor: { type: 'ink', page: 0, rect: { x: 72, y: 160, width: 24, height: 24 } } as never,
  note: '便签：猜疑链与技术爆炸',
  created_at: '2026-10-18T13:01:00Z',
  updated_at: '2026-10-18T13:01:00Z',
};

const INK: Annotation = {
  id: 'ink-1',
  type: 'ink',
  anchor: { type: 'ink', page: 1 },
  strokes: [
    {
      color: '#FF0000',
      width: 3,
      points: [
        { x: 100, y: 300, pressure: 0.5, t: 0 },
        { x: 150, y: 340, pressure: 0.6, t: 20 },
      ],
    },
  ],
  created_at: '2026-10-18T13:02:00Z',
  updated_at: '2026-10-18T13:02:00Z',
};

describe.skipIf(!hasPdfLib)('writeAnnotationsToPdf 真实写入', () => {
  it('写入三类注释并产出合法 PDF', async () => {
    const base = join(tempDir, 'base.pdf');
    const out = join(tempDir, 'out.pdf');
    await makeBasePdf(base);

    const result = await writeAnnotationsToPdf(base, [HIGHLIGHT, NOTE, INK], {
      outputPath: out,
      author: 'dsh-extension',
    });

    expect(result.written).toBe(3);
    expect(result.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(500);
    // PDF 魔数
    expect(readFileSync(out).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('不指定输出路径时覆盖源文件', async () => {
    const base = join(tempDir, 'inplace.pdf');
    await makeBasePdf(base);
    const before = statSync(base).size;

    const result = await writeAnnotationsToPdf(base, [NOTE]);
    expect(result.path).toBe(base);
    expect(statSync(base).size).toBeGreaterThan(before);
  });

  it('页索引越界的注释被跳过，不报错', async () => {
    const base = join(tempDir, 'oob.pdf');
    const out = join(tempDir, 'oob-out.pdf');
    await makeBasePdf(base, 1);
    const bad: Annotation = { ...NOTE, id: 'oob', anchor: { type: 'ink', page: 99 } as never };
    const result = await writeAnnotationsToPdf(base, [bad, NOTE], { outputPath: out });
    expect(result.written).toBe(1); // 只有 NOTE 写成功
  });
});

describe.skipIf(!hasPdfLib)('readAnnotationsFromPdf 读回', () => {
  it('中文内容往返不亂码（UTF-16BE 编码验证）', async () => {
    const base = join(tempDir, 'cn-base.pdf');
    const out = join(tempDir, 'cn-out.pdf');
    await makeBasePdf(base);
    await writeAnnotationsToPdf(base, [HIGHLIGHT, NOTE], { outputPath: out });

    const { annotations } = await readAnnotationsFromPdf(out, { pageIndexes: [0] });
    expect(annotations).toHaveLength(2);

    const highlight = annotations.find((a) => a.type === 'highlight');
    expect(highlight?.text).toBe('跨端批注测试');

    const note = annotations.find((a) => a.type === 'note');
    expect(note?.note).toBe('便签：猜疑链与技术爆炸');
  });

  it('批注 id 通过 /NM 保留，便于两端对齐', async () => {
    const base = join(tempDir, 'id-base.pdf');
    const out = join(tempDir, 'id-out.pdf');
    await makeBasePdf(base);
    await writeAnnotationsToPdf(base, [HIGHLIGHT], { outputPath: out });

    const { annotations } = await readAnnotationsFromPdf(out, { pageIndexes: [0] });
    expect(annotations[0]?.id).toBe('hl-1');
  });

  it('页索引正确对应（第 2 页的墨迹在第 2 页）', async () => {
    const base = join(tempDir, 'page-base.pdf');
    const out = join(tempDir, 'page-out.pdf');
    await makeBasePdf(base, 3);
    await writeAnnotationsToPdf(base, [INK], { outputPath: out });

    const page0 = await readAnnotationsFromPdf(out, { pageIndexes: [0] });
    const page1 = await readAnnotationsFromPdf(out, { pageIndexes: [1] });
    expect(page0.annotations).toHaveLength(0);
    expect(page1.annotations).toHaveLength(1);
    expect((page1.annotations[0]?.anchor as { page: number }).page).toBe(1);
  });

  it('墨迹笔迹的矢量点被还原', async () => {
    const base = join(tempDir, 'ink-base.pdf');
    const out = join(tempDir, 'ink-out.pdf');
    await makeBasePdf(base, 2);
    await writeAnnotationsToPdf(base, [INK], { outputPath: out });

    const { annotations } = await readAnnotationsFromPdf(out);
    const ink = annotations.find((a) => a.type === 'ink');
    expect(ink?.strokes).toHaveLength(1);
    // 原始 2 个点（写入时每个点存 x,y）
    expect(ink?.strokes![0]!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('忽略无关注释（不把排版用的 /Link 当批注）', async () => {
    const base = join(tempDir, 'link-base.pdf');
    const out = join(tempDir, 'link-out.pdf');
    await makeBasePdf(base);

    // 手工加一个 /Link 注释
    const { PDFDocument, PDFName, PDFArray } = await import('pdf-lib');
    const { writeFileSync } = await import('node:fs');
    const doc = await PDFDocument.load(readFileSync(base));
    const page = doc.getPage(0);
    const link = doc.context.register(doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [0, 0, 50, 50],
    }));
    page.node.set(PDFName.of('Annots'), doc.context.obj([link]));
    writeFileSync(out, await doc.save({ useObjectStreams: false }));

    const { annotations } = await readAnnotationsFromPdf(out);
    expect(annotations).toHaveLength(0);
  });

  it('空 PDF（无注释）返回空数组，不报错', async () => {
    const base = join(tempDir, 'empty.pdf');
    await makeBasePdf(base, 1);
    const { annotations, skipped } = await readAnnotationsFromPdf(base);
    expect(annotations).toHaveLength(0);
    expect(skipped).toBe(0);
  });
});

describe.skipIf(!hasPdfLib)('原子写入（保护原文件）', () => {
  it('写入成功后不留下临时文件', async () => {
    const base = join(tempDir, 'atomic-base.pdf');
    const out = join(tempDir, 'atomic-out.pdf');
    await makeBasePdf(base);
    await writeAnnotationsToPdf(base, [NOTE], { outputPath: out });

    const { readdirSync } = await import('node:fs');
    const leftovers = readdirSync(tempDir).filter((name) => name.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('写出无效内容时回滚，原文件保持完好', async () => {
    const base = join(tempDir, 'rollback-base.pdf');
    await makeBasePdf(base);
    const originalBytes = readFileSync(base);

    // 构造一个会让 pdf-lib 抛错的场景：不存在的页 + 极端参数不会触发；
    // 改为验证"输出路径不可写"时的行为——写入会抛错且不动原文件
    const { chmodSync } = await import('node:fs');
    const readonlyDir = join(tempDir, 'readonly');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(readonlyDir, { recursive: true });
    chmodSync(readonlyDir, 0o500); // 只读目录

    try {
      await expect(
        writeAnnotationsToPdf(base, [NOTE], { outputPath: join(readonlyDir, 'x.pdf') }),
      ).rejects.toThrow();
      // 原文件字节未变
      expect(readFileSync(base).equals(originalBytes)).toBe(true);
    } finally {
      chmodSync(readonlyDir, 0o700);
    }
  });

  it('多次写入叠加，注释累积而不覆盖', async () => {
    const base = join(tempDir, 'cumul-base.pdf');
    const out = join(tempDir, 'cumul-out.pdf');
    await makeBasePdf(base);

    await writeAnnotationsToPdf(base, [HIGHLIGHT], { outputPath: out });
    await writeAnnotationsToPdf(out, [NOTE], { outputPath: out });

    const { annotations } = await readAnnotationsFromPdf(out, { pageIndexes: [0] });
    // 两条都在
    expect(annotations).toHaveLength(2);
    expect(annotations.some((a) => a.type === 'highlight')).toBe(true);
    expect(annotations.some((a) => a.type === 'note')).toBe(true);
  });
});
