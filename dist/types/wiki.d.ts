/**
 * Wiki 页面（设计文档 1.6）：纯 Markdown + YAML frontmatter，与 Obsidian、Logseq 兼容。
 *
 * @module @bookstore/mylibrary-core/wiki
 */
import type { WikiFrontmatter, WikiIndex, WikiPage } from './types.js';
/** 把任意标题转成 slug（用于文件名与 `[[链接]]` 目标）。 */
export declare function slugify(title: string): string;
/** 序列化 frontmatter 为 YAML 文本（稳定字段顺序）。 */
export declare function stringifyFrontmatter(frontmatter: WikiFrontmatter): string;
/** 解析一段 YAML 子集（本数据层只用到标量与字符串数组）。 */
export declare function parseFrontmatter(yaml: string): Record<string, unknown>;
/** 从 Markdown 正文中提取全部 `[[双向链接]]` 目标 slug。 */
export declare function extractWikiLinks(body: string): string[];
/** 解析一个 Wiki 页面文件内容。 */
export declare function parseWikiPage(content: string, relativePath: string): WikiPage;
/** 序列化一个 Wiki 页面为文件内容。 */
export declare function stringifyWikiPage(page: WikiPage): string;
/** 由页面集合重建 `wiki/index.json`（设计文档 1.6：索引可从 pages/ 重建）。 */
export declare function rebuildWikiIndex(pages: WikiPage[], now: string, schemaVersion?: string): WikiIndex;
/** Wiki 图谱中的一个节点。 */
export interface WikiGraphNode {
    slug: string;
    title: string;
    links: string[];
    source_books: string[];
}
/** 由页面集合构建图谱（节点 + 出链 + 反链）。 */
export interface WikiGraph {
    nodes: WikiGraphNode[];
    /** slug → 指向它的页面 slug 列表（反链）。 */
    backlinks: Record<string, string[]>;
}
/** 构建 Wiki 双向链接图谱。 */
export declare function buildWikiGraph(pages: WikiPage[]): WikiGraph;
/** 新建一个 Wiki 页面。 */
export declare function createWikiPage(options: {
    id: string;
    title: string;
    body?: string;
    tags?: string[];
    sourceBooks?: string[];
    now: string;
    relativePath?: string;
}): WikiPage;
