/** auth list 行：公开字段加选中标记与状态 */
export interface CliAccount extends Record<string, unknown> {
    id: string
    type: string
    name: string
    uuid: string | null
    /** 是否当前选中账户 */
    selected: boolean
    /** 可用 / 需要登录 / 凭据过期 */
    status: string
}
