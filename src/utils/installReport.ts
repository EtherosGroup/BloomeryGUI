import type { CliDownloadReport, CliInstallReport } from '@/api/types'

/** 单条通道的结果：新下 / 已有 / 失败 */
export function laneText(row: CliDownloadReport): string {
    const failed = row.failures.length === 0 ? '' : ` · 失败 ${row.failures.length}`
    return `新下 ${row.downloaded} · 已有 ${row.skipped}${failed}`
}

export function secondsText(ms: number): string {
    return `${Math.round(ms / 1000)} 秒`
}

/** 安装结果摘要，前台与后台安装共用 */
export function installReportRows(report: CliInstallReport): { key: string; value: string }[] {
    return [
        { key: '实例', value: report.name },
        {
            key: '加载器',
            value:
                report.loader === null ? '原版' : `${report.loader.name} ${report.loader.version}`,
        },
        { key: '库', value: laneText(report.libraries) },
        {
            key: 'natives',
            value: `${report.natives.jars} 个 jar · ${laneText(report.natives.report)}`,
        },
        {
            key: '资源',
            value:
                report.assets === null
                    ? '未装'
                    : `${laneText(report.assets.index)} · ${laneText(report.assets.objects)}`,
        },
        { key: '耗时', value: secondsText(report.timing.downloadMs + report.timing.finishMs) },
        {
            key: '警告',
            value: report.warnings.length === 0 ? '无' : report.warnings.join(' · '),
        },
    ]
}
