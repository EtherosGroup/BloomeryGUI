import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { pathStamps } from '@/api/files'
import type { CliFolder, CliVersionList } from '@/api/types'
import { useCli } from '@/composables/useCli'

export interface VersionFailure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封，可重试才有意义 */
    retryable: boolean
}

/** folder add 的返回：只有 id / path / versionCount，没有列表行那些字段 */
export interface AddedFolder {
    id: string
    path: string
    versionCount: number
}

function toFailure(error: unknown): VersionFailure {
    return error instanceof BloomeryError
        ? {
              code: error.code,
              message: error.message,
              detail: error.detail,
              retryable: error.retryable,
          }
        : { code: 'Unknown', message: String(error), detail: null, retryable: false }
}

/** 多文件夹的实例列表：按文件夹分别加载，当前文件夹保持原有语义 */
export const useVersionService = defineStore('VersionService', () => {
    /** 已登记的文件夹，来自 folder list */
    const folders = ref<CliFolder[]>([])
    /** 是否成功取过一次：首屏据此决定出骨架还是出内容 */
    const loaded = ref(false)
    /** 各文件夹 versions 目录的指纹，用来判断要不要重取 */
    const stamps = ref<Record<string, string>>({})
    const foldersLoading = ref(false)
    const foldersFailure = ref<VersionFailure | null>(null)

    /** 各文件夹的实例列表；null 表示读取失败，缺键表示尚未加载 */
    const lists = ref<Record<string, CliVersionList | null>>({})
    const loadingIds = ref<string[]>([])
    const failures = ref<Record<string, VersionFailure | null>>({})

    /** 正在选中的实例 id */
    const switching = ref<string | null>(null)
    /** 正在启动的实例 id */
    const launching = ref<string | null>(null)
    /** 已启动的实例：进程号与日志路径 */
    const running = ref<Record<string, { pid: number | null; log: string | null }>>({})

    const currentFolderId = computed(() => folders.value.find((item) => item.selected)?.id ?? '')

    function listOf(folderId: string): CliVersionList | null {
        return lists.value[folderId] ?? null
    }

    function instancesOf(folderId: string): CliVersionList['instances'] {
        const list = listOf(folderId)
        return list !== null && Array.isArray(list.instances) ? list.instances : []
    }

    function loadingFolder(folderId: string): boolean {
        return loadingIds.value.includes(folderId)
    }

    function failureOf(folderId: string): VersionFailure | null {
        return failures.value[folderId] ?? null
    }

    /** 当前文件夹的实例，首页等旧调用沿用 */
    const list = computed(() => listOf(currentFolderId.value))
    const instances = computed(() => instancesOf(currentFolderId.value))
    const selectedInstance = computed(() => listOf(currentFolderId.value)?.selectedInstance ?? null)

    const loading = computed(() => foldersLoading.value || loadingFolder(currentFolderId.value))
    const failure = computed(() => failureOf(currentFolderId.value))

    /** 列文件夹 */
    async function loadFolders(): Promise<void> {
        foldersLoading.value = true
        foldersFailure.value = null
        try {
            const client = await useCli().client()
            const rows = await client.run<unknown>(['folder', 'list'], { progress: false })
            folders.value = Array.isArray(rows) ? (rows as CliFolder[]) : []
        } catch (error) {
            folders.value = []
            foldersFailure.value = toFailure(error)
        } finally {
            foldersLoading.value = false
        }
    }

    /** 读某个文件夹的实例，按需调用 */
    async function loadList(folderId: string): Promise<void> {
        if (folderId.length === 0 || loadingFolder(folderId)) {
            return
        }
        loadingIds.value = [...loadingIds.value, folderId]
        failures.value = { ...failures.value, [folderId]: null }
        try {
            const client = await useCli().client()
            const result = await client.run<unknown>(['version', 'list', '--folder', folderId], {
                progress: false,
            })
            if (
                typeof result === 'object' &&
                result !== null &&
                Array.isArray((result as CliVersionList).instances)
            ) {
                lists.value = { ...lists.value, [folderId]: result as CliVersionList }
            } else {
                lists.value = { ...lists.value, [folderId]: null }
                failures.value = {
                    ...failures.value,
                    [folderId]: {
                        code: 'InvalidShape',
                        message: '返回内容不是实例列表',
                        detail: null,
                        retryable: false,
                    },
                }
            }
        } catch (error) {
            lists.value = { ...lists.value, [folderId]: null }
            failures.value = { ...failures.value, [folderId]: toFailure(error) }
        } finally {
            loadingIds.value = loadingIds.value.filter((item) => item !== folderId)
        }
    }

    /** 首屏：文件夹列表加当前文件夹的实例 */
    async function load(): Promise<void> {
        await loadFolders()
        const folderId = currentFolderId.value
        if (folderId.length > 0) {
            await loadList(folderId)
        }
    }

    /** 全部刷新：已加载过的文件夹都重拉 */
    async function reloadAll(): Promise<void> {
        await loadFolders()
        const known = Object.keys(lists.value)
        for (const folderId of known) {
            await loadList(folderId)
        }
        const folderId = currentFolderId.value
        if (folderId.length > 0 && !known.includes(folderId)) {
            await loadList(folderId)
        }
        const next = await readStamps()
        if (next !== null) {
            stamps.value = next
        }
    }

    /** 某文件夹的 versions 目录：优先用 CLI 给的那条 */
    function versionsPathOf(folderId: string): string {
        const list = lists.value[folderId]
        if (list !== undefined && list !== null && typeof list.versionsDirectory === 'string') {
            return list.versionsDirectory
        }
        const folder = folders.value.find((item) => item.id === folderId)
        if (folder === undefined) {
            return ''
        }
        const separator = folder.path.includes('\\') ? '\\' : '/'
        return `${folder.path.replace(/[\\/]+$/, '')}${separator}versions`
    }

    /** 取各文件夹 versions 目录的指纹；取不到返回 null */
    async function readStamps(): Promise<Record<string, string> | null> {
        const targets = folders.value
            .map((folder) => ({ id: folder.id, path: versionsPathOf(folder.id) }))
            .filter((item) => item.path.length > 0)
        if (targets.length === 0) {
            return {}
        }
        const rows = await pathStamps(targets.map((item) => item.path)).catch(() => null)
        if (rows === null) {
            return null
        }
        const next: Record<string, string> = {}
        for (const [index, item] of targets.entries()) {
            const stamp = rows[index]
            next[item.id] =
                stamp === undefined ? '' : `${item.path}|${stamp.mtime}|${stamp.entries}`
        }
        return next
    }

    /**
     * 首屏：没取过就取，取过就只补有变动的文件夹
     *
     * 指纹变了才重取，避免每次进页面都把列表重画一遍
     */
    async function ensureFresh(): Promise<void> {
        if (!loaded.value) {
            await load()
            loaded.value = foldersFailure.value === null
            const first = await readStamps()
            if (first !== null) {
                stamps.value = first
            }
            return
        }

        const next = await readStamps()
        if (next === null) {
            return
        }
        const changed = Object.keys(next).filter((id) => next[id] !== stamps.value[id])
        stamps.value = next
        if (changed.length === 0) {
            return
        }
        for (const folderId of changed) {
            await loadList(folderId)
        }
        // 实例数在 folder list 里，变动后一并重取
        await loadFolders()
    }

    /** 选中实例：带上所属文件夹，切完重拉该文件夹 */
    async function select(instanceId: string, folderId?: string): Promise<void> {
        const scope = folderId ?? currentFolderId.value
        if (switching.value !== null) {
            return
        }
        switching.value = instanceId
        failures.value = { ...failures.value, [scope]: null }
        try {
            const client = await useCli().client()
            const args = ['version', 'select', instanceId]
            if (scope.length > 0) {
                args.push('--folder', scope)
            }
            await client.run(args, { progress: false })
            await loadList(scope)
        } catch (error) {
            failures.value = { ...failures.value, [scope]: toFailure(error) }
        } finally {
            switching.value = null
        }
    }

    /** 切换当前文件夹 */
    async function setCurrentFolder(folderId: string): Promise<void> {
        foldersFailure.value = null
        try {
            const client = await useCli().client()
            await client.run(['folder', 'select', folderId], { progress: false })
            await loadFolders()
            await loadList(folderId)
        } catch (error) {
            foldersFailure.value = toFailure(error)
        }
    }

    /** 添加游戏文件夹：只写 setting.json，加完重列 */
    async function addFolder(path: string): Promise<AddedFolder | null> {
        const target = path.trim()
        if (target.length === 0 || foldersLoading.value) {
            return null
        }
        foldersLoading.value = true
        foldersFailure.value = null
        try {
            const client = await useCli().client()
            const folder = await client.run<AddedFolder>(['folder', 'add', target], {
                progress: false,
            })
            await loadFolders()
            return folder
        } catch (error) {
            foldersFailure.value = toFailure(error)
            return null
        } finally {
            foldersLoading.value = false
        }
    }

    /** 启动实例：GUI 一律 --detach，不等游戏退出 */
    async function launch(
        instanceId: string,
        folderId?: string,
    ): Promise<{ pid: number | null; log: string | null } | null> {
        if (launching.value !== null) {
            return null
        }
        const scope = folderId ?? currentFolderId.value
        launching.value = instanceId
        try {
            const client = await useCli().client()
            const args = ['launch', instanceId, '--detach']
            if (scope.length > 0) {
                args.push('--folder', scope)
            }
            const result = await client.run<{ pid?: number | null; log?: string | null }>(args, {
                progress: false,
            })
            const record = { pid: result.pid ?? null, log: result.log ?? null }
            running.value = { ...running.value, [instanceId]: record }
            return record
        } catch (error) {
            failures.value = { ...failures.value, [scope]: toFailure(error) }
            return null
        } finally {
            launching.value = null
        }
    }

    return {
        folders,
        foldersLoading,
        foldersFailure,
        lists,
        loadingIds,
        failures,
        switching,
        launching,
        running,
        currentFolderId,
        list,
        instances,
        selectedInstance,
        loading,
        failure,
        loadingFolder,
        failureOf,
        instancesOf,
        listOf,
        loadFolders,
        loadList,
        loaded,
        load,
        reloadAll,
        ensureFresh,
        select,
        setCurrentFolder,
        addFolder,
        launch,
    }
})
