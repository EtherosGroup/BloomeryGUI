import { invoke } from '@tauri-apps/api/core'

export interface FileChunk {
    /** 起始偏移 */
    offset: number
    /** 本次读到的内容 */
    text: string
    /** 读取后的文件大小 */
    size: number
    /** 还有更多内容未读 */
    truncated: boolean
}

/** 从 offset 起读文本片段，日志按偏移续读 */
export async function readTextFile(path: string, offset: number): Promise<FileChunk> {
    return await invoke<FileChunk>('read_text_file', { path, offset })
}

/** 建目录，已存在不报错 */
export async function ensureDirectory(path: string): Promise<void> {
    await invoke('ensure_directory', { path })
}
