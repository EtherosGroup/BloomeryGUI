/** CLI 错误码到界面文案；未收录的码返回空串，由调用方退回原始 message */
const ERROR_LABEL: Record<string, string> = {
    // 与 CLI 的 src/error/codes.ts 联合类型对齐，按码分档而非按文案
    UnknownError: '内部错误',
    UsageError: '参数不合法',
    UnknownCommand: '命令不存在',
    NotImplemented: '该功能尚未实现',
    ConfigTooNew: '配置版本比程序新',
    FileWriteFailed: '数据目录不可写',
    FolderNotFound: '游戏文件夹不存在',
    FolderUnusable: '游戏文件夹不可用',
    FolderDuplicate: '游戏文件夹已添加过',
    VersionNotFound: '实例不存在',
    VersionBroken: '无法读取版本文件',
    InstallBroken: '安装文件校验不符',
    LoaderInstallFailed: '加载器安装失败',
    GameFilesMissing: '启动文件缺失',
    VersionExists: '实例名已存在',
    JavaNotFound: '找不到可用的 Java',
    JavaBroken: 'Java 跑不起来',
    JavaDuplicate: '这个 Java 已在清单里',
    DependencyMissing: '依赖文件缺失',
    DownloadFailed: '下载失败',
    TaskNotFound: '找不到这个下载任务',
    WorkerBusy: '已有下载进程在运行',
    AccountNotFound: '账户不存在',
    AccountExists: '这个账号已在清单里',
    AccountExpired: '账户凭据需要刷新',
    MicrosoftClientIdMissing: '缺少微软应用 id',
    MicrosoftLoginFailed: '微软登录失败',
    MicrosoftNotOwned: '这个微软账户没有 Minecraft: Java Edition',
    ModNotFound: '没找到这个 MOD',
    ModUnsupported: '这个实例装不了这个 MOD',
    LaunchFailed: '游戏进程没起来',
}

/** GUI 侧本地错误码 */
const LOCAL_LABEL: Record<string, string> = {
    SpawnFailed: '无法启动 CLI',
    EnvelopeMissing: 'CLI 未返回错误信封',
    InvalidJson: '返回内容不是 JSON',
    InvalidShape: '返回内容形状不符',
}

/** 错误码对应的界面标签 */
export function errorLabel(code: string): string {
    return ERROR_LABEL[code] ?? LOCAL_LABEL[code] ?? ''
}

/** 兜底：仅在拿不到错误信封（GUI 本地错误）时使用，权威来源是信封里的 retryable */
const RETRYABLE_CODE = new Set(['DownloadFailed', 'DependencyMissing'])

/** 单行错误摘要：有标签时拼上原始 message，可重试的补一句动作提示 */
export function errorSummary(code: string, message: string, retryable?: boolean): string {
    const label = errorLabel(code)
    let text = message
    if (label.length > 0) {
        text = message.length > 0 && message !== label ? `${label} · ${message}` : label
    }
    // 不可重试不显示，避免负面噪音
    const canRetry = retryable ?? RETRYABLE_CODE.has(code)
    return canRetry && text.length > 0 ? `${text} · 可重试` : text
}
