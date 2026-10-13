// MOD 页面的文案换算，两个页面共用

/** 下载量按万 / 亿显示，位数多了读不动 */
export function downloadsText(value: number): string {
    if (value >= 100000000) {
        return `${(value / 100000000).toFixed(1)} 亿`
    }
    if (value >= 10000) {
        return `${(value / 10000).toFixed(1)} 万`
    }
    return String(value)
}

/** 文件大小，取不到时给未知 */
export function sizeText(value: number): string {
    if (value <= 0) {
        return '未知大小'
    }
    if (value >= 1024 * 1024) {
        return `${(value / 1024 / 1024).toFixed(1)} MB`
    }
    return `${Math.max(1, Math.round(value / 1024))} KB`
}

/** 加载器最多列四个，其余计数 */
export function loaderText(rows: string[]): string {
    if (rows.length === 0) {
        return '未标注'
    }
    const head = rows.slice(0, 4).join(' ')
    return rows.length > 4 ? `${head} 等 ${rows.length} 个` : head
}

/** 项目声明的游戏版本很长，只列最新的几个 */
export function gameText(rows: string[]): string {
    if (rows.length === 0) {
        return '未标注'
    }
    const newest = [...rows].slice(-3).reverse()
    return rows.length > 3 ? `${newest.join(' ')} 等 ${rows.length} 个` : newest.join(' ')
}

/** 删除禁用启用里没处理的原因，CLI 给的是稳定机器键 */
const SKIP_LABEL: Record<string, string> = {
    'not-found': '文件不存在',
    ambiguous: '匹配到多个文件',
    'already-disabled': '已禁用',
    'already-enabled': '已启用',
    conflict: '目标名被占用',
}

/** 未知键原样返回，CLI 加新键时界面不至于空着 */
export function skipLabel(reason: string): string {
    return SKIP_LABEL[reason] ?? reason
}
