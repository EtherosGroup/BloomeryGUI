import { BloomeryClient } from './bloomery'
import { resolveCliTarget } from './target'
import { createTauriTransport } from './transport.tauri'

export interface CliClientOptions {
    /** 手填 CLI 路径，空串走默认解析 */
    cliPath: string
    /** CLI 数据目录，固定传给 --home */
    home: string
}

/** 按环境设置建客户端 */
export function createCliClient(options: CliClientOptions): BloomeryClient {
    return new BloomeryClient({
        transport: createTauriTransport(resolveCliTarget(options.cliPath)),
        home: options.home,
    })
}
