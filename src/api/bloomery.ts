import {
    CLI_EXIT,
    PROGRESS_KEYS,
    type CliErrorEnvelope,
    type CliErrorPayload,
    type CliProgressEvent,
    type CliVersionInfo,
    type ProgressKey,
} from './types'

/** GUI 侧错误码，与 CLI 错误码不同源 */
export const LOCAL_ERROR_CODE = {
    /** 子进程无法启动 */
    spawnFailed: 'SpawnFailed',
    /** 退出码非 0 且 stdout 无错误信封 */
    envelopeMissing: 'EnvelopeMissing',
    /** stdout 非法 JSON */
    invalidJson: 'InvalidJson',
    /** 由 GUI 取消 */
    cancelled: 'Cancelled',
} as const

export interface CliProcessResult {
    code: number
    stdout: string
    stderr: string
}

export interface CliRunRequest {
    /** 调用方指定，用于 killCli 取消 */
    id?: string
    args: string[]
    /** stderr 逐行回调；进度 ndjson 与人类提示混在同一路 */
    onStderrLine?: (line: string) => void
}

/** 传输层：Tauri 侧与 Node 侧各实现一份 */
export interface CliTransport {
    run(request: CliRunRequest): Promise<CliProcessResult>
}

export interface CliRunOptions {
    /** 调用方指定，用于 killCli 取消 */
    id?: string
    onProgress?: (event: CliProgressEvent) => void
    /** 探活一类不需要进度的调用传 false */
    progress?: boolean
}

export interface BloomeryClientOptions {
    transport: CliTransport
    /** CLI 数据目录，GUI 固定传入 */
    home: string
}

/** CLI 调用失败；分支判据是 code */
export class BloomeryError extends Error {
    readonly code: string
    readonly exit: number
    readonly retryable: boolean
    readonly detail: string | null
    readonly payload: CliErrorPayload | null

    constructor(
        code: string,
        message: string,
        options: {
            exit?: number
            retryable?: boolean
            detail?: string | null
            payload?: CliErrorPayload | null
        } = {},
    ) {
        super(message)
        this.name = 'BloomeryError'
        this.code = code
        this.exit = options.exit ?? -1
        this.retryable = options.retryable ?? false
        this.detail = options.detail ?? null
        this.payload = options.payload ?? null
    }
}

/** 全局旗标排在命令名之前；home 为空时交给 CLI 用默认数据目录 */
export function buildCliArgs(home: string, command: string[], progress: boolean): string[] {
    const args: string[] = []
    if (home.trim().length > 0) {
        args.push('--home', home)
    }
    args.push('--json')
    if (progress) {
        args.push('--progress', 'ndjson')
    }
    return [...args, ...command]
}

/** 进度事件解析，非 JSON 行返回 null */
export function parseProgressLine(line: string): CliProgressEvent | null {
    const text = line.trim()
    if (!text.startsWith('{')) {
        return null
    }
    try {
        const value = JSON.parse(text) as Partial<CliProgressEvent>
        const shaped =
            typeof value.v === 'number' &&
            typeof value.stage === 'string' &&
            typeof value.done === 'number' &&
            typeof value.total === 'number'
        if (!shaped) {
            return null
        }
        // 未知键降级为缺省，消费方回退到 stage
        const key = PROGRESS_KEYS.find((item) => item === value.key) as ProgressKey | undefined
        return { ...(value as CliProgressEvent), key }
    } catch {
        return null
    }
}

/** api 兼容判断：缺失或低于要求即不兼容 */
export function meetsApi(info: CliVersionInfo, required: number): boolean {
    return typeof info.api === 'number' && info.api >= required
}

function readErrorPayload(stdout: string): CliErrorPayload | null {
    try {
        const value = JSON.parse(stdout) as Partial<CliErrorEnvelope>
        return value?.error && typeof value.error.code === 'string' ? value.error : null
    } catch {
        return null
    }
}

/** 取首行非空文本，用于错误 detail */
function firstLine(text: string): string | null {
    const line = text.split('\n').find((item) => item.trim().length > 0)
    return line ? line.trim() : null
}

export class BloomeryClient {
    private readonly transport: CliTransport
    private readonly home: string

    constructor(options: BloomeryClientOptions) {
        this.transport = options.transport
        this.home = options.home
    }

    /** 探活：退出码 0 且 version 可解析 */
    async probe(): Promise<CliVersionInfo> {
        const info = await this.run<CliVersionInfo>(['--version'], { progress: false })
        if (typeof info?.version !== 'string' || info.version.length === 0) {
            throw new BloomeryError(LOCAL_ERROR_CODE.invalidJson, 'version 字段缺失', {
                exit: CLI_EXIT.ok,
            })
        }
        return info
    }

    /** 跑一条命令，返回 --json 的结果对象 */
    async run<T>(command: string[], options: CliRunOptions = {}): Promise<T> {
        const onProgress = options.onProgress
        const args = buildCliArgs(this.home, command, options.progress ?? true)

        let result: CliProcessResult
        try {
            result = await this.transport.run({
                id: options.id,
                args,
                onStderrLine: onProgress
                    ? (line) => {
                          const event = parseProgressLine(line)
                          if (event) {
                              onProgress(event)
                          }
                      }
                    : undefined,
            })
        } catch (cause) {
            throw new BloomeryError(LOCAL_ERROR_CODE.spawnFailed, '无法启动 bloomery', {
                exit: -1,
                detail: String(cause),
            })
        }

        const payload = readErrorPayload(result.stdout)
        if (result.code !== CLI_EXIT.ok || payload) {
            if (payload) {
                throw new BloomeryError(payload.code, payload.message, {
                    exit: payload.exit,
                    retryable: payload.retryable,
                    detail: payload.detail,
                    payload,
                })
            }
            throw new BloomeryError(
                LOCAL_ERROR_CODE.envelopeMissing,
                `退出码 ${result.code}，stdout 无错误信封`,
                { exit: result.code, detail: firstLine(result.stderr) },
            )
        }

        try {
            return JSON.parse(result.stdout) as T
        } catch {
            throw new BloomeryError(LOCAL_ERROR_CODE.invalidJson, 'stdout 不是合法 JSON', {
                exit: result.code,
                detail: firstLine(result.stdout),
            })
        }
    }
}
