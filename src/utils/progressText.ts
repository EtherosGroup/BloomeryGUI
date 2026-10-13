/** 进度通道的文案换算，安装与下载页面共用 */

export function percentText(row: { done: number; total: number }): string {
    if (row.total <= 0) {
        return '0%'
    }
    return `${Math.min(100, Math.round((row.done / row.total) * 100))}%`
}

/** 字节通道按 MB，其余按条数 */
export function laneCountText(row: { done: number; total: number; bytes: boolean }): string {
    const text = (value: number): string =>
        row.bytes ? `${(value / 1024 / 1024).toFixed(1)} MB` : String(value)
    return `${text(row.done)}/${text(row.total)}`
}
