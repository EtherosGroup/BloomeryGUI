// CLI 机器接口类型，字段来源 README 形状表

/** 结果信封：对象带 v，数组不带 */
export interface CliResultEnvelope {
    v: number
}

/** 错误信封负载 */
export interface CliErrorPayload {
    code: string
    message: string
    detail: string | null
    exit: number
    retryable: boolean
    context: unknown
}

export interface CliErrorEnvelope {
    v: number
    error: CliErrorPayload
}

/** 进度通道稳定键（CLI 侧 A1） */
export const PROGRESS_KEYS = ['clientJar', 'library', 'natives', 'assets', 'files'] as const

export type ProgressKey = (typeof PROGRESS_KEYS)[number]

/** --version --json；api 与 features 缺失表示 CLI 过旧 */
export interface CliVersionInfo {
    v: number
    version: string
    /** CLI 侧 A3 起必带 */
    api?: number
    features?: string[]
}

/** --progress ndjson 单行 */
export interface CliProgressEvent {
    v: number
    /** 中文显示名，随实现措辞变化 */
    stage: string
    /** CLI 侧 A1 起必带；未知取值按缺省处理，回退到 stage */
    key?: ProgressKey
    done: number
    total: number
    bytes: boolean
    existing?: boolean
    taskId?: string
}

/** 退出码 */
export const CLI_EXIT = {
    ok: 0,
    runtime: 1,
    usage: 2,
    unimplemented: 3,
} as const

/** status：主机信息 */
export interface CliHost {
    platform: string
    arch: string
    memoryMb: number
}

export interface CliJava {
    path: string
    major: number
    version: string
    kind: string
    arch: string
    vendor: string
    source: string
    present: boolean
    /** 真探测是否跑得起来 */
    usable: boolean
}

export interface CliMemory {
    minMb: number
    maxMb: number
    /** 全局配置值 */
    globalMb: number
    /** 选中实例生效值，无选中实例为 null */
    currentMb: number | null
}

export interface CliFolder {
    id: string
    name: string
    path: string
    exists: boolean
    writable: boolean
    instanceCount: number
    /** 是否当前生效文件夹，status 里恒 true */
    selected: boolean
    selectedInstance: string | null
}

export interface CliMirrorPreset {
    id: string
    name: string
    url: string | null
}

export interface CliMirror {
    /** 首次运行未设置时为 null */
    source: string | null
    presets: CliMirrorPreset[]
}

/** status 环境快照 */
export interface CliStatus {
    v: number
    cliVersion: string
    api: number
    node: string
    home: string
    logs: string
    host: CliHost
    java: CliJava[]
    javaDefault: string | null
    memory: CliMemory
    folder: CliFolder | null
    mirror: CliMirror
    features: string[]
}

/** 实例加载器 */
export interface CliLoader {
    type: string
    version: string
}

/** 实例可用状态 */
export type CliInstanceState = 'ready' | 'missing' | 'broken' | 'incomplete'

/** 版本类型 */
export type CliVersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha'

/** version list 的 instances[] 元素 */
export interface CliInstance {
    id: string
    name: string
    target: string
    /** 版本 json 缺字段时为 null */
    gameVersion: string | null
    /** 原版为 null 或缺省 */
    loader?: CliLoader | null
    state: CliInstanceState
    /** 可空 */
    type: CliVersionType | '' | null
    directory: string
    chain: string[]
    /** 是否在 setting.json 里有配置项 */
    configured: boolean
    /** 是否由扫描发现 */
    discovered: boolean
    problem: string | null
    /** RFC3339 UTC，没启动过为 null */
    lastPlayed: string | null
    java: {
        required: { major: number } | null
        resolved: unknown
    }
}

/** version list 结果 */
export interface CliVersionList {
    v: number
    /** 文件夹 id */
    id: string
    name: string
    path: string
    exists: boolean
    writable: boolean
    versionsDirectory: string
    /** 当前选中实例 */
    selectedInstance: string | null
    dropped: unknown[]
    instances: CliInstance[]
}

/** version select 结果 */
export interface CliVersionSelect {
    v: number
    selected: string
    folder: string
}

/** launch 结果，--dry-run 时 pid 与 log 恒为 null */
export interface CliLaunchResult {
    v: number
    version: string
    executable: string
    directory: string
    /** 启动参数，--dry-run 下用于展示命令 */
    args?: string[]
    java?: { major: number; vendor: string; kind: string }
    account?: { name: string; uuid: string; kind: string }
    selectedInstance: string | null
    /** 启动的进程号 */
    pid: number | null
    /** 游戏日志路径 */
    log: string | null
    missing: string[]
    repair: unknown
}

/** view game <版本> 里某个加载器在那一个游戏版本上的规模 */
export interface CliGameLoader {
    loader: string
    /** 取不到为 null */
    latest: string | null
    /** 0 表示这个游戏版本上没有 */
    total: number
}

/** view game <版本> 的结果，只要每个加载器的规模，不要那页合并版本 */
export interface CliGameLoaderPage {
    v: number
    game: string
    loaders: CliGameLoader[]
    /** 某一家取不到时的说明 */
    warnings: string[]
}

export type CliLoaderChannel = 'release' | 'beta' | 'alpha'

/** view loader 列出的单个加载器版本 */
export interface CliLoaderVersion {
    version: string
    /** forge 的清单按游戏版本分组，其余为 null */
    gameVersion: string | null
    channel: CliLoaderChannel
}

/** view loader <名字> --game <版本> 的结果，一页 20 条 */
export interface CliLoaderPage {
    v: number
    loader: string
    game: string
    page: number
    pages: number
    perPage: number
    total: number
    versions: CliLoaderVersion[]
}

export interface CliDownloadFailure {
    target: string
    error: string
}

/** 下载四类通道各自的结果 */
export interface CliDownloadReport {
    downloaded: number
    skipped: number
    bytes: number
    failures: CliDownloadFailure[]
}

/** install 的结果报告 */
export interface CliInstallReport {
    v: number
    name: string
    versionId: string
    loader: { name: string; version: string } | null
    /** 加载器要的基础版本是本来就有，还是这次顺带装的 */
    base: 'none' | 'present' | 'installed'
    clientJar: boolean
    libraries: CliDownloadReport
    natives: { jars: number; files: number; report: CliDownloadReport }
    assets: { index: CliDownloadReport; objects: CliDownloadReport } | null
    /** 走官方安装器时才有 */
    official: unknown
    timing: { downloadMs: number; finishMs: number }
    warnings: string[]
}
