/** CLI 错误码到界面文案；未收录的码返回空串，由调用方退回原始 message */
const ERROR_LABEL: Record<string, string> = {
    FileWriteFailed: '数据目录不可写',
    AccountNotFound: '账户不存在',
    VersionNotFound: '实例不存在',
    VersionExists: '实例名已存在',
    FolderNotFound: '文件夹不存在',
    UsageError: '参数不合法',
    UnknownCommand: '命令不存在',
    WorkerBusy: '已有下载进程在运行',
    DownloadFailed: '下载失败',
    DependencyMissing: '依赖缺失',
    MicrosoftClientIdMissing: '缺少微软应用 id',
    SpawnFailed: '无法启动 CLI',
    EnvelopeMissing: 'CLI 未返回错误信封',
    InvalidJson: '返回内容不是 JSON',
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

/** 单行错误摘要：有标签时拼上原始 message */
export function errorSummary(code: string, message: string): string {
    const label = errorLabel(code)
    if (label.length === 0) {
        return message
    }
    return message.length > 0 && message !== label ? `${label} · ${message}` : label
}
