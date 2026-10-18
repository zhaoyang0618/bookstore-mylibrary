#!/usr/bin/env node
/**
 * Schema 校验 CLI（设计文档阶段一任务 2）。
 *
 * 两套软件（dsh 扩展版、Flutter 跨平台版）共用这一个校验器。
 *
 * 用法：
 *   mylibrary validate <MyLibrary目录> [--json]
 *   mylibrary compare   <本地目录> <网盘目录> [--json]
 *   mylibrary init      <目标目录>
 *   mylibrary migrate   <MyLibrary目录>
 *   mylibrary graph     <MyLibrary目录>
 *   mylibrary chunks    <MyLibrary目录> <book_id> <视频文件名> [分片大小]  # 分片上传与续传
 *   mylibrary pdf-annotations <MyLibrary目录> <PDF相对路径> [页码...]     # 列出 PDF 批注
 *
 * @module @bookstore/mylibrary-core/cli
 */

import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { MyLibraryStore, MyLibraryError } from './store.js';
import { checkSchemaCompatibility } from './schema.js';
import { validateDocument, type ValidationReport } from './validate.js';
import { mergeLibraries, planSync } from './sync.js';
import { parseWikiPage } from './wiki.js';

type CommandName = 'validate' | 'compare' | 'init' | 'migrate' | 'graph' | 'chunks' | 'pdf-annotations';

interface CliOptions {
  json: boolean;
}

function parseArgs(argv: string[]): { command: CommandName; args: string[]; options: CliOptions } {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const options: CliOptions = { json: false };
  for (const token of rest) {
    if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.json = options.json;
    else positional.push(token);
  }
  const valid: CommandName[] = ['validate', 'compare', 'init', 'migrate', 'graph', 'chunks', 'pdf-annotations'];
  if (command === undefined || !valid.includes(command as CommandName)) {
    throw new MyLibraryError('USAGE', `用法：mylibrary <${valid.join('|')}> [参数] [--json]`);
  }
  return { command: command as CommandName, args: positional, options };
}

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
  throw error;
}

function requireExistingDir(path: string): string {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new MyLibraryError('DIR_NOT_FOUND', `目录不存在：${absolute}`);
  return absolute;
}

// ---------- validate ----------

function cmdValidate(root: string, options: CliOptions): number {
  const store = new MyLibraryStore(root, { clientId: 'cli-validator' });
  const reports: ValidationReport[] = [];
  const layout = [
    { kind: 'manifest', path: store.manifestPath() },
    { kind: 'library', path: store.libraryPath() },
    { kind: 'wiki-index', path: `${root}/wiki/index.json` },
  ];
  for (const entry of layout) {
    if (!existsSync(entry.path)) {
      reports.push({
        ok: false,
        subject: basename(entry.path),
        issues: [{ severity: 'error', path: '/', message: '文件缺失' }],
      });
      continue;
    }
    reports.push(validateDocument(entry.kind, JSON.parse(store.fs.readFile(entry.path))));
  }
  // 笔记边车
  const library = existsSync(store.libraryPath())
    ? (JSON.parse(store.fs.readFile(store.libraryPath())) as { books: { notes_path?: string }[] })
    : { books: [] };
  for (const book of library.books) {
    if (book.notes_path === undefined) continue;
    const path = resolve(root, book.notes_path);
    if (!existsSync(path)) continue;
    reports.push(validateDocument('notes', JSON.parse(store.fs.readFile(path))));
  }
  // Wiki 页面
  const wikiPagesDir = `${root}/wiki/pages`;
  if (existsSync(wikiPagesDir)) {
    for (const name of store.fs.listDir(wikiPagesDir)) {
      if (!name.endsWith('.md')) continue;
      try {
        parseWikiPage(store.fs.readFile(`${wikiPagesDir}/${name}`), name);
        reports.push({ ok: true, subject: `wiki/${name}`, issues: [] });
      } catch (error) {
        reports.push({
          ok: false,
          subject: `wiki/${name}`,
          issues: [{ severity: 'error', path: '/', message: (error as Error).message }],
        });
      }
    }
  }

  const errorCount = reports.flatMap((r) => r.issues).filter((issue) => issue.severity === 'error').length;
  const warningCount = reports.flatMap((r) => r.issues).filter((issue) => issue.severity === 'warning').length;
  const ok = errorCount === 0;
  if (options.json) {
    print(JSON.stringify({ ok, errorCount, warningCount, reports }, null, 2));
  } else {
    print(`校验目录：${root}`);
    for (const report of reports) {
      const status = report.ok ? 'PASS' : 'FAIL';
      print(`  [${status}] ${report.subject}`);
      for (const issue of report.issues) {
        print(`      ${issue.severity === 'error' ? '✗' : '⚠'} ${issue.path} ${issue.message}`);
      }
    }
    print(`结果：${ok ? '通过' : '失败'}（错误 ${errorCount}，警告 ${warningCount}）`);
  }
  return ok ? 0 : 1;
}

