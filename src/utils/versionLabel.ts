import type { CliInstance, CliInstanceState, CliVersionType } from '@/api/types'

const STATE_LABEL: Record<CliInstanceState, string> = {
    ready: '可用',
    missing: '缺失',
    broken: '损坏',
    incomplete: '不完整',
}

const TYPE_LABEL: Record<CliVersionType, string> = {
    release: '正式版',
    snapshot: '快照',
    old_beta: '旧测试版',
    old_alpha: '旧预览版',
}

/** 状态显示名，未知取值原样返回 */
export function stateLabel(state: string): string {
    return STATE_LABEL[state as CliInstanceState] ?? state
}

/** 版本类型显示名，空值与未知取值原样返回 */
export function versionTypeLabel(type: string | null): string {
    if (type === null || type.length === 0) {
        return '未标注'
    }
    return TYPE_LABEL[type as CliVersionType] ?? type
}

/** 游戏版本显示名，缺失时返回「未知」 */
export function gameVersionLabel(version: string | null): string {
    return version === null || version.length === 0 ? '未知' : version
}

/** 加载器显示名，原版返回「原版」 */
export function loaderLabel(instance: CliInstance): string {
    if (!instance.loader) {
        return '原版'
    }
    return `${instance.loader.type} ${instance.loader.version}`
}

/** RFC3339 转本地时间，空值与非法值返回「未启动」 */
export function lastPlayedLabel(value: string | null): string {
    if (value === null || value.length === 0) {
        return '未启动'
    }
    const time = new Date(value)
    if (Number.isNaN(time.getTime())) {
        return '未启动'
    }
    return time.toLocaleString()
}
