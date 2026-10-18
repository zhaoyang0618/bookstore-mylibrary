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
export {};
