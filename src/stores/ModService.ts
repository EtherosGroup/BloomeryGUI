import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { killCli } from '@/api/transport.tauri'
import {
    MOD_API_REQUIRED,
    type CliModFile,
    type CliModInstallResult,
    type CliModList,
    type CliModMutation,
    type CliModSearch,
    type CliProgressEvent,
} from '@/api/types'
import {
    installArgs,
    listArgs,
    mutateArgs,
    searchArgs,
    type ModAction,
    type ModScope,
} from '@/api/modArgs'
import { useCli } from '@/composables/useCli'

/**
 * 带业务结果的非零退出
 *
 * mod install 有 failed[]、mod remove 一类有 skipped[] 时退出码为 1，stdout 仍是结果对象
 */
const PARTIAL_EXIT = [1]

export interface ModFailure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封，可重试才有意义 */
    retryable: boolean
}

function toFailure(error: unknown): ModFailure {
    return error instanceof BloomeryError
        ? {
              code: error.code,
              message: error.message,
              detail: error.detail,
              retryable: error.retryable,
          }
        : { code: 'Unknown', message: String(error), detail: null, retryable: false }
}

function scopeKey(scope: ModScope): string {
    return `${scope.folderId}|${scope.instanceId}`
}

export type { ModAction, ModScope } from '@/api/modArgs'

