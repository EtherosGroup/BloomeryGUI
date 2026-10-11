/*
 * 启动阶段：步骤表与每一步的说明
 *
 * 微软凭据过期时 CLI 先续期，该步无进度事件，界面据此说明
 * 单独成模块，供不起界面的回归覆盖
 */

export type LaunchStepState = 'pending' | 'current' | 'done' | 'failed'

export interface LaunchStep {
    key: string
    label: string
    state: LaunchStepState
}

/** 判断用得到的账户字段，与 CliAccount 的结构对应 */
export interface LaunchAccount {
    type: string
    /** 可用 / 需要登录 / 凭据过期 */
    status: string
}

/** 启动计划里的账户字段，1.13.1 起带 needsRefresh */
export interface PlanAccount {
    needsRefresh?: boolean
}

/**
 * 选中账户的微软凭据是否已过期
 *
 * 与 CLI 的 needsRefresh 同一判据：过期或快过期就要先续期
 */
export function credentialsExpired(account: LaunchAccount | null): boolean {
    return account !== null && account.type === 'microsoft' && account.status === '凭据过期'
}

/**
 * 计划里的续期标记
 *
 * 1.13.1 起 `launch --dry-run` 不再自己续期，计划里的 needsRefresh 就是真启动前的实际状态，
 * 比读账户列表准；旧引擎缺这个字段时给 null，由调用方退回账户状态判断
 */
export function planNeedsRefresh(account: PlanAccount | null | undefined): boolean | null {
    if (account === null || account === undefined) {
        return null
    }
    // 缺字段是旧引擎没有这个字段，false 是引擎判定不用续期
    if (typeof account.needsRefresh !== 'boolean') {
        return null
    }
    return account.needsRefresh
}

/** 启动步骤；凭据过期时在检查文件之后多一步续期 */
export function launchSteps(withCredentials: boolean): LaunchStep[] {
    const rows: LaunchStep[] = [{ key: 'verify', label: '检查文件完整性', state: 'pending' }]
    if (withCredentials) {
        rows.push({ key: 'credentials', label: '刷新微软凭据', state: 'pending' })
    }
    rows.push(
        { key: 'repair', label: '补全文件', state: 'pending' },
        { key: 'spawn', label: '拉起游戏进程', state: 'pending' },
        { key: 'window', label: '等待游戏窗口出现', state: 'pending' },
    )
    return rows
}

/** 当前步骤的说明；慢的那步给出原因 */
export function launchPhaseHint(stepKey: string | null): string {
    switch (stepKey) {
        case 'credentials':
            return '微软凭据已过期，正在换取访问令牌 · 等待微软服务器应答'
        case 'repair':
            return '正在检查并补全启动文件'
        case 'window':
            return '进程已拉起，正在等游戏窗口出现'
        default:
            return ''
    }
}
