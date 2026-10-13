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

/** 进度通道稳定键（CLI 侧 A1）；mod 由 mod install 与 mod list 反查共用，account 是启动前续期 */
export const PROGRESS_KEYS = [
    'clientJar',
    'library',
    'natives',
    'assets',
    'files',
    'mod',
    'account',
] as const

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

/** 实例加载器；原版实例 CLI 给 type 为 vanilla 且 version 为 null */
export interface CliLoader {
    type: string
    version: string | null
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
    /** needsRefresh 是 1.13.1 起才有，缺失表示引擎更旧 */
    account?: { name: string; uuid: string; kind: string; needsRefresh?: boolean }
    selectedInstance: string | null
    /** 启动的进程号 */
    pid: number | null
    /** 游戏日志路径 */
    log: string | null
    missing: string[]
    /** 只有真启动才有；补不动的项在 warnings 里 */
    repair: { warnings?: string[] } | null
}

/** 某个加载器在一个游戏版本上的规模，来自 view loader --game */
export interface CliGameLoader {
    loader: string
    /** 取不到为 null */
    latest: string | null
    /** 0 表示这个游戏版本上没有 */
    total: number
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

/* ---------- mod：检索、列表、安装与管理 ---------- */

/** mod 命令要求的 api；低于它没有这些命令 */
export const MOD_API_REQUIRED = 2

/** mod search 的命中项 */
export interface CliModHit {
    id: string
    slug: string
    title: string
    description: string
    downloads: number
    loaders: string[]
    /** 项目声明支持的版本，不代表一定兼容当前加载器组合 */
    gameVersions: string[]
    categories: string[]
}

/** mod search 结果；三个上下文字段未指定时是显式 null */
export interface CliModSearch {
    v: number
    query: string
    /** 实例 id，没给 --version/--folder 为 null */
    instance: string | null
    gameVersion: string | null
    /** 原版实例为 null */
    loader: string | null
    hits: CliModHit[]
}

/** mod list 的单个文件 */
export interface CliModFile {
    /** 磁盘上的真实文件名，禁用态带 .disabled */
    filename: string
    path: string
    size: number
    /** 读不到时为 null */
    sha1: string | null
    enabled: boolean
    /** 反查成功才为 true；false 时 project 与 version 均为 null，字段本身在 */
    resolved: boolean
    project: { id: string; slug: string; title: string } | null
    version: { id: string; number: string; type: string } | null
}

/** mod list 结果 */
export interface CliModList {
    v: number
    instance: string
    /** 实例的 mods 目录绝对路径 */
    mods: string
    files: CliModFile[]
}

/** 改名条目 */
export interface CliModChange {
    from: string
    /** remove 为 null，disable 为 .disabled 名，enable 为 .jar 名 */
    to: string | null
    path: string
}

/** 没处理的目标；reason 是稳定机器键 */
export interface CliModSkip {
    target: string
    reason: string
}

/** remove / disable / enable 结果；有 skipped 时退出码 1，不抛异常 */
export interface CliModMutation {
    v: number
    instance: string
    mods: string
    action: string
    dryRun: boolean
    changed: CliModChange[]
    skipped: CliModSkip[]
}

/** 装进去的单个文件 */
export interface CliModInstalledFile {
    projectId: string
    title: string
    filename: string
    path: string
    size: number
    version: string
    /** 同名文件本来就有 */
    skipped: boolean
}

/** required 之外的依赖只提示 */
export interface CliModDependency {
    projectId: string | null
    type: string
    title: string | null
    requirement: string
}

/** mod install 的一条成功结果 */
export interface CliModInstallEntry {
    query: string
    ok: boolean
    project: { id: string; slug: string; title: string }
    version: {
        id: string
        number: string
        type: string
        gameVersions: string[]
        loaders: string[]
    }
    files: CliModInstalledFile[]
    dependencies: CliModDependency[]
    warnings: string[]
}

/** mod install 的一条失败结果；单条失败不再抛错，由这里带出 */
export interface CliModInstallFailure {
    query: string
    ok: boolean
    code: string
    detail: string
    retryable: boolean
}

/** mod install 结果；单条与多条同形状 */
export interface CliModInstallResult {
    v: number
    instance: string
    mods: string
    installs: CliModInstallEntry[]
    failed: CliModInstallFailure[]
}

/** version removed 列出的一个已移除版本 */
export interface CliRemovedInstance {
    id: string
    /** 已移除版本的目录；CLI 里叫 directory */
    directory: string
}

/** version removed 结果；空列表也是成功 */
export interface CliRemovedList {
    v: number
    action: string
    folder: string
    path: string
    versions: CliRemovedInstance[]
}

/** 下载队列里的任务，--async 才有 */
export interface CliModTask {
    id: string
    type: string
    target: string
    state: string
    progress: unknown
}

/** mod install --async 结果 */
export interface CliModAsyncResult {
    v: number
    instance: string
    tasks: CliModTask[]
    spawn: { outcome: string; pid: number | null; log: string | null }
}
