/**
 * 录课转录测试（设计文档阶段七）。
 *
 * @module @bookstore/mylibrary-core/__tests__/transcribe
 */

import { describe, expect, it } from 'vitest';

import { MemoryFs } from './memfs.js';
import { MyLibraryStore, bookFromFile } from '../store.js';
import type { Recording } from '../types.js';
import {
  MockTranscriber,
  formatTimestamp,
  formatTranscript,
  parseTranscript,
  transcribeBookRecordings,
  transcribeRecording,
  type TranscriptSegment,
  type Transcriber,
} from '../transcribe.js';

const NOW = '2026-10-16T10:30:00Z';

/** 可编排的假转录器。 */
class ScriptedTranscriber implements Transcriber {
  readonly name = 'scripted';
  calls: string[] = [];

  constructor(private readonly segments: TranscriptSegment[], private readonly failOn?: string) {}

  async transcribe(filePath: string, opts?: { signal?: AbortSignal }): Promise<TranscriptSegment[]> {
    this.calls.push(filePath);
    opts?.signal?.throwIfAborted();
    if (this.failOn !== undefined && filePath.includes(this.failOn)) {
      throw new Error(`转录失败：${filePath}`);
    }
    return this.segments;
  }
}

function makeRecording(over: Partial<Recording> = {}): Recording {
  return {
    id: 'rec-1',
    book_id: 'uuid-1',
    title: '黑暗森林法则讲解',
    file: '2026-10-16-解析.mp4',
    duration_seconds: 1250,
    size_bytes: 158000000,
    created_at: NOW,
    created_by: 'flutter-ipad-uuid',
    linked_wiki_pages: [],
    ...over,
  };
}

describe('时间戳格式化', () => {
  it('分钟以内补零', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(59)).toBe('00:59');
    expect(formatTimestamp(65)).toBe('01:05');
  });

  it('超过一小时带小时位', () => {
    expect(formatTimestamp(3600)).toBe('1:00:00');
    expect(formatTimestamp(3725)).toBe('1:02:05');
  });

  it('负数与小数被规整', () => {
    expect(formatTimestamp(-5)).toBe('00:00');
    expect(formatTimestamp(65.9)).toBe('01:05');
  });
});

describe('formatTranscript / parseTranscript', () => {
  it('拼接带时间戳的文本', () => {
    const segments: TranscriptSegment[] = [
      { startSeconds: 0, endSeconds: 10, text: '开头' },
      { startSeconds: 75, endSeconds: 90, text: '中间' },
    ];
    expect(formatTranscript(segments)).toBe('[00:00] 开头\n[01:15] 中间');
  });

  it('过滤空文本', () => {
    expect(formatTranscript([{ startSeconds: 0, endSeconds: 1, text: '   ' }])).toBe('');
  });

  it('解析回分段', () => {
    const segments = parseTranscript('[00:00] 开头\n[01:15] 中间');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startSeconds: 0, text: '开头' });
    expect(segments[1]).toMatchObject({ startSeconds: 75, text: '中间' });
  });

  it('往返一致', () => {
    const original: TranscriptSegment[] = [
      { startSeconds: 0, endSeconds: 5, text: 'A' },
      { startSeconds: 3661, endSeconds: 3670, text: 'B' },
    ];
    const round = parseTranscript(formatTranscript(original));
    expect(round.map((s) => s.text)).toEqual(['A', 'B']);
    expect(round.map((s) => s.startSeconds)).toEqual([0, 3661]);
  });

  it('忽略不含时间戳的行', () => {
    expect(parseTranscript('随便一行\n[00:10] 有效')).toHaveLength(1);
  });
});

describe('transcribeRecording', () => {
  function setup(): { fs: MemoryFs; mediaPath: string; written: Recording[] } {
    const fs = new MemoryFs();
    const mediaPath = '/lib/books/三体/recordings/2026-10-16-解析.mp4';
    fs.writeFile(mediaPath, 'fake video bytes');
    return { fs, mediaPath, written: [] };
  }

  it('转录结果写回 transcript 字段', async () => {
    const { fs, mediaPath, written } = setup();
    const result = await transcribeRecording({
      fs,
      recording: makeRecording(),
      mediaPath,
      transcriber: new ScriptedTranscriber([{ startSeconds: 0, endSeconds: 10, text: '讲解开始' }]),
      writeRecording: (recording) => written.push(recording),
    });

    expect(written).toHaveLength(1);
    expect(result.text).toBe('[00:00] 讲解开始');
    expect(written[0]?.transcript).toBe('[00:00] 讲解开始');
    expect(result.resumed).toBe(false);
  });

  it('视频不存在时报错', async () => {
    const { fs } = setup();
    await expect(
      transcribeRecording({
        fs,
        recording: makeRecording(),
        mediaPath: '/lib/nonexistent.mp4',
        transcriber: new ScriptedTranscriber([]),
        writeRecording: () => {},
      }),
    ).rejects.toThrow(/录课视频不存在/);
  });

  it('已有转录时增量续写，不重复已覆盖时段', async () => {
    const { fs, mediaPath, written } = setup();
    const existing = makeRecording({ transcript: '[00:00] 已有的开头\n[01:00] 已有的中间' });
    const result = await transcribeRecording({
      fs,
      recording: existing,
      mediaPath,
      // 转录器仍返回从 0 开始的全量结果
      transcriber: new ScriptedTranscriber([
        { startSeconds: 0, endSeconds: 10, text: '已有的开头' },
        { startSeconds: 60, endSeconds: 70, text: '已有的中间' },
        { startSeconds: 120, endSeconds: 130, text: '新增内容' },
      ]),
      writeRecording: (recording) => written.push(recording),
    });

    expect(result.resumed).toBe(true);
    expect(result.text).toContain('新增内容');
    // 已覆盖的 0 和 60 秒不重复追加
    expect(result.text.split('已有的中间').length - 1).toBe(1);
  });

  it('maxSeconds 截断超长部分', async () => {
    const { fs, mediaPath } = setup();
    const result = await transcribeRecording({
      fs,
      recording: makeRecording(),
      mediaPath,
      transcriber: new ScriptedTranscriber([
        { startSeconds: 0, endSeconds: 10, text: '在前' },
        { startSeconds: 5000, endSeconds: 5010, text: '超长' },
      ]),
      writeRecording: () => {},
      transcribeOptions: { maxSeconds: 1000 },
    });
    expect(result.text).toContain('在前');
    expect(result.text).not.toContain('超长');
  });

  it('取消信号中止转录', async () => {
    const { fs, mediaPath } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribeRecording({
        fs,
        recording: makeRecording(),
        mediaPath,
        transcriber: new ScriptedTranscriber([{ startSeconds: 0, endSeconds: 1, text: 'x' }]),
        writeRecording: () => {},
        transcribeOptions: { signal: controller.signal },
      }),
    ).rejects.toThrow();
  });

  it('结果按时间排序', async () => {
    const { fs, mediaPath } = setup();
    const result = await transcribeRecording({
      fs,
      recording: makeRecording(),
      mediaPath,
      transcriber: new ScriptedTranscriber([
        { startSeconds: 30, endSeconds: 40, text: '后' },
        { startSeconds: 10, endSeconds: 20, text: '前' },
      ]),
      writeRecording: () => {},
    });
    expect(result.text.indexOf('前')).toBeLessThan(result.text.indexOf('后'));
  });
});

