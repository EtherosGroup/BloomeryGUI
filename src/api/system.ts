import { invoke } from '@tauri-apps/api/core'

/** 用系统默认程序打开路径，走 Rust 侧 opener 插件 API */
export async function openPath(path: string): Promise<void> {
    await invoke('open_path', { path })
}
