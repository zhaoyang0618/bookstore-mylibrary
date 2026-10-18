/**
 * Wiki 页面测试（设计文档 1.6）。
 *
 * @module @bookstore/mylibrary-core/__tests__/wiki
 */

import { describe, expect, it } from 'vitest';

import {
  buildWikiGraph,
  createWikiPage,
  extractWikiLinks,
  parseFrontmatter,
  parseWikiPage,
  rebuildWikiIndex,
  slugify,
  stringifyFrontmatter,
  stringifyWikiPage,
} from '../wiki.js';

const PAGE = `---
id: uuid-wiki-1
slug: san-ti-ren-wu-guan-xi
title: 三体人物关系
created_at: 2026-10-10T00:00:00Z
updated_at: 2026-10-16T00:00:00Z
tags: [三体, 人物]
source_books: [uuid-1]
links:
  - dark-forest
  - ye-wenjie
---

# 三体人物关系

[[叶文洁]] 是 [[三体]] 中的核心人物...

## 相关概念

- [[黑暗森林法则]]
- [[面壁计划]]
- [[叶文洁]]
`;

describe('slugify', () => {
  it('英文标题转 kebab-case', () => {
    expect(slugify('Dark Forest')).toBe('dark-forest');
  });

  it('中文标题保留汉字', () => {
    expect(slugify('三体人物关系')).toBe('三体人物关系');
  });

  it('去掉首尾分隔符', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
  });
});

describe('parseFrontmatter', () => {
  it('解析标量与行内数组', () => {
    const parsed = parseFrontmatter('id: x\ntags: [a, b]\nempty: []');
    expect(parsed).toMatchObject({ id: 'x', tags: ['a', 'b'], empty: [] });
  });

  it('解析块状列表', () => {
    expect(parseFrontmatter('links:\n  - one\n  - two')).toMatchObject({ links: ['one', 'two'] });
  });

  it('忽略注释与空行', () => {
    expect(parseFrontmatter('# comment\n\nid: y')).toMatchObject({ id: 'y' });
  });

  it('去掉引号', () => {
    expect(parseFrontmatter(`title: "三体"`)).toMatchObject({ title: '三体' });
  });
});

describe('extractWikiLinks', () => {
  it('提取 [[双向链接]] 并去重', () => {
    expect(extractWikiLinks('[[A]] 和 [[B]] 和 [[A]]')).toEqual(['a', 'b']);
  });

  it('支持带别名与标题锚点的写法', () => {
    expect(extractWikiLinks('[[叶文洁|文洁]] [[三体#第一章]]')).toEqual(['叶文洁', '三体']);
  });

  it('忽略空链接', () => {
    expect(extractWikiLinks('[[]] [[ ]]')).toEqual([]);
  });
});

describe('parseWikiPage', () => {
  it('解析文档中的 Wiki 页面', () => {
    const page = parseWikiPage(PAGE, 'san-ti-ren-wu-guan-xi.md');
    expect(page.frontmatter).toMatchObject({
      id: 'uuid-wiki-1',
      slug: 'san-ti-ren-wu-guan-xi',
      title: '三体人物关系',
      tags: ['三体', '人物'],
      source_books: ['uuid-1'],
    });
    // frontmatter 里的 links 与正文 [[]] 取并集（设计文档 1.6）
    expect([...page.frontmatter.links].sort((a, b) => a.localeCompare(b))).toEqual(
      ['dark-forest', 'ye-wenjie', '三体', '叶文洁', '黑暗森林法则', '面壁计划'].sort((a, b) => a.localeCompare(b)),
    );
    expect(page.body).toContain('# 三体人物关系');
    expect(page.wikiLinks).toEqual(['叶文洁', '三体', '黑暗森林法则', '面壁计划']);
  });

  it('缺少 frontmatter 时报错', () => {
    expect(() => parseWikiPage('# 没有 frontmatter', 'x.md')).toThrow(/frontmatter/);
  });

  it('frontmatter 未闭合时报错', () => {
    expect(() => parseWikiPage('---\nid: x\n', 'x.md')).toThrow(/未闭合/);
  });
});

describe('序列化往返', () => {
  it('stringifyWikiPage 后再解析得到等价页面', () => {
    const page = parseWikiPage(PAGE, 'san-ti-ren-wu-guan-xi.md');
    const round = parseWikiPage(stringifyWikiPage(page), page.relativePath);
    expect(round.frontmatter).toEqual(page.frontmatter);
    expect(round.body).toBe(page.body);
  });

  it('新建页面带有默认正文', () => {
    const page = createWikiPage({ id: 'w', title: '黑暗森林法则', now: '2026-10-16T00:00:00Z' });
    expect(page.frontmatter.slug).toBe('黑暗森林法则');
    expect(page.relativePath).toBe('黑暗森林法则.md');
    expect(page.body).toBe('# 黑暗森林法则\n');
    expect(stringifyFrontmatter(page.frontmatter)).toContain('slug: 黑暗森林法则');
  });
});

describe('rebuildWikiIndex', () => {
  it('由 pages/ 重建索引并按标题排序', () => {
    const a = createWikiPage({ id: 'a', title: '面壁计划', now: '2026-10-16T00:00:00Z' });
    const b = createWikiPage({ id: 'b', title: '黑暗森林法则', now: '2026-10-16T00:00:00Z' });
    const index = rebuildWikiIndex([a, b], '2026-10-16T12:00:00Z');
    expect(index.pages.map((p) => p.title)).toEqual(['黑暗森林法则', '面壁计划']);
    expect(index.schema_version).toBe('1.0');
    expect(index.pages[0]).toMatchObject({ id: 'b', path: '黑暗森林法则.md' });
  });
});

describe('buildWikiGraph', () => {
  it('构建出链与反链', () => {
    const a = createWikiPage({ id: 'a', title: '叶文洁', now: '2026-10-16T00:00:00Z' });
    const b = createWikiPage({ id: 'b', title: '黑暗森林法则', now: '2026-10-16T00:00:00Z' });
    const withLinks = { ...b, frontmatter: { ...b.frontmatter, links: ['叶文洁'] } };
    const graph = buildWikiGraph([a, withLinks]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.backlinks['叶文洁']).toEqual(['黑暗森林法则']);
    expect(graph.backlinks['黑暗森林法则']).toBeUndefined();
  });

  it('忽略指向不存在页面的链接', () => {
    const a = createWikiPage({ id: 'a', title: 'A', now: '2026-10-16T00:00:00Z' });
    const withDangling = { ...a, frontmatter: { ...a.frontmatter, links: ['ghost'] } };
    const graph = buildWikiGraph([withDangling]);
    expect(Object.keys(graph.backlinks)).toEqual([]);
  });
});
