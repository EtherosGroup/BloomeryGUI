/** 一次导入结束后的统计，父页面据此刷新并提示 */
export interface ImportSummary {
    /** 成功导入的目录数 */
    succeeded: number
    /** 失败的目录数；为 0 表示全部成功 */
    failed: number
}

/** 逐个目录导入时某个目录失败的错误信封摘要 */
export interface ImportFailure {
    path: string
    code: string
    message: string
    detail: string | null
    retryable: boolean
}
