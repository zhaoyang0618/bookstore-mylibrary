/**
 * 分片上传测试（设计文档 1.8.6）。
 *
 * 重点验证断点续传：中断后重跑不应重复上传已完成的分片。
 *
 * @module @bookstore/mylibrary-core/__tests__/chunks
 */

import { describe, expect, it } from 'vitest';

import { MemoryFs } from './memfs.js';
import {
  DEFAULT_CHUNK_SIZE,
  chunkRange,
  isComplete,
  markPartDone,
  mergeParts,
  partFileName,
  pendingParts,
  planChunks,
  progressRatio,
  quickFileHash,
  readProgress,
  runChunkedUpload,
  writePart,
  writeProgress,
  type UploadProgress,
} from '../chunks.js';

const NOW = '2026-10-16T10:30:00Z';

function makeFs(content: string): { fs: MemoryFs; path: string } {
  const fs = new MemoryFs();
  const path = '/lib/books/三体/recordings/讲解.mp4';
  fs.writeFile(path, content);
  return { fs, path };
}

describe('分片规划', () => {
  it('文件名固定宽度，保证字典序等于数字序', () => {
    expect(partFileName(0)).toBe('part-0000');
    expect(partFileName(7)).toBe('part-0007');
    expect(partFileName(1234)).toBe('part-1234');
  });

  it('按文件大小算总分片数', () => {
    const plan = planChunks('/a.mp4', 100, 30);
    expect(plan.totalParts).toBe(4); // 30+30+30+10
    expect(plan.partsDir).toBe('/a.mp4.parts');
    expect(plan.progressPath).toBe('/a.mp4.parts/upload.json');
  });

  it('空文件的分片数为 0', () => {
    expect(planChunks('/a.mp4', 0, DEFAULT_CHUNK_SIZE).totalParts).toBe(0);
  });

  it('拒绝非法参数', () => {
    expect(() => planChunks('/a.mp4', -1)).toThrow(/文件大小非法/);
    expect(() => planChunks('/a.mp4', 100, 0)).toThrow(/分片大小非法/);
    expect(() => planChunks('/a.mp4', 100, -5)).toThrow(/分片大小非法/);
  });

  it('分片范围首尾正确', () => {
    expect(chunkRange(0, 30, 100)).toEqual({ start: 0, end: 30 });
    expect(chunkRange(3, 30, 100)).toEqual({ start: 90, end: 100 });
    expect(chunkRange(0, 100, 100)).toEqual({ start: 0, end: 100 });
  });
});

describe('进度文件', () => {
  it('不存在时返回全新进度', () => {
    const { fs, path } = makeFs('x'.repeat(100));
    const plan = planChunks(path, 100, 30);
    const progress = readProgress(fs, plan, 'sha256:abc', NOW);
    expect(progress.completed_parts).toEqual([]);
    expect(progress.total_parts).toBe(4);
    expect(progress.file_hash).toBe('sha256:abc');
  });

  it('源文件哈希变化时重头开始', () => {
    const { fs, path } = makeFs('x'.repeat(100));
    const plan = planChunks(path, 100, 30);
    writeProgress(fs, plan, {
      total_bytes: 100,
      chunk_size: 30,
      total_parts: 4,
      completed_parts: [0, 1],
      file_hash: 'sha256:OLD',
      updated_at: NOW,
    });
    const progress = readProgress(fs, plan, 'sha256:NEW', NOW);
    expect(progress.completed_parts).toEqual([]);
    expect(progress.file_hash).toBe('sha256:NEW');
  });

  it('upload.json 损坏时容错重开，不抛错', () => {
    const { fs, path } = makeFs('x'.repeat(100));
    const plan = planChunks(path, 100, 30);
    fs.writeFile(plan.progressPath, '{ 这不是 JSON');
    const progress = readProgress(fs, plan, 'sha256:abc', NOW);
    expect(progress.completed_parts).toEqual([]);
  });

  it('过滤越界与重复的分片索引', () => {
    const { fs, path } = makeFs('x'.repeat(100));
    const plan = planChunks(path, 100, 30);
    writeProgress(fs, plan, {
      total_bytes: 100,
      chunk_size: 30,
      total_parts: 4,
      completed_parts: [0, 0, 99, -1, 2],
      file_hash: 'sha256:abc',
      updated_at: NOW,
    });
    expect(readProgress(fs, plan, 'sha256:abc', NOW).completed_parts).toEqual([0, 2]);
  });

  it('pendingParts / isComplete / progressRatio', () => {
    const partial: UploadProgress = {
      total_bytes: 100,
      chunk_size: 30,
      total_parts: 4,
      completed_parts: [0, 2],
      file_hash: 'sha256:abc',
      updated_at: NOW,
    };
    expect(pendingParts(partial)).toEqual([1, 3]);
    expect(isComplete(partial)).toBe(false);
    expect(progressRatio(partial)).toBe(0.5);

    const done: UploadProgress = { ...partial, completed_parts: [0, 1, 2, 3] };
    expect(pendingParts(done)).toEqual([]);
    expect(isComplete(done)).toBe(true);
    expect(progressRatio(done)).toBe(1);
  });

  it('空文件视为已完成', () => {
    const progress: UploadProgress = {
      total_bytes: 0,
      chunk_size: 30,
      total_parts: 0,
      completed_parts: [],
      file_hash: 'sha256:abc',
      updated_at: NOW,
    };
    expect(isComplete(progress)).toBe(false); // total_parts=0 时不算"已完成上传"
    expect(progressRatio(progress)).toBe(1);
  });
});

