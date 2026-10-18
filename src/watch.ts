/**
 * 桌面端文件监视（设计文档阶段六：`chokidar` 等价实现）。
 *
 * 用途：网盘同步客户端在后台改写 `library.json` / 笔记边车时，
 * 本客户端能感知变化并刷新界面，而不是要求用户手动点"刷新"。
 *
 * 设计取舍：
 * - 用 `node:fs.watch` 而非 chokidar：零依赖，行为足够
 * - 防抖：网盘客户端常连续写多次（临时文件 → 改名），合并成一次回调
 * - 只关心 MyLibrary 里的关键文件，忽略 `.trash/`、`.parts/` 和二进制大文件
 *
 * @module @bookstore/mylibrary-core/watch
 */

import { statSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { basename } from 'node:path';

import type { FileSystem } from './store.js';

/** 一次文件变化事件。 */
export interface LibraryChange {
  /** 变化类型。 */
  kind: 'library' | 'manifest' | 'notes' | 'wiki' | 'recording' | 'other';
  /** 变化的文件绝对路径。 */
  path: string;
  /** 事件时间（ISO 8601）。 */
  at: string;
}

/** 监视器配置。 */
export interface WatchOptions {
  /** MyLibrary 根目录。 */
  root: string;
  /** 变化回调。 */
  onChange: (change: LibraryChange) => void;
  /** 防抖窗口（毫秒），默认 300。 */
  debounceMs?: number;
  /** 是否递归监视子目录，默认 true。 */
  recursive?: boolean;
  /** 自定义错误处理。 */
  onError?: (error: Error) => void;
}

/** 监视器句柄。 */
export interface WatchHandle {
  /** 停止监视。 */
  close(): void;
  /** 是否仍在运行。 */
  readonly active: boolean;
}

/** 判断一个路径是否值得关心（过滤噪声）。 */
export function isRelevantPath(path: string): boolean {
  const name = basename(path);
  // 临时文件与备份
  if (name.startsWith('.') && name !== '.trash') return false;
  if (name.endsWith('~') || name.endsWith('.swp') || name.endsWith('.tmp')) return false;
  // 分片上传临时目录
  if (path.includes('.parts/') || path.includes('.parts\\')) return false;
  // 删除暂存区
  if (path.includes('/.trash/') || path.includes('\\.trash\\')) return false;
  // 二进制大文件不触发界面刷新（它们由同步状态字段表达）
  if (/\.(mp4|webm|mkv|mov|avi)$/i.test(name)) return false;
  return true;
}

/** 按文件名与路径归类变化类型。 */
export function classifyChange(path: string): LibraryChange['kind'] {
  const name = basename(path);
  if (name === 'library.json') return 'library';
  if (name === 'manifest.json') return 'manifest';
  if (name.endsWith('.notes.json')) return 'notes';
  if (path.includes('/wiki/') || path.includes('\\wiki\\')) return 'wiki';
  if (path.includes('/recordings/') || path.includes('\\recordings\\')) return 'recording';
  return 'other';
}

/**
 * 启动一个 MyLibrary 目录监视器。
 *
 * @returns 句柄，调用 `close()` 停止
 */
export function watchLibrary(options: WatchOptions): WatchHandle {
  const { root, onChange, debounceMs = 300, onError } = options;
  let active = true;
  let watcher: FSWatcher | undefined;
  const pending = new Map<string, LibraryChange>();
  let timer: NodeJS.Timeout | undefined;

  /** 合并防抖窗口内的多次变化，统一回调。 */
  const flush = (): void => {
    timer = undefined;
    if (pending.size === 0) return;
    const changes = [...pending.values()];
    pending.clear();
    for (const change of changes) {
      // 任一回调抛错都不应打断监视循环
      try {
        onChange(change);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  try {
    watcher = fsWatch(root, { recursive: options.recursive ?? true }, (eventType, filename) => {
      if (!active) return;
      if (filename === null) return;
      const path = String(filename);
      if (!isRelevantPath(path)) return;
      // 递归监视时目录本身也会触发事件；只看真实文件
      const absolute = path.startsWith('/') ? path : `${root.replace(/\/+$/, '')}/${path}`;
      try {
        if (!statSync(absolute).isFile()) return;
      } catch {
        // 文件已被删除（网盘客户端改名/临时文件），交给后续归类逻辑忽略
        return;
      }

      pending.set(absolute, {
        kind: classifyChange(absolute),
        path: absolute,
        at: new Date().toISOString(),
      });

      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
      // 让 Node 进程可以正常退出，不被监视器挂住
      timer.unref?.();
    });

    watcher.on('error', (error) => {
      onError?.(error);
    });
  } catch (error) {
    active = false;
    onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  return {
    close(): void {
      active = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending.clear();
      watcher?.close();
      watcher = undefined;
    },
    get active(): boolean {
      return active;
    },
  };
}

/**
 * 轮询式监视（备选实现）。
 *
 * `fs.watch` 在网盘客户端写入时可能漏事件（尤其是跨设备挂载）。
 * 这里提供基于 mtime 的轮询版本，作为可靠性兜底。
 *
 * @returns 句柄
 */
export function pollLibrary(options: {
  fs: FileSystem;
  root: string;
  onChange: (change: LibraryChange) => void;
  intervalMs?: number;
  /** 需要轮询的文件（相对 root）。 */
  files?: string[];
}): WatchHandle {
  const { fs, root, onChange } = options;
  const intervalMs = options.intervalMs ?? 3000;
  const files = options.files ?? ['library.json', 'manifest.json'];
  const lastMtime = new Map<string, number>();
  let active = true;
  /** 已完成基线采集的轮次数；至少满 1 轮后才允许触发回调。 */
  let elapsedTicks = 0;

  const tick = (): void => {
    if (!active) return;
    for (const relative of files) {
      const absolute = `${root.replace(/\/+$/, '')}/${relative}`;
      const info = fs.stat(absolute);
      if (info === undefined) continue;
      const previous = lastMtime.get(absolute);
      lastMtime.set(absolute, info.mtimeMs);
      // 第一轮只建立基线：有些文件系统（含内存实现）的 mtime 精度不稳定，
      // 若首轮就比对会把"刚启动"误判为"刚变化"。
      if (elapsedTicks >= 2 && previous !== undefined && info.mtimeMs !== previous) {
        onChange({ kind: classifyChange(absolute), path: absolute, at: new Date().toISOString() });
      }
    }
    elapsedTicks += 1;
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return {
    close(): void {
      active = false;
      clearInterval(timer);
      lastMtime.clear();
    },
    get active(): boolean {
      return active;
    },
  };
}
