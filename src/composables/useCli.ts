import { createCliClient } from '@/api/client'
import type { BloomeryClient } from '@/api/bloomery'
import { useEnvironmentService } from '@/stores/EnvironmentService'

/** CLI 客户端构造：数据目录留空时用 CLI 默认目录，与命令行共用同一份状态 */
export function useCli() {
    const environment = useEnvironmentService()

    async function client(): Promise<BloomeryClient> {
        return createCliClient({ cliPath: environment.cliPath, home: environment.home })
    }

    return { environment, client }
}
