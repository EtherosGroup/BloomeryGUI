import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { killCli } from '@/api/transport.tauri'
import type { CliGameLoader, CliInstallReport, CliLoaderPage, CliProgressEvent } from '@/api/types'
import { installArgs, type InstallTarget } from '@/api/installArgs'
import { useDownloadService } from '@/stores/DownloadService'
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

export type { InstallTarget } from '@/api/installArgs'

/** 进行中安装的落点：转后台后换成写下载任务 */
interface ActiveInstall {
    id: string
    target: InstallTarget
    folderId: string
    startedAt: number
    emit: (event: CliProgressEvent) => void
    finish: (report: CliInstallReport) => void
    abort: (failure: InstallFailure) => void
    /** 这次调用被取消 */
    aborted: () => void
}

/** 安装新版本：加载器查询、进度事件、取消与结果 */
export const useInstallService = defineStore('InstallService', () => {
    const busy = ref(false)
    /** 进行中的调用 id，用于 killCli */
    const callId = ref('')
    /** 进行中的安装；转后台后事件与结果改写到下载任务 */
    let active: ActiveInstall | null = null
    /** 这次安装是否已转后台：转了之后本页不再显示进度 */
    const detached = ref(false)
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
        detached.value = false

        const id = `install-${next.game}-${Date.now()}`
        callId.value = id
        const running: ActiveInstall = {
            id,
            target: next,
            folderId,
            startedAt: Date.now(),
            emit: (event) => {
                events.value = [...events.value, event].slice(-200)
            },
            finish: (result) => {
                report.value = result
            },
            abort: (error) => {
                failure.value = error
            },
            aborted: () => undefined,
        }
        active = running
        try {
            const client = await useCli().client()
            const result = await client.run<CliInstallReport>(installArgs(next, folderId), {
                id,
                onProgress: (event) => running.emit(event),
            })
            running.finish(result)
            return true
        } catch (error) {
            if (cancelled.value) {
                running.aborted()
            } else {
                running.abort(toFailure(error))
            }
            return false
        } finally {
            busy.value = false
            callId.value = ''
            if (active === running) {
                active = null
            }
        }
    }

    /** 转后台：同一次调用，进度与结果改写到下载任务上，本页不再显示 */
    function detach(): string | null {
        const running = active
        if (running === null || detached.value) {
            return null
        }
        const adopted = useDownloadService().adopt({
            id: running.id,
            target: running.target,
            folderId: running.folderId,
            events: events.value,
            startedAt: running.startedAt,
        })
        if (adopted === null) {
            return null
        }
        running.emit = adopted.emit
        running.finish = adopted.finish
        running.abort = adopted.abort
        running.aborted = adopted.aborted
        detached.value = true
        events.value = []
        return running.id
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
        detached.value = false
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
        detached,
        target,
        availableLoaders,
        availableWarnings,
        availableLoading,
        pendingLoaders,
        loadersFailure,
        running,
        loadAvailableLoaders,
        queryLoader,
        dropLoaderCache,
        start,
        detach,
        cancel,
        close,
    }
})
