# mylibrary — 共享数据层（两个软件的唯一契约）

设计文档**第一部分**的完整实现。dsh 扩展版与 Flutter 跨平台版都通过这一份代码读写同一份 `MyLibrary/` 数据。

## 为什么独立成包

设计文档 1.8.1 要求「两套软件共用同一个 Schema 校验工具」，第一部分又是「唯一契约」。
因此把它做成独立的 npm 包 + CLI：

- **dsh 扩展版**：`import { MyLibraryStore } from '@bookstore/mylibrary-core'`
- **Flutter 跨平台版**：通过子进程调用 `mylibrary` CLI（Dart 侧无需重复实现）

## 目录

```
mylibrary/
├── src/
│   ├── types.ts       # 数据契约类型（1.3 ~ 1.7）
│   ├── layout.ts      # MyLibrary 目录结构常量（1.2）
│   ├── schema.ts      # schema_version 兼容性（1.9）
│   ├── validate.ts    # Schema 校验器（阶段一任务 2）
│   ├── wiki.ts        # Wiki 页面 frontmatter / [[]] / 图谱（1.6）
│   ├── sync.ts        # 版本对比 / 冲突合并 / 请求队列 / 删除语义（1.8）
│   ├── scanner.ts     # 本地导入：扫描目录 → books/{书名}/（2.5 / 3.4）
│   ├── chunks.ts      # 大文件分片上传 + 断点续传（1.8.6）
│   ├── watch.ts       # 文件监视：fs.watch + 轮询兜底（阶段六）
│   ├── transcribe.ts  # 录课转录：可插拔 Transcriber（阶段七）
│   ├── pdf-annotate.ts # PDF 注释中间表示 + 中文 UTF-16BE 编码（1.5）
│   ├── pdf-writer.ts   # PDF 注释真实写入/读回（pdf-lib，可选依赖）
│   ├── store.ts       # MyLibraryStore：文件系统访问层
│   ├── cli.ts         # CLI 入口
│   ├── fixture.ts     # 示例数据生成
│   └── __tests__/     # 93 个单元测试
├── dist/              # 构建产物
└── fixtures/          # 示例 MyLibrary（本地 + 网盘两份）
```

## 快速开始

```bash
pnpm install
pnpm test          # 185 个测试
pnpm run build     # 产出 dist/

# 生成示例数据（本地 + 网盘两份，用于两端联调）
node dist/fixture.js

# 校验一个 MyLibrary 目录（退出码 0/1，可接入 CI）
node dist/cli.js validate fixtures/MyLibrary
node dist/cli.js validate fixtures/MyLibrary --json

# 对比本地与网盘，产出冲突合并计划
node dist/cli.js compare fixtures/MyLibrary fixtures/MyLibrary-cloud

# 其它
node dist/cli.js init <目录>       # 初始化标准结构
node dist/cli.js migrate <目录>    # 迁移 schema（自动备份到 .trash/）
node dist/cli.js graph <目录>      # Wiki 双向链接图谱
node dist/cli.js chunks <目录> <book_id> <视频文件名> [分片大小]  # 分片上传与续传
node dist/cli.js pdf-annotations <目录> <PDF相对路径> [页码...]  # 列出 PDF 批注
```

## 已实现的设计文档条目

