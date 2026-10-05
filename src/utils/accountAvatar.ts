import type { CliAccount } from '@/api/account'

/** 皮肤头渲染服务，仅 uuid 可用时取远程头像 */
const HEAD_URL = 'https://mc-heads.net/avatar'

export function avatarUrl(account: CliAccount, size = 64): string | null {
    return account.uuid ? `${HEAD_URL}/${account.uuid}/${size}` : null
}

/** 无头像时的文字占位 */
export function avatarInitial(name: string): string {
    const first = name.trim().slice(0, 1)
    return first.length > 0 ? first.toUpperCase() : '?'
}

/** 账户类型显示名 */
export function accountTypeLabel(type: string): string {
    return type === 'microsoft' ? 'Microsoft' : '离线登录'
}