// ---------- compare ----------

function cmdCompare(localRoot: string, remoteRoot: string, options: CliOptions): number {
  const local = new MyLibraryStore(localRoot, { clientId: 'cli-local' });
  const remote = new MyLibraryStore(remoteRoot, { clientId: 'cli-remote' });
  const localLibrary = local.readLibrary();
  const remoteLibrary = remote.readLibrary();
  const plan = planSync(localLibrary, remoteLibrary);
  const merged = mergeLibraries(localLibrary, remoteLibrary, 'auto');
  const schema = checkSchemaCompatibility(remoteLibrary.schema_version);
  if (options.json) {
    print(JSON.stringify({ plan, schema, merge: merged }, null, 2));
  } else {
    print(`本地版本：${localLibrary.version}，网盘版本：${remoteLibrary.version}`);
    print(`同步计划：${plan.action} — ${plan.reason}`);
    print(`schema 兼容性：${schema.verdict} — ${schema.reason}`);
    print(`合并动作（${merged.actions.length}）：`);
    for (const action of merged.actions) print(`  - [${action.kind}] ${action.path}：${action.message}`);
    print(`未解决冲突：${merged.hasUnresolvedConflicts ? '有' : '无'}`);
    print(`合并后共 ${merged.value.books.length} 本书，version=${merged.value.version}`);
  }
  return 0;
}

// ---------- init ----------

function cmdInit(root: string): number {
  const store = new MyLibraryStore(root, { clientId: 'cli-init' });
  store.init();
  store.touchClient({ id: 'cli-init', type: 'cli', platform: 'macos' });
  print(`已初始化 MyLibrary 目录：${store.root}`);
  return 0;
}

// ---------- migrate ----------

function cmdMigrate(root: string): number {
  const store = new MyLibraryStore(root, { clientId: 'cli-migrate' });
  const result = store.migrate();
  print(`迁移完成：${result.migrated.length > 0 ? result.migrated.join(', ') : '无需迁移'}`);
  if (result.backedUpTo !== undefined) print(`备份目录：${result.backedUpTo}`);
  return 0;
}

// ---------- graph ----------

function cmdGraph(root: string, options: CliOptions): number {
  const store = new MyLibraryStore(root, { clientId: 'cli-graph' });
  const graph = store.buildWikiGraph();
  if (options.json) {
    print(JSON.stringify(graph, null, 2));
  } else {
    print(`Wiki 图谱：${graph.nodes.length} 个页面`);
    for (const node of graph.nodes) {
      const backlinks = graph.backlinks[node.slug] ?? [];
      print(`  ${node.slug} (${node.title}) → 出链 ${node.links.length}，反链 ${backlinks.length}`);
    }
  }
  return 0;
}


// ---------- chunks ----------

/**
 * 分片上传演示：把一本书的录课视频切片，展示断点续传。
 *
 * 第一次运行会切分全部分片；加 `--resume` 再跑一次不会重复切分。
 */