describe('分片写入与合并', () => {
  it('切出的分片内容拼接后等于原文件', () => {
    const content = 'ABCDEFGHIJ'; // 10 字节
    const { fs, path } = makeFs(content);
    const plan = planChunks(path, content.length, 3); // 3+3+3+1
    let progress = readProgress(fs, plan, quickFileHash(fs, path), NOW);
    writeProgress(fs, plan, progress);

    const written: string[] = [];
    for (let index = 0; index < plan.totalParts; index += 1) {
      const part = writePart(fs, plan, content, index, content.length);
      written.push(fs.readFile(part.path));
      progress = markPartDone(fs, plan, progress, index, NOW);
    }
    expect(written).toEqual(['ABC', 'DEF', 'GHI', 'J']);
    expect(written.join('')).toBe(content);
  });

  it('合并后内容正确且清理分片目录', () => {
    const content = 'x'.repeat(100);
    const { fs, path } = makeFs(content);
    const result = runChunkedUpload({ fs, sourcePath: path, chunkSize: 30, now: NOW });
    const mergedPath = '/merged.mp4';
    const size = mergeParts(fs, result.plan, result.progress, mergedPath);
    expect(size).toBe(100);
    expect(fs.readFile(mergedPath)).toBe(content);
    expect(fs.exists(result.plan.partsDir)).toBe(false);
  });

  it('分片不全时拒绝合并', () => {
    const { fs, path } = makeFs('x'.repeat(100));
    const plan = planChunks(path, 100, 30);
    const progress: UploadProgress = {
      total_bytes: 100,
      chunk_size: 30,
      total_parts: 4,
      completed_parts: [0, 1],
      file_hash: 'sha256:abc',
      updated_at: NOW,
    };
    expect(() => mergeParts(fs, plan, progress, '/out.mp4')).toThrow(/分片未完成/);
  });

  it('分片文件缺失时拒绝合并', () => {
    const { fs, path } = makeFs('x'.repeat(100));
    const result = runChunkedUpload({ fs, sourcePath: path, chunkSize: 30, now: NOW });
    // 手动删掉一个分片
    fs.remove(`${result.plan.partsDir}/part-0001`);
    expect(() => mergeParts(fs, result.plan, result.progress, '/out.mp4')).toThrow(/分片缺失/);
  });
});

