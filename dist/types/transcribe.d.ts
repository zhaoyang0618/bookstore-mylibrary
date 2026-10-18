/**
 * 录课视频的文字转录（设计文档阶段七：录课视频的文字转录）。
 *
 * 转录本身依赖外部语音识别服务（Whisper / 云厂商 ASR），
 * 因此这里只实现**可插拔的管线**：
 * - 定义 `Transcriber` 接口，具体实现由调用方注入
 * - 负责读取录课元数据、调用转录器、写回 `transcript` 字段
 * - 支持分段转录与断点续写（长视频一次识别不现实）
 *
 * 这样做的好处：dsh 版可以接 dsh 的模型服务，Flutter 版可以接
 * 本地 whisper.cpp 或云端 API，而数据层规范完全一致。
 *
 * @module @bookstore/mylibrary-core/transcribe
 */
import type { FileSystem } from './store.js';
import type { Book, Recording } from './types.js';
/** 一段转录结果。 */
export interface TranscriptSegment {
    /** 开始时间（秒）。 */
    startSeconds: number;
    /** 结束时间（秒）。 */
    endSeconds: number;
    /** 该段文字。 */
    text: string;
    /** 置信度（0 ~ 1），可选。 */
    confidence?: number;
}
/** 转录器接口：由调用方实现（Whisper / 云 ASR / mock）。 */
export interface Transcriber {
    /** 转录器名称，写入日志便于排查。 */
    readonly name: string;
    /**
     * 转录一个音频/视频文件。
     *
     * @param filePath - 本地文件绝对路径
     * @param options - 语言提示等
     */
    transcribe(filePath: string, options?: {
        language?: string;
        signal?: AbortSignal;
    }): Promise<TranscriptSegment[]>;
}
/** 转录选项。 */
export interface TranscribeOptions {
    /** 语言代码，默认 auto。 */
    language?: string;
    /** 单个视频最长转录秒数，超出部分截断（防止意外跑超长视频）。 */
    maxSeconds?: number;
    /** 取消信号。 */
    signal?: AbortSignal;
    /** 进度回调。 */
    onProgress?: (done: number, total: number) => void;
}
/** 转录结果。 */
export interface TranscribeResult {
    recording: Recording;
    segments: TranscriptSegment[];
    /** 拼接后的纯文本（写入 `transcript` 字段）。 */
    text: string;
    /** 是否为已存在转录的增量续写。 */
    resumed: boolean;
}
/** 把分段结果拼成可读文本（带时间戳标记，便于跳转）。 */
export declare function formatTranscript(segments: TranscriptSegment[]): string;
/** 秒 → `mm:ss` 或 `hh:mm:ss`。 */
export declare function formatTimestamp(seconds: number): string;
/** 从带时间戳的转录文本还原成分段（用于幂等重跑）。 */
export declare function parseTranscript(text: string): TranscriptSegment[];
/**
 * 转录一段录课视频并把结果写回元数据。
 *
 * @param options.fs - 文件系统（便于测试注入）
 * @param options.recording - 录课元数据
 * @param options.mediaPath - 视频文件的绝对路径
 * @param options.transcriber - 转录器实现
 * @param options.writeRecording - 写回元数据的回调（由 store 提供）
 */
export declare function transcribeRecording(options: {
    fs: FileSystem;
    recording: Recording;
    mediaPath: string;
    transcriber: Transcriber;
    writeRecording: (recording: Recording) => void;
    transcribeOptions?: TranscribeOptions;
}): Promise<TranscribeResult>;
/**
 * 批量转录一本书的全部录课视频。
 *
 * 单个失败不影响其它：错误收集在 `errors` 里返回。
 */
export declare function transcribeBookRecordings(options: {
    fs: FileSystem;
    book: Book;
    recordings: Recording[];
    resolveMediaPath: (recording: Recording) => string;
    transcriber: Transcriber;
    writeRecording: (recording: Recording) => void;
    transcribeOptions?: TranscribeOptions;
    onRecordingDone?: (recording: Recording, result: TranscribeResult | Error) => void;
}): Promise<{
    results: TranscribeResult[];
    errors: {
        recording: Recording;
        error: Error;
    }[];
}>;
/**
 * 一个不依赖外部服务的转录器：从视频文件名和已有元数据生成占位转录。
 *
 * 用于开发调试与离线环境验证管线本身；生产环境请注入真实 ASR 实现。
 */
export declare class MockTranscriber implements Transcriber {
    private readonly options;
    readonly name = "mock";
    constructor(options?: {
        delayMs?: number;
    });
    transcribe(filePath: string, opts?: {
        language?: string;
        signal?: AbortSignal;
    }): Promise<TranscriptSegment[]>;
}
