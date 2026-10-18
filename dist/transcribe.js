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
/** 把分段结果拼成可读文本（带时间戳标记，便于跳转）。 */
export function formatTranscript(segments) {
    return segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => `[${formatTimestamp(segment.startSeconds)}] ${segment.text.trim()}`)
        .join('\n');
}
/** 秒 → `mm:ss` 或 `hh:mm:ss`。 */
export function formatTimestamp(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
/** 从带时间戳的转录文本还原成分段（用于幂等重跑）。 */
export function parseTranscript(text) {
    const segments = [];
    for (const line of text.split('\n')) {
        const match = /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/.exec(line.trim());
        if (match === null)
            continue;
        const [, a, b, c, content] = match;
        const seconds = c !== undefined
            ? Number(a) * 3600 + Number(b) * 60 + Number(c)
            : Number(a) * 60 + Number(b);
        segments.push({ startSeconds: seconds, endSeconds: seconds, text: content ?? '' });
    }
    return segments;
}
/**
 * 转录一段录课视频并把结果写回元数据。
 *
 * @param options.fs - 文件系统（便于测试注入）
 * @param options.recording - 录课元数据
 * @param options.mediaPath - 视频文件的绝对路径
 * @param options.transcriber - 转录器实现
 * @param options.writeRecording - 写回元数据的回调（由 store 提供）
 */
export async function transcribeRecording(options) {
    const { recording, mediaPath, transcriber, writeRecording } = options;
    const transcribeOptions = options.transcribeOptions ?? {};
    if (!options.fs.exists(mediaPath)) {
        throw new Error(`录课视频不存在：${mediaPath}`);
    }
    transcribeOptions.signal?.throwIfAborted();
    // 已有转录时增量续写：跳过已覆盖的时间段
    const existing = recording.transcript !== undefined ? parseTranscript(recording.transcript) : [];
    const resumed = existing.length > 0;
    const coveredUntil = existing.reduce((max, seg) => Math.max(max, seg.endSeconds), 0);
    const segments = await transcriber.transcribe(mediaPath, {
        ...(transcribeOptions.language !== undefined ? { language: transcribeOptions.language } : {}),
        ...(transcribeOptions.signal !== undefined ? { signal: transcribeOptions.signal } : {}),
    });
    // 截断超长部分并过滤已覆盖时间段
    const maxSeconds = transcribeOptions.maxSeconds ?? Number.POSITIVE_INFINITY;
    // 去重键：起点秒数（同一起点视为同一句，避免重复追加）
    const coveredStarts = new Set(existing.map((segment) => segment.startSeconds));
    const fresh = segments
        .filter((segment) => segment.startSeconds < maxSeconds)
        .filter((segment) => segment.startSeconds >= coveredUntil || !coveredStarts.has(segment.startSeconds))
        .filter((segment) => !coveredStarts.has(segment.startSeconds));
    const merged = [...existing, ...fresh].sort((a, b) => a.startSeconds - b.startSeconds);
    const text = formatTranscript(merged);
    const updated = {
        ...recording,
        transcript: text,
    };
    writeRecording(updated);
    return { recording: updated, segments: merged, text, resumed };
}
/**
 * 批量转录一本书的全部录课视频。
 *
 * 单个失败不影响其它：错误收集在 `errors` 里返回。
 */
export async function transcribeBookRecordings(options) {
    const results = [];
    const errors = [];
    for (const recording of options.recordings) {
        options.transcribeOptions?.signal?.throwIfAborted();
        try {
            const result = await transcribeRecording({
                fs: options.fs,
                recording,
                mediaPath: options.resolveMediaPath(recording),
                transcriber: options.transcriber,
                writeRecording: options.writeRecording,
                ...(options.transcribeOptions !== undefined ? { transcribeOptions: options.transcribeOptions } : {}),
            });
            results.push(result);
            options.onRecordingDone?.(recording, result);
        }
        catch (error) {
            const normalized = error instanceof Error ? error : new Error(String(error));
            errors.push({ recording, error: normalized });
            options.onRecordingDone?.(recording, normalized);
        }
    }
    return { results, errors };
}
/**
 * 一个不依赖外部服务的转录器：从视频文件名和已有元数据生成占位转录。
 *
 * 用于开发调试与离线环境验证管线本身；生产环境请注入真实 ASR 实现。
 */
export class MockTranscriber {
    options;
    name = 'mock';
    constructor(options = {}) {
        this.options = options;
    }
    async transcribe(filePath, opts) {
        if (this.options.delayMs !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
        }
        opts?.signal?.throwIfAborted();
        const name = filePath.split('/').pop() ?? 'video';
        return [
            { startSeconds: 0, endSeconds: 15, text: `[占位转录] 开始讲解：${name}`, confidence: 0.9 },
            { startSeconds: 15, endSeconds: 60, text: '[占位转录] 接入真实 ASR 后此处为识别文本', confidence: 0.85 },
        ];
    }
}
