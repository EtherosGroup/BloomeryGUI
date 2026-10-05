import { convertFileSrc, invoke } from '@tauri-apps/api/core'

/** 背景图落在应用数据目录下的路径 */
export async function saveBackground(bytes: Uint8Array, extension: string): Promise<string> {
    return await invoke<string>('save_background', { bytes: Array.from(bytes), extension })
}

export async function removeBackground(): Promise<void> {
    await invoke('remove_background')
}

/** 现有背景图路径，没有则为 null */
export async function currentBackground(): Promise<string | null> {
    return await invoke<string | null>('background_path')
}

/** 转成 webview 可加载的资源地址，需要 security.assetProtocol 放行 */
export function backgroundUrl(path: string): string {
    return convertFileSrc(path)
}