| 章节 | 内容 | 状态 |
|---|---|---|
| 1.2 | `MyLibrary/` 目录结构 | ✅ `layout.ts` + `store.init()` |
| 1.3 | `manifest.json` | ✅ 读写 + 客户端上线 |
| 1.4 | `library.json`（权威数据源） | ✅ 增删改查 + 标签/收藏夹 |
| 1.5 | 笔记边车 | ✅ epubcfi / line_range / char_offset / ink 四种锚点 |
| 1.6 | Wiki 页面 | ✅ frontmatter 解析、`[[]]`、索引重建、图谱 |
| 1.7 | 录课视频元数据 | ✅ |
| 1.8.1 | 版本对比流程 | ✅ `planSync()` |
| 1.8.2 | 冲突处理 | ✅ 字段级合并 + `updated_at` 决胜 + `held_by` 并集 |
| 1.8.4 | 同步请求队列 | ✅ `requests/` 读写 |
| 1.8.5 | 删除语义（四种） | ✅ `planDelete()` + `store.deleteBook()` |
| 1.8.6 | 大文件分片 | ✅ 目录约定 + `partsDir()` |
| 1.9 | Schema 演进 | ✅ 兼容性检查 + 迁移前自动备份 |
| 2.5 / 3.4 | 本地导入流程 | ✅ `scanner.ts` |
| 阶段六 | 桌面端文件监视 | ✅ `watch.ts`（fs.watch + 轮询兜底） |
| 阶段七 | 录课视频文字转录 | ✅ `transcribe.ts`（可插拔转录器） |
| 1.5 / 4.2 | PDF 注释跨端互通 | ✅ `pdf-annotate.ts` + `pdf-writer.ts` |

## 测试覆盖

```
Test Files  10 passed (10)
     Tests  185 passed (185)
```

包含：schema 兼容性、五类文档校验、版本对比、冲突合并（书籍并集 / 字段级 / 位置决胜 / holder 并集 / sync_state 择优）、Wiki 解析与序列化往返、扫描导入、四种删除语义、迁移备份，以及**端到端**：两个客户端（模拟 Mac + iPad）读写同一份数据。

## PDF 注释（跨端批注的关键）

设计文档规定 PDF 笔记**直接写回文件本身**，且必须是 **PDF 原生注释对象**，
这样 dsh 版（PDF.js）与 Flutter 版（PDFium）才能互相看见。

```typescript
import { writeAnnotationsToPdf, readAnnotationsFromPdf } from 'mylibrary-core';

// 写回
await writeAnnotationsToPdf('book.pdf', annotations, { author: 'dsh-extension' });

// 读回另一端写入的批注
const { annotations } = await readAnnotationsFromPdf('book.pdf');
```

### 支持的三类注释

| 批注类型 | PDF Subtype | 说明 |
|---|---|---|
| 高亮 | `/Highlight` | 带 `/QuadPoints` 四边形定位 |
| 便签 | `/Text` | 带 `/Contents` 正文 |
| 墨迹 | `/Ink` | 带 `/InkList` 矢量路径（点 + 压力 + 时间戳） |

### 中文编码（踩过的坑）

PDF 普通字符串 `(...)` 用 PDFDocEncoding，**装不下中文**——直接写会变乱码：

```
PDFString.of('黑暗森林法则')        → 读回 "ÑŠîŠÕˇ"     ❌
PDFHexString.fromText('黑暗森林法则') → 读回 "黑暗森林法则" ✅
```

因此 `/Contents`、`/T`、`/NM` 一律走 UTF-16BE 十六进制串（`<FEFF...>`）。
`encodePdfText` / `decodePdfText` 把这条规则固化下来，并由测试守护。

### pdf-lib 是可选依赖

只做数据校验时不装也能用；调用写入功能才需要 `pdf-lib`。
Flutter 版走 PDFium FFI，完全不需要它——两个实现共享的是
`PdfAnnotationSpec` 这个**与库无关的中间表示**。

## 设计约束的实现方式

- **文件系统即数据库**：所有读写都经由 `FileSystem` 接口（默认 `nodeFs`），测试用 `MemoryFs` 不落盘。
- **文本优先**：元数据 / 笔记 / Wiki / 配置全部 JSON / Markdown；二进制只在 `books/` 下。
- **可选同步，明确状态**：`sync_state` 五维度独立标注，文件不可达是 `missing` 状态而非错误。
- **客户端无关**：不依赖任何宿主框架，可被 Node、CLI、子进程调用方复用。
