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
/** focus：窗口首次出现时把游戏带到前台（每次启动只该传一次 true） */
export async function gameStatus(
    pid: number | null,
    logs: string[] | null,
    focus = false,
): Promise<GameStatus> {
    return await invoke<GameStatus>('game_status', { pid, logs, focus })
}
