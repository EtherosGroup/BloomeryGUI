/** 版本门槛比较：按数字段逐个比，够用即通过；非数字段按 0 处理 */
export function meetsVersion(current: string, required: string): boolean {
    const left = current.split(/[.+-]/).map((part) => Number.parseInt(part, 10))
    const right = required.split(/[.+-]/).map((part) => Number.parseInt(part, 10))
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
        const a = Number.isFinite(left[index]) ? left[index] : 0
        const b = Number.isFinite(right[index]) ? right[index] : 0
        if (a !== b) {
            return a > b
        }
    }
    return true
}
