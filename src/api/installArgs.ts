/** 一次安装要装什么 */
export interface InstallTarget {
    game: string
    /** null 表示不装加载器 */
    loader: string | null
    /** null 表示由 CLI 取最新 */
    loaderVersion: string | null
    /** 显示名，留空由 CLI 推导 */
    name: string
}

/** install 命令的参数；全局旗标由 client 拼在命令名之前 */
export function installArgs(target: InstallTarget, folderId: string): string[] {
    const args = ['install', target.game]
    if (folderId.length > 0) {
        args.push('--folder', folderId)
    }
    if (target.loader !== null) {
        const spec =
            target.loaderVersion === null
                ? target.loader
                : `${target.loader}@${target.loaderVersion}`
        args.push('--loader', spec)
    }
    const name = target.name.trim()
    if (name.length > 0) {
        args.push('--name', name)
    }
    return args
}