/** MOD 检索、已装列表、安装与删除禁用启用 */
export const useModService = defineStore('ModService', () => {
    /** 引擎 api 版本；null 表示还没探过 */
    const apiVersion = ref<number | null>(null)
    const apiChecked = ref(false)
    /** 低于要求的 api 时这些命令都不存在 */
    const supported = computed(
        () => apiVersion.value !== null && apiVersion.value >= MOD_API_REQUIRED,
    )

    /* ---------- 检索 ---------- */

    const hits = ref<CliModSearch['hits']>([])
    const searching = ref(false)
    const searchFailure = ref<ModFailure | null>(null)
    /** 已出过结果：首屏据此决定出骨架还是内容 */
    const searched = ref(false)
    /** 结果对应的实例，换实例后旧结果不参与展示 */
    const searchScope = ref<ModScope | null>(null)

    /** 进程内缓存，活到应用重启；同词同实例不重复打网络 */
    const searchCache = ref<Record<string, CliModSearch>>({})
    let searchSeq = 0

    /* ---------- 已装列表 ---------- */

    const files = ref<CliModFile[]>([])
    const modsPath = ref('')
    /** 本地扫描阶段，快 */
    const listLoading = ref(false)
    /** 反查阶段，慢；两段式渲染的第二段 */
    const listResolving = ref(false)
    const listFailure = ref<ModFailure | null>(null)
    /** 反查进度，来自 key 为 mod 的 ndjson 事件 */
    const resolveProgress = ref<{ done: number; total: number } | null>(null)
    const listScope = ref<ModScope | null>(null)

    const listCache = ref<Record<string, { mods: string; files: CliModFile[] }>>({})
    let listSeq = 0

    /* ---------- 安装 ---------- */

    const installBusy = ref(false)
    const installCancelled = ref(false)
    const installEvents = ref<CliProgressEvent[]>([])
    const installReport = ref<CliModInstallResult | null>(null)
    const installFailure = ref<ModFailure | null>(null)

    /* ---------- 删除 / 禁用 / 启用 ---------- */

    const mutating = ref(false)
    const mutationReport = ref<CliModMutation | null>(null)
    const mutationFailure = ref<ModFailure | null>(null)

    /** 进行中的调用 id，用于 killCli */
    const callId = ref('')

    const enabledCount = computed(() => files.value.filter((row) => row.enabled).length)

    /* ---------- api 门禁 ---------- */

    /**
     * 探一次引擎版本
     *
     * mod 相关命令要 api 2 起，低于它就只提示升级，不发命令
     */
    async function checkApi(force = false): Promise<boolean> {
        if (apiChecked.value && !force) {
            return supported.value
        }
        try {
            const info = await (await useCli().client()).probe()
            apiVersion.value = typeof info.api === 'number' ? info.api : null
        } catch {
            apiVersion.value = null
        } finally {
            apiChecked.value = true
        }
        return supported.value
    }

    /* ---------- 检索 ---------- */

    /**
     * 在实例上下文里检索
     *
     * 带上 --version 与 --folder，CLI 自己解析出游戏版本与加载器做分面过滤
     */
    async function search(scope: ModScope, query: string, limit = 20, force = false) {
        const text = query.trim()
        if (!supported.value || text.length === 0 || scope.instanceId.length === 0) {
            return
        }
        const key = `${scopeKey(scope)}|${text}|${limit}`
        const cached = searchCache.value[key]
        if (!force && cached !== undefined) {
            hits.value = cached.hits
            searchScope.value = scope
            searched.value = true
            searchFailure.value = null
            return
        }

        const seq = ++searchSeq
        searching.value = true
        searchFailure.value = null
        try {
            const client = await useCli().client()
            const result = await client.run<CliModSearch>(searchArgs(scope, text, limit), {
                progress: false,
            })
            if (seq !== searchSeq) {
                return
            }
            // 形状兜底：hits 缺失视为契约变化
            hits.value = Array.isArray(result.hits) ? result.hits : []
            searchScope.value = scope
            searched.value = true
            searchCache.value = { ...searchCache.value, [key]: result }
        } catch (error) {
            if (seq !== searchSeq) {
                return
            }
            hits.value = []
            searched.value = true
            searchFailure.value = toFailure(error)
        } finally {
            if (seq === searchSeq) {
                searching.value = false
            }
        }
    }

    /* ---------- 已装列表 ---------- */

    /**
     * 读已装 MOD
     *
     * 两段式：先 --offline 拿本地扫描结果把列表铺出来，再联网反查 sha1 补项目名
     * 反查失败只走 resolved=false 的降级，不影响本地那份
     */
    async function loadList(scope: ModScope, options: { force?: boolean } = {}): Promise<void> {
        if (!supported.value || scope.instanceId.length === 0) {
            return
        }
        const key = scopeKey(scope)
        const cached = listCache.value[key]
        if (!options.force && cached !== undefined) {
            modsPath.value = cached.mods
            files.value = cached.files
            listScope.value = scope
            listFailure.value = null
            return
        }

        const seq = ++listSeq
        listScope.value = scope
        listFailure.value = null
        listLoading.value = true
        listResolving.value = false
        resolveProgress.value = null

        const args = listArgs(scope)
        const client = await useCli()
            .client()
            .catch((error: unknown) => {
                listFailure.value = toFailure(error)
                listLoading.value = false
                return null
            })
        if (client === null) {
            return
        }

        try {
            const offline = await client.run<CliModList>(listArgs(scope, true), {
                progress: false,
            })
            if (seq !== listSeq) {
                return
            }
            const rows = Array.isArray(offline.files) ? offline.files : []
            modsPath.value = offline.mods
            files.value = rows
            listCache.value = { ...listCache.value, [key]: { mods: offline.mods, files: rows } }
        } catch (error) {
            if (seq === listSeq) {
                files.value = []
                modsPath.value = ''
                listFailure.value = toFailure(error)
            }
            return
        } finally {
            if (seq === listSeq) {
                listLoading.value = false
            }
        }

        // 第二段：反查慢，回来就替换；失败保留第一段结果
        listResolving.value = true
        try {
            const resolved = await client.run<CliModList>(args, {
                progress: true,
                onProgress: (event) => {
                    if (seq === listSeq && event.key === 'mod') {
                        resolveProgress.value = { done: event.done, total: event.total }
                    }
                },
            })
            if (seq !== listSeq) {
                return
            }
            const rows = Array.isArray(resolved.files) ? resolved.files : []
            modsPath.value = resolved.mods
            files.value = rows
            listCache.value = { ...listCache.value, [key]: { mods: resolved.mods, files: rows } }
        } catch {
            // 反查整条挂掉时第一段结果仍然可用，不覆盖 failure
        } finally {
            if (seq === listSeq) {
                listResolving.value = false
                resolveProgress.value = null
            }
        }
    }

    /** 写操作之后重取：只有这个实例取过才重取，没取过就不惊动网络 */
    async function refreshAfterWrite(scope: ModScope): Promise<void> {
        if (listCache.value[scopeKey(scope)] === undefined) {
            return
        }
        await loadList(scope, { force: true })
    }

    /* ---------- 安装 ---------- */

    /**
     * 装 MOD
     *
     * targets 是 slug 或项目 id，取自检索结果
     * 单条失败不抛错，落在 failed[] 里
     */
    async function install(
        scope: ModScope,
        targets: string[],
        options: { deps?: boolean } = {},
    ): Promise<boolean> {
        const wanted = targets.map((item) => item.trim()).filter((item) => item.length > 0)
        if (installBusy.value || wanted.length === 0 || !supported.value) {
            return false
        }
        installBusy.value = true
        installCancelled.value = false
        installFailure.value = null
        installReport.value = null
        installEvents.value = []

        const id = `mod-install-${scope.instanceId}-${Date.now()}`
        callId.value = id
        try {
            const client = await useCli().client()
            const args = installArgs(scope, wanted, options.deps === true)
            const result = await client.run<CliModInstallResult>(args, {
                id,
                acceptExit: PARTIAL_EXIT,
                onProgress: (event) => {
                    installEvents.value = [...installEvents.value, event].slice(-200)
                },
            })
            installReport.value = result
            await refreshAfterWrite(scope)
            return true
        } catch (error) {
            if (!installCancelled.value) {
                installFailure.value = toFailure(error)
            }
            return false
        } finally {
            installBusy.value = false
            callId.value = ''
        }
    }

    /* ---------- 删除 / 禁用 / 启用 ---------- */

    /**
     * 管理已装文件
     *
     * 目标取 mod list 给的 filename；有 skipped 时退出码 1，stdout 仍是结果对象
     */
    async function mutate(action: ModAction, scope: ModScope, targets: string[]): Promise<boolean> {
        const wanted = targets.map((item) => item.trim()).filter((item) => item.length > 0)
        if (mutating.value || wanted.length === 0 || !supported.value) {
            return false
        }
        mutating.value = true
        mutationFailure.value = null
        mutationReport.value = null

        const id = `mod-${action}-${scope.instanceId}-${Date.now()}`
        callId.value = id
        try {
            const client = await useCli().client()
            const result = await client.run<CliModMutation>(mutateArgs(action, scope, wanted), {
                id,
                acceptExit: PARTIAL_EXIT,
                progress: false,
            })
            mutationReport.value = result
            await refreshAfterWrite(scope)
            return true
        } catch (error) {
            if (!installCancelled.value) {
                mutationFailure.value = toFailure(error)
            }
            return false
        } finally {
            mutating.value = false
            callId.value = ''
        }
    }

    /** 取消：杀掉正在跑的 CLI */
    async function cancel(): Promise<void> {
        const id = callId.value
        if (id.length === 0) {
            return
        }
        installCancelled.value = true
        await killCli(id).catch(() => undefined)
    }

    function close(): void {
        installEvents.value = []
        installReport.value = null
        installFailure.value = null
        mutationReport.value = null
        mutationFailure.value = null
        installCancelled.value = false
    }

    return {
        apiVersion,
        apiChecked,
        supported,
        hits,
        searching,
        searchFailure,
        searched,
        searchScope,
        files,
        modsPath,
        listLoading,
        listResolving,
        listFailure,
        resolveProgress,
        listScope,
        installBusy,
        installEvents,
        installReport,
        installFailure,
        installCancelled,
        mutating,
        mutationReport,
        mutationFailure,
        callId,
        enabledCount,
        checkApi,
        search,
        loadList,
        install,
        mutate,
        cancel,
        close,
    }
})
