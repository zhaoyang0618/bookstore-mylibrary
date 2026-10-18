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
pnpm test          # 93 个测试
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

## 测试覆盖

```
Test Files  5 passed (5)
     Tests  93 passed (93)
```

包含：schema 兼容性、五类文档校验、版本对比、冲突合并（书籍并集 / 字段级 / 位置决胜 / holder 并集 / sync_state 择优）、Wiki 解析与序列化往返、扫描导入、四种删除语义、迁移备份，以及**端到端**：两个客户端（模拟 Mac + iPad）读写同一份数据。

## 设计约束的实现方式

- **文件系统即数据库**：所有读写都经由 `FileSystem` 接口（默认 `nodeFs`），测试用 `MemoryFs` 不落盘。
- **文本优先**：元数据 / 笔记 / Wiki / 配置全部 JSON / Markdown；二进制只在 `books/` 下。
- **可选同步，明确状态**：`sync_state` 五维度独立标注，文件不可达是 `missing` 状态而非错误。
- **客户端无关**：不依赖任何宿主框架，可被 Node、CLI、子进程调用方复用。