function cmdChunks(root: string, args: string[], options: CliOptions): number {
  const [bookId, fileName, chunkSizeArg] = args;
  const chunkSize = chunkSizeArg !== undefined ? Number.parseInt(chunkSizeArg, 10) : undefined;
  if (bookId === undefined || fileName === undefined) {
    throw new MyLibraryError('USAGE', '用法：mylibrary chunks <MyLibrary目录> <book_id> <视频文件名>');
  }
  const store = new MyLibraryStore(root, { clientId: 'cli-chunks' });
  const book = store.findBook(bookId);
  if (book === undefined) throw new MyLibraryError('BOOK_NOT_FOUND', `书籍不存在：${bookId}`);

  const before = store.readUploadProgress(book, fileName);
  const uploaded: number[] = [];
  const result = store.uploadRecordingChunks(
    book,
    fileName,
    (part) => {
      uploaded.push(part.index);
    },
    ...(chunkSize !== undefined && Number.isFinite(chunkSize) ? [chunkSize] : []),
  );

  if (options.json) {
    print(JSON.stringify({
      partsDir: result.plan.partsDir,
      totalParts: result.progress.total_parts,
      chunkSize: result.progress.chunk_size,
      completedBefore: before?.completed_parts ?? [],
      uploadedNow: uploaded,
      resumed: result.resumed,
      complete: result.progress.completed_parts.length === result.progress.total_parts,
    }, null, 2));
  } else {
    print(`分片目录：${result.plan.partsDir}`);
    print(`文件大小：${result.progress.total_bytes} 字节，分片大小 ${result.progress.chunk_size}，共 ${result.progress.total_parts} 片`);
    if (before !== undefined) print(`续传：上次已完成 ${before.completed_parts.length} 片`);
    print(`本次切分：${uploaded.length > 0 ? uploaded.join(', ') : '无（已全部完成）'}`);
    print(`进度：${result.progress.completed_parts.length}/${result.progress.total_parts}`);
  }
  return 0;
}


// ---------- pdf-annotations ----------

/**
 * 列出 PDF 文件里的批注（设计文档 4.2 跨端批注验证）。
 *
 * 用于确认「另一端写入的注释能被看到」。
 */
async function cmdPdfAnnotations(root: string, args: string[], options: CliOptions): Promise<number> {
  const relativePath = args[0];
  if (relativePath === undefined) {
    throw new MyLibraryError('USAGE', '用法：mylibrary pdf-annotations <MyLibrary目录> <PDF相对路径> [页码...]');
  }
  const { readAnnotationsFromPdf } = await import('./pdf-writer.js');
  const absolute = resolve(root, relativePath);
  if (!existsSync(absolute)) throw new MyLibraryError('FILE_NOT_FOUND', `PDF 不存在：${absolute}`);

  const pages = args.slice(1).map((n) => Number.parseInt(n, 10)).filter((n) => Number.isFinite(n));
  const result = await readAnnotationsFromPdf(absolute, pages.length > 0 ? { pageIndexes: pages } : {});

  if (options.json) {
    print(JSON.stringify({ path: absolute, count: result.annotations.length, skipped: result.skipped, annotations: result.annotations }, null, 2));
  } else {
    print(`PDF：${absolute}`);
    print(`批注：${result.annotations.length} 条${pages.length > 0 ? `（仅第 ${pages.join(', ')} 页）` : ''}`);
    for (const annotation of result.annotations) {
      const page = (annotation.anchor as { page?: number }).page ?? 0;
      const text = annotation.text ?? annotation.note ?? '(无文本)';
      print(`  [第${page + 1}页] ${annotation.type} · ${annotation.id} · ${text}`);
    }
    if (result.skipped > 0) print(`  跳过无法解析的注释：${result.skipped} 条`);
  }
  return 0;
}

// ---------- main ----------

function main(): void {
  try {
    const { command, args, options } = parseArgs(process.argv.slice(2));
    switch (command) {
      case 'validate': {
        process.exitCode = cmdValidate(requireExistingDir(args[0] ?? '.'), options);
        break;
      }
      case 'compare': {
        process.exitCode = cmdCompare(requireExistingDir(args[0] ?? '.'), requireExistingDir(args[1] ?? '.'), options);
        break;
      }
      case 'init': {
        process.exitCode = cmdInit(requireExistingDir(args[0] ?? '.'));
        break;
      }
      case 'migrate': {
        process.exitCode = cmdMigrate(requireExistingDir(args[0] ?? '.'));
        break;
      }
      case 'graph': {
        process.exitCode = cmdGraph(requireExistingDir(args[0] ?? '.'), options);
        break;
      }
      case 'chunks': {
        process.exitCode = cmdChunks(requireExistingDir(args[0] ?? '.'), args.slice(1), options);
        break;
      }
      case 'pdf-annotations': {
        void cmdPdfAnnotations(requireExistingDir(args[0] ?? '.'), args.slice(1), options)
          .then((code) => {
            process.exitCode = code;
          })
          .catch((error: unknown) => {
            process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
          });
        break;
      }
    }
  } catch (error) {
    if (error instanceof MyLibraryError) {
      process.stderr.write(`错误：${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    fail(error);
  }
}

main();
