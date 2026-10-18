/**
 * Wiki 页面（设计文档 1.6）：纯 Markdown + YAML frontmatter，与 Obsidian、Logseq 兼容。
 *
 * @module @bookstore/mylibrary-core/wiki
 */

import type { WikiFrontmatter, WikiIndex, WikiIndexEntry, WikiPage } from './types.js';

/** frontmatter 定界符。 */
const FRONTMATTER_FENCE = /^---\s*\n/;

/** 一行 `key: value` 或 `- item` 列表项。 */
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

/** `[[双向链接]]` 语法。 */
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** 把任意标题转成 slug（用于文件名与 `[[链接]]` 目标）。 */
export function slugify(title: string): string {
  const ascii = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.length > 0 ? ascii : `page-${Math.random().toString(36).slice(2, 8)}`;
}

/** 序列化 frontmatter 为 YAML 文本（稳定字段顺序）。 */
export function stringifyFrontmatter(frontmatter: WikiFrontmatter): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${frontmatter.id}`);
  lines.push(`slug: ${frontmatter.slug}`);
  lines.push(`title: ${frontmatter.title}`);
  lines.push(`created_at: ${frontmatter.created_at}`);
  lines.push(`updated_at: ${frontmatter.updated_at}`);
  lines.push(`tags: [${frontmatter.tags.join(', ')}]`);
  lines.push(`source_books: [${frontmatter.source_books.join(', ')}]`);
  lines.push(`links: [${frontmatter.links.join(', ')}]`);
  lines.push('---');
  return lines.join('\n');
}

/** 解析一段 YAML 子集（本数据层只用到标量与字符串数组）。 */
export function parseFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;
  const flush = (): void => {
    if (currentKey !== null && currentList !== null) {
      result[currentKey] = currentList;
    }
    currentKey = null;
    currentList = null;
  };
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const listMatch = /^-\s+(.*)$/.exec(line);
    if (listMatch && currentKey !== null) {
      if (currentList === null) currentList = [];
      currentList.push(stripQuotes(listMatch[1] ?? ''));
      continue;
    }
    const keyMatch = KEY_LINE.exec(line);
    if (!keyMatch) continue;
    flush();
    const key = keyMatch[1] as string;
    const rawValue = (keyMatch[2] ?? '').trim();
    if (rawValue.length === 0) {
      // 可能是后续的列表块
      currentKey = key;
      currentList = [];
      continue;
    }
    currentKey = null;
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      result[key] = inner.length === 0 ? [] : inner.split(',').map((item) => stripQuotes(item.trim()));
    } else {
      result[key] = stripQuotes(rawValue);
    }
  }
  flush();
  return result;
}

function stripQuotes(value: string): string {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

/** 从 Markdown 正文中提取全部 `[[双向链接]]` 目标 slug。 */
export function extractWikiLinks(body: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(WIKI_LINK)) {
    const target = (match[1] ?? '').trim();
    if (target.length === 0) continue;
    const slug = slugify(target);
    if (seen.has(slug)) continue;
    seen.add(slug);
    links.push(slug);
  }
  return links;
}

/** 解析一个 Wiki 页面文件内容。 */
export function parseWikiPage(content: string, relativePath: string): WikiPage {
  if (!FRONTMATTER_FENCE.test(content)) {
    throw new Error(`Wiki 页面 ${relativePath} 缺少 frontmatter`);
  }
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex < 0) throw new Error(`Wiki 页面 ${relativePath} 的 frontmatter 未闭合`);
  const yaml = content.slice(content.indexOf('\n') + 1, endIndex);
  const body = content.slice(endIndex + 4).replace(/^\n/, '');
  const raw = parseFrontmatter(yaml);
  const frontmatter: WikiFrontmatter = {
    id: String(raw['id'] ?? ''),
    slug: String(raw['slug'] ?? slugify(String(raw['title'] ?? relativePath))),
    title: String(raw['title'] ?? relativePath.replace(/\.md$/, '')),
    created_at: String(raw['created_at'] ?? ''),
    updated_at: String(raw['updated_at'] ?? ''),
    tags: asStringArray(raw['tags']),
    source_books: asStringArray(raw['source_books']),
    links: asStringArray(raw['links']),
  };
  const wikiLinks = extractWikiLinks(body);
  // `links` 字段与正文 `[[]]` 取并集（设计文档 1.6）
  const links = [...new Set([...frontmatter.links, ...wikiLinks])];
  return { frontmatter: { ...frontmatter, links }, body, wikiLinks, relativePath };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

/** 序列化一个 Wiki 页面为文件内容。 */
export function stringifyWikiPage(page: WikiPage): string {
  // body 可能以换行开头（frontmatter 之后），先归一化，保证往返解析等价
  const body = page.body.replace(/^\n+/, '').trimEnd();
  return `${stringifyFrontmatter(page.frontmatter)}\n\n${body}\n`;
}

/** 由页面集合重建 `wiki/index.json`（设计文档 1.6：索引可从 pages/ 重建）。 */
export function rebuildWikiIndex(pages: WikiPage[], now: string, schemaVersion = '1.0'): WikiIndex {
  const entries: WikiIndexEntry[] = pages.map((page) => ({
    id: page.frontmatter.id,
    slug: page.frontmatter.slug,
    title: page.frontmatter.title,
    path: page.relativePath,
    updated_at: page.frontmatter.updated_at,
    tags: [...page.frontmatter.tags],
    source_books: [...page.frontmatter.source_books],
    links: [...page.frontmatter.links],
  }));
  entries.sort((a, b) => a.title.localeCompare(b.title));
  return { schema_version: schemaVersion, updated_at: now, pages: entries };
}

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
export function buildWikiGraph(pages: WikiPage[]): WikiGraph {
  const nodes: WikiGraphNode[] = pages.map((page) => ({
    slug: page.frontmatter.slug,
    title: page.frontmatter.title,
    links: [...page.frontmatter.links],
    source_books: [...page.frontmatter.source_books],
  }));
  const knownSlugs = new Set(nodes.map((node) => node.slug));
  const backlinks: Record<string, string[]> = {};
  for (const node of nodes) {
    for (const target of node.links) {
      if (!knownSlugs.has(target)) continue;
      const list = backlinks[target] ?? [];
      if (!list.includes(node.slug)) list.push(node.slug);
      backlinks[target] = list;
    }
  }
  return { nodes, backlinks };
}

/** 新建一个 Wiki 页面。 */
export function createWikiPage(options: {
  id: string;
  title: string;
  body?: string;
  tags?: string[];
  sourceBooks?: string[];
  now: string;
  relativePath?: string;
}): WikiPage {
  const slug = slugify(options.title);
  return {
    frontmatter: {
      id: options.id,
      slug,
      title: options.title,
      created_at: options.now,
      updated_at: options.now,
      tags: options.tags ?? [],
      source_books: options.sourceBooks ?? [],
      links: [],
    },
    body: options.body ?? `# ${options.title}\n`,
    wikiLinks: [],
    relativePath: options.relativePath ?? `${slug}.md`,
  };
}
