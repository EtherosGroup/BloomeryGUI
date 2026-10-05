import { invoke } from '@tauri-apps/api/core'

export interface ProgramOutcome {
    code: number | null
    stdout: string
    stderr: string
    /** 程序是否真的起来了；找不到程序时为 false */
    spawned: boolean
}

export interface SystemFacts {
    platform: string
    arch: string
    downloads: string
}

/** 跑任意程序并取回输出 */
export async function runProgram(program: string, args: string[] = []): Promise<ProgramOutcome> {
    return await invoke<ProgramOutcome>('run_program', { program, args })
}

/** 运行平台、架构与下载目录 */
export async function systemFacts(): Promise<SystemFacts> {
    return await invoke<SystemFacts>('system_facts')
}

/** 经系统 curl 下载文件，返回落盘路径 */
export async function downloadFile(url: string, target: string): Promise<string> {
    return await invoke<string>('download_file', { url, target })
}
