import type { CliTarget } from './transport.tauri'

/** Windows 上的批处理包装需要过一层 cmd */
const SHELL_SUFFIX = /\.(cmd|bat)$/i
const SCRIPT_SUFFIX = /\.(js|mjs|cjs)$/i

/** 手填路径优先，其次环境里的 bloomery */
export function resolveCliTarget(cliPath: string): CliTarget {
    const path = cliPath.trim()

    if (path.length === 0) {
        return { program: 'bloomery' }
    }
    if (SCRIPT_SUFFIX.test(path)) {
        return { program: 'node', prefixArgs: [path] }
    }
    if (SHELL_SUFFIX.test(path)) {
        return { program: 'cmd', prefixArgs: ['/C', path] }
    }
    return { program: path }
}
