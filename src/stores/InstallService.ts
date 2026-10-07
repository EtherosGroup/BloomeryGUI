import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { killCli } from '@/api/transport.tauri'
import type {
    CliGameLoader,
    CliGameLoaderPage,
    CliInstallReport,
    CliLoaderPage,
    CliProgressEvent,
} from '@/api/types'
import { useCli } from '@/composables/useCli'

export interface InstallFailure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封，可重试才有意义 */
    retryable: boolean
}

/** 一次安装要装什么 */
export interface InstallTarget {
    game: string
    /** null 表示不装加载器 */
    loader: string | null
    /** null 表示由 CLI 取最新 */
    loaderVersion: string | null
    /** 显示名，留空由 CLI 推导 */
    name: string
}

function toFailure(error: unknown): InstallFailure {
    return error instanceof BloomeryError
        ? {
              code: error.code,
              message: error.message,
              detail: error.detail,
              retryable: error.retryable,
          }
        : { code: 'Unknown', message: String(error), detail: null, retryable: false }
}

/** 安装新版本：加载器查询、进度事件、取消与结果 */
export const useInstallService = defineStore('InstallService', () => {
    const busy = ref(false)
    /** 进行中的调用 id，用于 killCli */
    const callId = ref('')
    const events = ref<CliProgressEvent[]>([])
    const failure = ref<InstallFailure | null>(null)
    const report = ref<CliInstallReport | null>(null)
    const cancelled = ref(false)
    const target = ref<InstallTarget | null>(null)

    /** 选定游戏版本上各加载器的规模，来自 view game */
    const availableLoaders = ref<CliGameLoader[]>([])
    const availableWarnings = ref<string[]>([])
    const availableLoading = ref(false)
    const loadersFailure = ref<InstallFailure | null>(null)

    /** 最近一条进度 */
    const latest = computed(() => events.value[events.value.length - 1] ?? null)
    const running = computed(() => busy.value)

    /** 某个游戏版本上四种加载器各有多少版本，没有的给 0 */
    async function loadAvailableLoaders(game: string): Promise<void> {
        availableLoading.value = true
        loadersFailure.value = null
        try {
            const client = await useCli().client()
            const result = await client.run<CliGameLoaderPage>(['view', 'game', game], {
                progress: false,
            })
            availableLoaders.value = Array.isArray(result.loaders) ? result.loaders : []
            availableWarnings.value = Array.isArray(result.warnings) ? result.warnings : []
        } catch (error) {
            availableLoaders.value = []
            availableWarnings.value = []
            loadersFailure.value = toFailure(error)
        } finally {
            availableLoading.value = false
        }
    }

    /** 某个加载器在某个游戏版本上可用的版本，每页 20 条 */
    async function queryLoader(
        loader: string,
        game: string,
        page = 1,
    ): Promise<CliLoaderPage | null> {
        loadersFailure.value = null
        try {
            const client = await useCli().client()
            const result = await client.run<CliLoaderPage>(
                ['view', 'loader', loader, '--game', game, '--page', String(page)],
                { progress: false },
            )
            return Array.isArray(result.versions) ? result : null
        } catch (error) {
            loadersFailure.value = toFailure(error)
            return null
        }
    }

    /** 装：全程 ndjson 进度，同一时刻只跑一个 */
    async function start(next: InstallTarget, folderId: string): Promise<boolean> {
        if (busy.value) {
            return false
        }
        target.value = next
        busy.value = true
        cancelled.value = false
        failure.value = null
        report.value = null
        events.value = []

        const id = `install-${next.game}-${Date.now()}`
        callId.value = id
        try {
            const client = await useCli().client()
            const args = ['install', next.game]
            if (folderId.length > 0) {
                args.push('--folder', folderId)
            }
            if (next.loader !== null) {
                const spec =
                    next.loaderVersion === null
                        ? next.loader
                        : `${next.loader}@${next.loaderVersion}`
                args.push('--loader', spec)
            }
            if (next.name.trim().length > 0) {
                args.push('--name', next.name.trim())
            }
            const result = await client.run<CliInstallReport>(args, {
                id,
                onProgress: (event) => {
                    events.value = [...events.value, event].slice(-200)
                },
            })
            report.value = result
            return true
        } catch (error) {
            if (!cancelled.value) {
                failure.value = toFailure(error)
            }
            return false
        } finally {
            busy.value = false
            callId.value = ''
        }
    }

    /** 取消：杀掉正在跑的 CLI */
    async function cancel(): Promise<void> {
        const id = callId.value
        if (id.length === 0) {
            return
        }
        cancelled.value = true
        await killCli(id).catch(() => undefined)
    }

    function close(): void {
        busy.value = false
        events.value = []
        failure.value = null
        report.value = null
        cancelled.value = false
        target.value = null
    }

    return {
        busy,
        callId,
        events,
        failure,
        report,
        cancelled,
        target,
        availableLoaders,
        availableWarnings,
        availableLoading,
        loadersFailure,
        latest,
        running,
        loadAvailableLoaders,
        queryLoader,
        start,
        cancel,
        close,
    }
})
