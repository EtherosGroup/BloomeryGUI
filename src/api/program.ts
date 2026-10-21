import { invoke } from '@tauri-apps/api/core'
import { createTauriTransport, killCli } from './transport.tauri'

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

export interface ProgramStreamHooks {
    /** 调用 id，取消时交给 killCli */
    id: string
    /** stdout 与 stderr 逐行回调 */
    onLine?: (line: string) => void
}

/** 跑程序并逐行回传输出；结束返回退出码与完整输出 */
export async function runProgramStream(
    program: string,
    args: string[],
    hooks: ProgramStreamHooks,
): Promise<ProgramOutcome> {
    const transport = createTauriTransport({ program })
    try {
        const result = await transport.run({
            id: hooks.id,
            args,
            onStdoutLine: hooks.onLine,
            onStderrLine: hooks.onLine,
        })
        return { code: result.code, stdout: result.stdout, stderr: result.stderr, spawned: true }
    } catch (error) {
        return { code: null, stdout: '', stderr: String(error), spawned: false }
    }
}

/** 取消 runProgramStream 起的进程 */
export async function killProgram(id: string): Promise<void> {
    await killCli(id)
}

/** 运行平台、架构与下载目录 */
export async function systemFacts(): Promise<SystemFacts> {
    return await invoke<SystemFacts>('system_facts')
}

/** 经系统 curl 下载文件，返回落盘路径 */
export async function downloadFile(url: string, target: string): Promise<string> {
    return await invoke<string>('download_file', { url, target })
}
