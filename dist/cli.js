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
 *
 * @module @bookstore/mylibrary-core/cli
 */
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { MyLibraryStore, MyLibraryError } from './store.js';
import { checkSchemaCompatibility } from './schema.js';
import { validateDocument } from './validate.js';
import { mergeLibraries, planSync } from './sync.js';
import { parseWikiPage } from './wiki.js';
function parseArgs(argv) {
    const [command, ...rest] = argv;
    const positional = [];
    const options = { json: false };
    for (const token of rest) {
        if (token === '--json')
            options.json = true;
        else if (token === '--help' || token === '-h')
            options.json = options.json;
        else
            positional.push(token);
    }
    const valid = ['validate', 'compare', 'init', 'migrate', 'graph'];
    if (command === undefined || !valid.includes(command)) {
        throw new MyLibraryError('USAGE', `用法：mylibrary <${valid.join('|')}> [参数] [--json]`);
    }
    return { command: command, args: positional, options };
}
function print(text) {
    process.stdout.write(`${text}\n`);
}
function fail(error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    throw error;
}
function requireExistingDir(path) {
    const absolute = resolve(path);
    if (!existsSync(absolute))
        throw new MyLibraryError('DIR_NOT_FOUND', `目录不存在：${absolute}`);
    return absolute;
}
// ---------- validate ----------
function cmdValidate(root, options) {
    const store = new MyLibraryStore(root, { clientId: 'cli-validator' });
    const reports = [];
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
        ? JSON.parse(store.fs.readFile(store.libraryPath()))
        : { books: [] };
    for (const book of library.books) {
        if (book.notes_path === undefined)
            continue;
        const path = resolve(root, book.notes_path);
        if (!existsSync(path))
            continue;
        reports.push(validateDocument('notes', JSON.parse(store.fs.readFile(path))));
    }
    // Wiki 页面
    const wikiPagesDir = `${root}/wiki/pages`;
    if (existsSync(wikiPagesDir)) {
        for (const name of store.fs.listDir(wikiPagesDir)) {
            if (!name.endsWith('.md'))
                continue;
            try {
                parseWikiPage(store.fs.readFile(`${wikiPagesDir}/${name}`), name);
                reports.push({ ok: true, subject: `wiki/${name}`, issues: [] });
            }
            catch (error) {
                reports.push({
                    ok: false,
                    subject: `wiki/${name}`,
                    issues: [{ severity: 'error', path: '/', message: error.message }],
                });
            }
        }
    }
    const errorCount = reports.flatMap((r) => r.issues).filter((issue) => issue.severity === 'error').length;
    const warningCount = reports.flatMap((r) => r.issues).filter((issue) => issue.severity === 'warning').length;
    const ok = errorCount === 0;
    if (options.json) {
        print(JSON.stringify({ ok, errorCount, warningCount, reports }, null, 2));
    }
    else {
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
function cmdCompare(localRoot, remoteRoot, options) {
    const local = new MyLibraryStore(localRoot, { clientId: 'cli-local' });
    const remote = new MyLibraryStore(remoteRoot, { clientId: 'cli-remote' });
    const localLibrary = local.readLibrary();
    const remoteLibrary = remote.readLibrary();
    const plan = planSync(localLibrary, remoteLibrary);
    const merged = mergeLibraries(localLibrary, remoteLibrary, 'auto');
    const schema = checkSchemaCompatibility(remoteLibrary.schema_version);
    if (options.json) {
        print(JSON.stringify({ plan, schema, merge: merged }, null, 2));
    }
    else {
        print(`本地版本：${localLibrary.version}，网盘版本：${remoteLibrary.version}`);
        print(`同步计划：${plan.action} — ${plan.reason}`);
        print(`schema 兼容性：${schema.verdict} — ${schema.reason}`);
        print(`合并动作（${merged.actions.length}）：`);
        for (const action of merged.actions)
            print(`  - [${action.kind}] ${action.path}：${action.message}`);
        print(`未解决冲突：${merged.hasUnresolvedConflicts ? '有' : '无'}`);
        print(`合并后共 ${merged.value.books.length} 本书，version=${merged.value.version}`);
    }
    return 0;
}
// ---------- init ----------
function cmdInit(root) {
    const store = new MyLibraryStore(root, { clientId: 'cli-init' });
    store.init();
    store.touchClient({ id: 'cli-init', type: 'cli', platform: 'macos' });
    print(`已初始化 MyLibrary 目录：${store.root}`);
    return 0;
}
// ---------- migrate ----------
function cmdMigrate(root) {
    const store = new MyLibraryStore(root, { clientId: 'cli-migrate' });
    const result = store.migrate();
    print(`迁移完成：${result.migrated.length > 0 ? result.migrated.join(', ') : '无需迁移'}`);
    if (result.backedUpTo !== undefined)
        print(`备份目录：${result.backedUpTo}`);
    return 0;
}
// ---------- graph ----------
function cmdGraph(root, options) {
    const store = new MyLibraryStore(root, { clientId: 'cli-graph' });
    const graph = store.buildWikiGraph();
    if (options.json) {
        print(JSON.stringify(graph, null, 2));
    }
    else {
        print(`Wiki 图谱：${graph.nodes.length} 个页面`);
        for (const node of graph.nodes) {
            const backlinks = graph.backlinks[node.slug] ?? [];
            print(`  ${node.slug} (${node.title}) → 出链 ${node.links.length}，反链 ${backlinks.length}`);
        }
    }
    return 0;
}
// ---------- main ----------
function main() {
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
        }
    }
    catch (error) {
        if (error instanceof MyLibraryError) {
            process.stderr.write(`错误：${error.message}\n`);
            process.exitCode = 1;
            return;
        }
        fail(error);
    }
}
main();