describe('transcribeBookRecordings 批量', () => {
  it('单个失败不影响其它', async () => {
    const fs = new MemoryFs();
    fs.writeFile('/lib/a.mp4', 'a');
    fs.writeFile('/lib/b.mp4', 'b');
    const recordings = [
      makeRecording({ id: 'r1', file: 'a.mp4' }),
      makeRecording({ id: 'r2', file: 'b.mp4' }),
    ];
    const result = await transcribeBookRecordings({
      fs,
      book: bookFromFile({ id: 'uuid-1', title: '三体', author: '刘慈欣', relativePath: 'books/三体/三体.epub', sizeBytes: 1 }),
      recordings,
      resolveMediaPath: (recording) => `/lib/${recording.file}`,
      transcriber: new ScriptedTranscriber([{ startSeconds: 0, endSeconds: 1, text: 'ok' }], 'b.mp4'),
      writeRecording: () => {},
    });

    expect(result.results).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.recording.id).toBe('r2');
  });

  it('onRecordingDone 逐个回调（含失败）', async () => {
    const fs = new MemoryFs();
    fs.writeFile('/lib/a.mp4', 'a');
    fs.writeFile('/lib/b.mp4', 'b');
    const seen: string[] = [];
    await transcribeBookRecordings({
      fs,
      book: bookFromFile({ id: 'uuid-1', title: '三体', author: '刘慈欣', relativePath: 'books/三体/三体.epub', sizeBytes: 1 }),
      recordings: [makeRecording({ id: 'r1', file: 'a.mp4' }), makeRecording({ id: 'r2', file: 'b.mp4' })],
      resolveMediaPath: (recording) => `/lib/${recording.file}`,
      transcriber: new ScriptedTranscriber([], 'b.mp4'),
      writeRecording: () => {},
      onRecordingDone: (recording, outcome) => {
        seen.push(`${recording.id}:${outcome instanceof Error ? 'fail' : 'ok'}`);
      },
    });
    expect(seen).toEqual(['r1:ok', 'r2:fail']);
  });
});

describe('MockTranscriber', () => {
  it('产出可用的占位转录', async () => {
    const segments = await new MockTranscriber().transcribe('/a/讲解.mp4');
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]?.text).toContain('讲解.mp4');
    expect(segments[0]?.confidence).toBeGreaterThan(0);
  });

  it('响应取消信号', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new MockTranscriber().transcribe('/a.mp4', { signal: controller.signal })).rejects.toThrow();
  });
});

describe('MyLibraryStore.transcribeRecordings 集成', () => {
  it('转录落盘的录课视频并写回元数据', async () => {
    const fs = new MemoryFs();
    const store = new MyLibraryStore('/Library', { fs, clientId: 'test' });
    store.init();
    const book = store.addBook(
      bookFromFile({ id: 'uuid-1', title: '三体', author: '刘慈欣', relativePath: 'books/三体/三体.epub', sizeBytes: 1, now: NOW }),
    );
    // 落一个视频文件和元数据（writeRecording 只看 recording.file 的扩展名换 .json）
    store.fs.writeFile(`${store.recordingPath('讲解.mp4', book)}`, 'video');
    store.writeRecording(makeRecording({ file: '讲解.mp4' }));

    const result = await store.transcribeRecordings(book, new ScriptedTranscriber([
      { startSeconds: 0, endSeconds: 10, text: '第一段' },
      { startSeconds: 20, endSeconds: 30, text: '第二段' },
    ]));

    expect(result.errors).toHaveLength(0);
    expect(result.results).toHaveLength(1);
    // 元数据里应已写入 transcript
    const saved = store.listRecordings(book);
    expect(saved[0]?.transcript).toContain('第一段');
    expect(saved[0]?.transcript).toContain('第二段');
  });
});