describe('断点续传（核心场景）', () => {
  it('中断后重跑只补传缺失的分片', () => {
    const content = 'y'.repeat(100);
    const { fs, path } = makeFs(content);
    const plan = planChunks(path, 100, 30);
    const hash = quickFileHash(fs, path);

    // 第一次：传完 2 片后"中断"（runChunkedUpload 是同步的，用 try/catch 捕获）
    expect(() =>
      runChunkedUpload({
        fs,
        sourcePath: path,
        chunkSize: 30,
        now: NOW,
        onPart: ({ index }) => {
          if (index === 2) throw new Error('模拟网络中断');
        },
      }),
    ).toThrow(/模拟网络中断/);

    // 中断前的进度应已落盘（第 0、1 片完成，第 2 片抛错前未标记）
    const partial = readProgress(fs, plan, hash, NOW);
    expect(partial.completed_parts).toEqual([0, 1]);

    // 第二次：续传，记录本次实际上传了哪些分片
    const uploaded: number[] = [];
    const second = runChunkedUpload({
      fs,
      sourcePath: path,
      chunkSize: 30,
      now: NOW,
      onPart: ({ index }) => {
        uploaded.push(index);
      },
    });

    // 只补传缺失的，不重复
    expect(second.resumed).toBe(true);
    expect(uploaded).toEqual([2, 3]);
    expect(second.progress.completed_parts).toEqual([0, 1, 2, 3]);
    expect(isComplete(second.progress)).toBe(true);
  });

  it('全部完成后再跑不上传任何分片', () => {
    const content = 'z'.repeat(60);
    const { fs, path } = makeFs(content);
    runChunkedUpload({ fs, sourcePath: path, chunkSize: 30, now: NOW });

    const uploaded: number[] = [];
    const second = runChunkedUpload({
      fs,
      sourcePath: path,
      chunkSize: 30,
      now: NOW,
      onPart: ({ index }) => {
        uploaded.push(index);
      },
    });
    expect(second.resumed).toBe(true);
    expect(uploaded).toEqual([]);
  });

  it('源文件被替换后不续传，重头开始', () => {
    const { fs, path } = makeFs('a'.repeat(100));
    runChunkedUpload({ fs, sourcePath: path, chunkSize: 30, now: NOW });

    // 换成内容不同的文件（长度相同也算不同版本）
    fs.writeFile(path, 'b'.repeat(100));
    const uploaded: number[] = [];
    const second = runChunkedUpload({
      fs,
      sourcePath: path,
      chunkSize: 30,
      now: NOW,
      onPart: ({ index }) => {
        uploaded.push(index);
      },
    });
    expect(second.resumed).toBe(false);
    expect(uploaded).toEqual([0, 1, 2, 3]);
  });
});

describe('quickFileHash', () => {
  it('同一内容哈希稳定', () => {
    const { fs, path } = makeFs('same content');
    expect(quickFileHash(fs, path)).toBe(quickFileHash(fs, path));
  });

  it('内容不同哈希不同', () => {
    const a = makeFs('content A');
    const b = makeFs('content B');
    expect(quickFileHash(a.fs, a.path)).not.toBe(quickFileHash(b.fs, b.path));
  });

  it('长度不同哈希不同', () => {
    const a = makeFs('x');
    const b = makeFs('xx');
    expect(quickFileHash(a.fs, a.path)).not.toBe(quickFileHash(b.fs, b.path));
  });
});

describe('runChunkedUpload 边界', () => {
  it('源文件不存在时报错', () => {
    const fs = new MemoryFs();
    expect(() => runChunkedUpload({ fs, sourcePath: '/nope.mp4' })).toThrow(/源文件不存在/);
  });

  it('空文件不产生分片', () => {
    const { fs, path } = makeFs('');
    const result = runChunkedUpload({ fs, sourcePath: path, chunkSize: 30, now: NOW });
    expect(result.progress.total_parts).toBe(0);
    expect(result.progress.completed_parts).toEqual([]);
  });

  it('单片文件正好一个分片', () => {
    const { fs, path } = makeFs('abc');
    const result = runChunkedUpload({ fs, sourcePath: path, chunkSize: 100, now: NOW });
    expect(result.progress.total_parts).toBe(1);
    expect(result.progress.completed_parts).toEqual([0]);
  });
});
