import { invoke } from '@tauri-apps/api/core'

export interface GameStatus {
    /** 进程是否存活，取不到 pid 时为 null */
    alive: boolean | null
    /** 窗口是否已出现 */
    windowReady: boolean
    /** 判定依据 */
    evidence: string
}

/** 一个要看的日志：只看启动时记下的偏移之后的内容 */
export interface GameLog {
    path: string
    /** 启动时的文件大小 */
    since: number
}

/** 查询游戏进程与窗口状态 */
export async function gameStatus(pid: number | null, logs: GameLog[] | null): Promise<GameStatus> {
    return await invoke<GameStatus>('game_status', { pid, logs })
}

/** 记录日志当前大小，作为本次启动的水位 */
export async function logSizes(paths: string[]): Promise<number[]> {
    return await invoke<number[]>('log_sizes', { paths })
}
