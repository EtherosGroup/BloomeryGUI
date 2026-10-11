import { computed, ref } from 'vue'
import type { CliInstance } from '@/api/types'
import type { ModScope } from '@/stores/ModService'
import { useVersionService } from '@/stores/VersionService'
import type { ChoiceOptionType } from '@/types/ChoiceOptionType'
import { gameVersionLabel, loaderLabel } from '@/utils/versionLabel'

/**
 * 实例的加载器名，原版给 null
 *
 * CLI 对原版实例给 loader.type 为 vanilla，装 MOD 按没有加载器处理
 */
export function loaderOf(instance: CliInstance): string | null {
    const type = instance.loader?.type
    return type === undefined || type === 'vanilla' ? null : type
}

/**
 * MOD 两个页面共用的实例选择
 *
 * 默认落在当前文件夹与当前选中实例上；--version 与 --folder 一起交给 CLI
 */
export function useModTarget() {
    const versionService = useVersionService()
    const folderId = ref('')
    const instanceId = ref('')

    const folderOptions = computed<ChoiceOptionType[]>(() =>
        versionService.folders.map((folder) => ({
            value: folder.id,
            label: `${folder.name}（${folder.instanceCount} 个实例）`,
        })),
    )

    const instances = computed<CliInstance[]>(() =>
        folderId.value.length > 0 ? versionService.instancesOf(folderId.value) : [],
    )

    const instanceOptions = computed<ChoiceOptionType[]>(() =>
        instances.value.map((row) => ({
            value: row.id,
            label: `${row.name} · ${gameVersionLabel(row.gameVersion)} · ${loaderLabel(row)}`,
        })),
    )

    const instance = computed<CliInstance | null>(
        () => instances.value.find((row) => row.id === instanceId.value) ?? null,
    )

    /** 原版实例为 null */
    const scope = computed<ModScope | null>(() => {
        const current = instance.value
        if (current === null || folderId.value.length === 0) {
            return null
        }
        return {
            folderId: folderId.value,
            instanceId: current.id,
            gameVersion: current.gameVersion,
            loader: loaderOf(current),
        }
    })

    /** 装 MOD 只对加载器实例有效，原版实例仍可看已装列表 */
    const installable = computed(() => instance.value !== null && loaderOf(instance.value) !== null)

    const instanceFailure = computed(() =>
        folderId.value.length > 0 ? versionService.failureOf(folderId.value) : null,
    )
    const instancesLoading = computed(
        () => folderId.value.length > 0 && versionService.loadingFolder(folderId.value),
    )

    /** 文件夹内优先取选中实例，其次可用的第一个 */
    function defaultInstanceOf(id: string): string {
        const rows = versionService.instancesOf(id)
        return (
            versionService.listOf(id)?.selectedInstance ??
            rows.find((row) => row.state === 'ready')?.id ??
            rows[0]?.id ??
            ''
        )
    }

    /**
     * 等文件夹的读取落地
     *
     * 同一个文件夹的重复读取会被 VersionService 跳过，此时挑默认实例会挑到空列表
     * 仍在读时最多等两秒
     */
    async function settleFolder(id: string): Promise<void> {
        for (let waited = 0; waited < 40 && versionService.loadingFolder(id); waited += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
    }

    /** 换文件夹：实例跟着重选，除非调用方点名保留 */
    async function pickFolder(id: string, keepInstance = false): Promise<void> {
        folderId.value = id
        await versionService.loadList(id)
        await settleFolder(id)
        if (
            keepInstance &&
            versionService.instancesOf(id).some((row) => row.id === instanceId.value)
        ) {
            return
        }
        const next = defaultInstanceOf(id)
        if (next === instanceId.value) {
            // 同名实例跨文件夹要重取，先清空让监听看到变化
            instanceId.value = ''
        }
        instanceId.value = next
    }

    /** 首屏：文件夹与实例都落到默认选择上 */
    async function ready(): Promise<void> {
        await versionService.ensureFresh()
        const wanted = folderId.value.length > 0 ? folderId.value : versionService.currentFolderId
        if (wanted.length === 0) {
            return
        }
        await pickFolder(wanted, false)
    }

    /** 刷新：文件夹、实例与指纹一起重取 */
    async function reload(): Promise<void> {
        await versionService.reloadAll()
        const wanted = folderId.value.length > 0 ? folderId.value : versionService.currentFolderId
        if (wanted.length === 0) {
            return
        }
        await pickFolder(wanted, true)
    }

    return {
        folderId,
        instanceId,
        folderOptions,
        instanceOptions,
        instances,
        instance,
        scope,
        installable,
        instanceFailure,
        instancesLoading,
        ready,
        reload,
        pickFolder,
    }
}
