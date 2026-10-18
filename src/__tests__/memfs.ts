/**
 * 内存文件系统，供单元测试使用（不落盘）。
 *
 * @module @bookstore/mylibrary-core/__tests__/memfs
 */

import type { FileSystem } from '../store.js';

/** 一个简单的内存文件系统实现。 */
export class MemoryFs implements FileSystem {
  readonly files = new Map<string, string>();

  /** 每个文件最后一次写入的时间戳（真实文件系统语义：mtime 只在写入时变）。 */
  readonly mtimes = new Map<string, number>();

  /** 手动推进某文件的 mtime，供轮询测试使用。 */
  touch(path: string, mtimeMs = Date.now()): void {
    this.mtimes.set(this.normalize(path), mtimeMs);
  }

  private normalize(path: string): string {
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  exists(path: string): boolean {
    const key = this.normalize(path);
    if (this.files.has(key)) return true;
    // 目录：任何以 key + '/' 开头的文件都意味着该目录存在
    for (const file of this.files.keys()) {
      if (file.startsWith(`${key}/`)) return true;
    }
    return key === '/';
  }

  readFile(path: string): string {
    const key = this.normalize(path);
    const content = this.files.get(key);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  writeFile(path: string, content: string): void {
    const key = this.normalize(path);
    this.files.set(key, content);
    this.mtimes.set(key, Date.now());
  }

  mkdir(path: string): void {
    // 目录在内存实现中是隐式的（由文件路径推导），这里只占位
    const key = this.normalize(path);
    if (!this.files.has(`${key}/`)) this.files.set(`${key}/`, '');
  }

  listDir(path: string): string[] {
    const key = this.normalize(path);
    const prefix = key === '/' ? '/' : `${key}/`;
    const names = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      if (rest.length === 0) continue;
      names.add(rest.split('/')[0] as string);
    }
    return [...names].sort();
  }

  stat(path: string): { size: number; mtimeMs: number; isFile: boolean; isDirectory: boolean } | undefined {
    const key = this.normalize(path);
    const content = this.files.get(key);
    if (content !== undefined) {
      return {
        size: Buffer.byteLength(content, 'utf8'),
        mtimeMs: this.mtimes.get(key) ?? 0,
        isFile: true,
        isDirectory: false,
      };
    }
    if (this.exists(key)) {
      return { size: 0, mtimeMs: 0, isFile: false, isDirectory: true };
    }
    return undefined;
  }

  remove(path: string): void {
    const key = this.normalize(path);
    for (const file of [...this.files.keys()]) {
      if (file === key || file.startsWith(`${key}/`)) this.files.delete(file);
    }
  }

  rename(from: string, to: string): void {
    const fromKey = this.normalize(from);
    const toKey = this.normalize(to);
    const moved: [string, string][] = [];
    for (const file of [...this.files.keys()]) {
      if (file === fromKey || file.startsWith(`${fromKey}/`)) {
        moved.push([file, `${toKey}${file.slice(fromKey.length)}`]);
      }
    }
    for (const [oldPath, newPath] of moved) {
      const content = this.files.get(oldPath) as string;
      this.files.delete(oldPath);
      this.files.set(newPath, content);
    }
  }

  /** 测试辅助：转储为普通对象。 */
  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.files.entries()].filter(([key]) => !key.endsWith('/')));
  }
}
