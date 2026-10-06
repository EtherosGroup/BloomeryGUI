import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { CliProcessResult, CliRunRequest, CliTransport } from './bloomery'

/** CLI 定位结果：node + 脚本，或原生可执行文件 */
export interface CliTarget {
    program: string
    /** 拼在命令参数之前的固定参数，如 CLI 入口脚本路径 */
    prefixArgs?: string[]
    cwd?: string
}

interface CliOutcome {
    code: number
    stdout: string
}

interface CliStderrLine {
    id: string
    line: string
}

let callSeq = 0

/** 经 src-tauri 的 cli_run 起进程；stderr 逐行回传 */
export function createTauriTransport(target: CliTarget): CliTransport {
    const prefixArgs = target.prefixArgs ?? []

    return {
        run(request: CliRunRequest): Promise<CliProcessResult> {
            // 允许调用方给出 id，取消时才知道杀哪一个
            const id = request.id ?? `cli-${++callSeq}`
            const stderrLines: string[] = []
            let unlisten: (() => void) | undefined

            let unlistenStdout: (() => void) | undefined

            return (async () => {
                if (request.onStderrLine) {
                    unlisten = await listen<CliStderrLine>('cli://stderr', (event) => {
                        if (event.payload.id !== id) {
                            return
                        }
                        stderrLines.push(event.payload.line)
                        request.onStderrLine?.(event.payload.line)
                    })
                }
                if (request.onStdoutLine) {
                    unlistenStdout = await listen<CliStderrLine>('cli://stdout', (event) => {
                        if (event.payload.id !== id) {
                            return
                        }
                        request.onStdoutLine?.(event.payload.line)
                    })
                }

                try {
                    const outcome = await invoke<CliOutcome>('cli_run', {
                        request: {
                            id,
                            program: target.program,
                            args: [...prefixArgs, ...request.args],
                            cwd: target.cwd ?? null,
                        },
                    })
                    return {
                        code: outcome.code,
                        stdout: outcome.stdout,
                        stderr: stderrLines.join('\n'),
                    }
                } finally {
                    unlisten?.()
                    unlistenStdout?.()
                }
            })()
        },
    }
}

/** 取消一次进行中的调用 */
export async function killCli(id: string): Promise<void> {
    await invoke('cli_kill', { id })
}
