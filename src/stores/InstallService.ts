import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { killCli } from '@/api/transport.tauri'
import type { CliGameLoader, CliInstallReport, CliLoaderPage, CliProgressEvent } from '@/api/types'
import { useCli } from '@/composables/useCli'

/** 四家加载器，顺序与 CLI 一致 */
export const LOADER_NAMES = ['fabric', 'forge', 'neoforge', 'quilt'] as const

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

    /** 选定游戏版本上各加载器的规模，来自 view loader --game */
    const availableLoaders = ref<CliGameLoader[]>([])
    const availableWarnings = ref<string[]>([])
    const availableLoading = ref(false)
    /** 还没回的那几家，界面按这个出骨架 */
    const pendingLoaders = ref<string[]>([])
    const loadersFailure = ref<InstallFailure | null>(null)

    /** 已取过的结果：进程内缓存，活到应用重启；刷新走 force */
    const availableCache = ref<Record<string, CliGameLoader[]>>({})
    const warningsCache = ref<Record<string, string[]>>({})
    const pageCache = ref<Record<string, CliLoaderPage>>({})
    /** 换游戏版本时，晚回来的旧请求作废 */
    let loadersSeq = 0

    /** 最近一条进度 */
    const latest = computed(() => events.value[events.value.length - 1] ?? null)
    const running = computed(() => busy.value)

    /** 单家查询：失败交给调用方处理，不写页面级 failure */
    async function fetchLoaderPage(
        loader: string,
        game: string,
        page: number,
        force: boolean,
    ): Promise<CliLoaderPage> {
        const key = `${loader}/${game}/${page}`
        const cached = pageCache.value[key]
        if (!force && cached !== undefined) {
            return cached
        }
        const client = await useCli().client()
        const result = await client.run<CliLoaderPage>(
            ['view', 'loader', loader, '--game', game, '--page', String(page)],
            { progress: false },
        )
        if (!Array.isArray(result.versions)) {
            throw new Error('返回内容不是版本列表')
        }
        pageCache.value = { ...pageCache.value, [key]: result }
        return result
    }

    /**
     * 某个游戏版本上四种加载器各有多少版本
     *
     * 四家并行取：CLI 的 view game 是串行打四家，二十秒起步；各自回来就各自出行
     * 不支持这个游戏版本的那家给 total 0，不列
     */
    async function loadAvailableLoaders(game: string, force = false): Promise<void> {
        const cached = availableCache.value[game]
        if (!force && cached !== undefined) {
            availableLoaders.value = cached
            availableWarnings.value = warningsCache.value[game] ?? []
            return
        }

        const seq = ++loadersSeq
        availableLoading.value = true
        loadersFailure.value = null
        availableLoaders.value = []
        availableWarnings.value = []
        pendingLoaders.value = [...LOADER_NAMES]

        const rows = new Map<string, CliGameLoader>()
        const warnings: string[] = []
        let firstError: unknown = null

        // 固定顺序落位，谁先回都长在该在的位置
        const settle = (): void => {
            if (seq !== loadersSeq) {
                return
            }
            availableLoaders.value = LOADER_NAMES.map((name) => rows.get(name)).filter(
                (row): row is CliGameLoader => row !== undefined,
            )
            availableWarnings.value = [...warnings]
        }

        try {
            await Promise.all(
                LOADER_NAMES.map(async (name) => {
                    try {
                        const page = await fetchLoaderPage(name, game, 1, force)
                        if (page.total > 0) {
                            rows.set(name, {
                                loader: name,
                                latest: page.versions[0]?.version ?? null,
                                total: page.total,
                            })
                        }
                    } catch (error) {
                        firstError ??= error
                        warnings.push(
                            `${name} 取不到：${error instanceof Error ? error.message : String(error)}`,
                        )
                    } finally {
                        if (seq === loadersSeq) {
                            pendingLoaders.value = pendingLoaders.value.filter(
                                (item) => item !== name,
                            )
                            settle()
                        }
                    }
                }),
            )
        } finally {
            if (seq === loadersSeq) {
                availableLoading.value = false
                pendingLoaders.value = []
            }
        }

        if (seq !== loadersSeq) {
            return
        }
        // 四家全挂才算页面级失败，单家失败只记警告
        if (rows.size === 0 && firstError !== null && warnings.length === LOADER_NAMES.length) {
            loadersFailure.value = toFailure(firstError)
        }
        availableCache.value = {
            ...availableCache.value,
            [game]: LOADER_NAMES.map((name) => rows.get(name)).filter(
                (row): row is CliGameLoader => row !== undefined,
            ),
        }
        warningsCache.value = { ...warningsCache.value, [game]: [...warnings] }
    }

    /** 某个加载器在某个游戏版本上可用的版本，每页 20 条 */
    async function queryLoader(
        loader: string,
        game: string,
        page = 1,
        force = false,
    ): Promise<CliLoaderPage | null> {
        const key = `${loader}/${game}/${page}`
        const cached = pageCache.value[key]
        if (!force && cached !== undefined) {
            return cached
        }

        loadersFailure.value = null
        try {
            return await fetchLoaderPage(loader, game, page, force)
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

    /** 刷新：丢掉加载器缓存，重取一份 */
    function dropLoaderCache(): void {
        availableCache.value = {}
        warningsCache.value = {}
        pageCache.value = {}
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
        pendingLoaders,
        loadersFailure,
        latest,
        running,
        loadAvailableLoaders,
        queryLoader,
        dropLoaderCache,
        start,
        cancel,
        close,
    }
})
