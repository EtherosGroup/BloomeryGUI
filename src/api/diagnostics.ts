import { invoke } from '@tauri-apps/api/core'

export interface DiagInfo {
    path: string
    size: number
}

/** 追加诊断行；失败静默，不能因为写日志影响主流程 */
export async function appendDiag(lines: string[]): Promise<void> {
    try {
        await invoke<DiagInfo>('append_diag', { lines })
    } catch {
        // 诊断写入失败不影响使用
    }
}

/** 诊断文件路径与大小 */
export async function diagInfo(): Promise<DiagInfo> {
    return await invoke<DiagInfo>('diag_info')
}
