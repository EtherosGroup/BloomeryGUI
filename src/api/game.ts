import { invoke } from '@tauri-apps/api/core'

export interface GameStatus {
    /** 进程是否存活，取不到 pid 时为 null */
    alive: boolean | null
    /** 窗口是否已出现 */
    windowReady: boolean
    /** 判定依据 */
    evidence: string
}

/** 查询游戏进程与窗口状态 */
export async function gameStatus(pid: number | null, log: string | null): Promise<GameStatus> {
    return await invoke<GameStatus>('game_status', { pid, log })
}
