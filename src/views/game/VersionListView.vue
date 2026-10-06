<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { PhGear, PhPlay } from '@phosphor-icons/vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GameLaunching from '@/components/GameLaunching.vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import GroupSwitch from '@/components/GroupSwitch.vue'
import PopupMenu from '@/components/PopupMenu.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import { useVersionService } from '@/stores/VersionService'
import { errorSummary } from '@/api/errorMessages'
import type { CliFolder, CliInstance, CliLaunchResult } from '@/api/types'
import { useLaunchService } from '@/stores/LaunchService'
import type { PopupMenuItem } from '@/components/PopupMenu.vue'
import {
    gameVersionLabel,
    lastPlayedLabel,
    loaderLabel,
    stateLabel,
    versionTypeLabel,
} from '@/utils/versionLabel'
import { notifyError, notifySuccess } from '@/utils/notify'

const versionService = useVersionService()
const launchService = useLaunchService()
const router = useRouter()

const keyword = ref('')
/** 每个文件夹的展开状态，展开时懒加载 */
const opened = ref<Record<string, boolean>>({})

/** 当前文件夹置顶，其余按名字 */
const orderedFolders = computed<CliFolder[]>(() => {
    const all = [...versionService.folders]
    return all.sort((left, right) => {
        if (left.selected !== right.selected) {
            return left.selected ? -1 : 1
        }
        return left.name.localeCompare(right.name)
    })
})

function instancesIn(folderId: string): CliInstance[] {
    const text = keyword.value.trim().toLowerCase()
    const rows = versionService.instancesOf(folderId)
    if (text.length === 0) {
        return rows
    }
    return rows.filter((item) =>
        [
            item.id,
            item.gameVersion ?? '',
            item.loader?.type ?? '',
            item.state,
            versionTypeLabel(item.type),
        ]
            .join(' ')
            .toLowerCase()
            .includes(text),
    )
}

/** 搜索时展开有命中的组 */
const searching = computed(() => keyword.value.trim().length > 0)

function isOpen(folderId: string): boolean {
    // 搜索时强制展开，命中项在折叠组里不可见
    if (searching.value) {
        return true
    }
    if (opened.value[folderId] !== undefined) {
        return opened.value[folderId]
    }
    return folderId === versionService.currentFolderId
}

function toggleFolder(folderId: string, value: boolean): void {
    opened.value = { ...opened.value, [folderId]: value }
    if (value) {
        void versionService.loadList(folderId)
    }
}

/** 只在当前文件夹显示选中标记，避免同名实例跨文件夹串标记 */
function selectedOf(folder: CliFolder): string | null {
    return folder.selected ? (versionService.listOf(folder.id)?.selectedInstance ?? null) : null
}

async function refresh(): Promise<void> {
    await versionService.reloadAll()
}

async function setCurrent(folder: CliFolder): Promise<void> {
    await versionService.setCurrentFolder(folder.id)
    const failure = versionService.foldersFailure
    if (failure !== null) {
        notifyError(errorSummary(failure.code, failure.message, failure.retryable))
        return
    }
    notifySuccess(`当前文件夹 · ${folder.name}`)
}

async function selectInstance(instance: CliInstance, folderId: string): Promise<void> {
    await versionService.select(instance.id, folderId)
}

/** 播放按钮：正常点击走确认，Shift 点击开小菜单 */
function onPlay(folderId: string, instance: CliInstance, event: MouseEvent): void {
    if (event.shiftKey) {
        menus.get(`${folderId}/${instance.id}`)?.toggle()
        return
    }
    void requestLaunch(folderId, instance)
}

async function requestLaunch(folderId: string, instance: CliInstance): Promise<void> {
    const plan = await launchService.prepare(instance.id, folderId)
    if (plan === null) {
        reportLaunchFailure()
        return
    }
    if (launchService.skipConfirm) {
        await runLaunch(folderId, instance)
        return
    }
    pending.value = { folderId, instance }
    planInfo.value = plan
    skipNext.value = false
    confirmOpen.value = true
}

function reportLaunchFailure(): void {
    const failure = launchService.failure
    if (failure === null) {
        return
    }
    const detail = failure.detail === null ? '' : ` · ${failure.detail}`
    notifyError(`${errorSummary(failure.code, failure.message, failure.retryable)}${detail}`)
}

async function confirmLaunch(): Promise<void> {
    const target = pending.value
    confirmOpen.value = false
    if (target === null) {
        return
    }
    if (skipNext.value) {
        launchService.setSkipConfirm(true)
    }
    await runLaunch(target.folderId, target.instance)
}

async function runLaunch(folderId: string, instance: CliInstance): Promise<void> {
    const ok = await launchService.start(instance.id, folderId)
    if (!ok) {
        reportLaunchFailure()
        return
    }
    notifySuccess(`已启动 · ${instance.name}`)
}

/** 输出启动命令：dry-run 不启动进程 */
async function showDryRun(folderId: string, instance: CliInstance): Promise<void> {
    const plan = await launchService.prepare(instance.id, folderId)
    if (plan === null) {
        return
    }
    dryRunText.value = [plan.executable, ...(plan.args ?? [])].join(' \\\n  ')
    dryRunOpen.value = true
}

/** 启动并监听日志：起完跳到输出子页面 */
async function startWithLog(folderId: string, instance: CliInstance): Promise<void> {
    await runLaunch(folderId, instance)
    if (launchService.logPath.length > 0) {
        await router.push(
            `/version/${encodeURIComponent(folderId)}/${encodeURIComponent(instance.id)}/console`,
        )
    }
}

/** 每行一个手动模式菜单 */
interface MenuHandle {
    toggle: () => void
}

const menus = new Map<string, MenuHandle>()

function bindMenu(key: string) {
    return (el: unknown) => {
        if (el === null || el === undefined) {
            menus.delete(key)
            return
        }
        menus.set(key, el as MenuHandle)
    }
}

function menuItems(folderId: string, instance: CliInstance): PopupMenuItem[] {
    return [
        { label: '输出启动命令（--dry-run）', onClick: () => showDryRun(folderId, instance) },
        { label: '启动并监听日志', onClick: () => startWithLog(folderId, instance) },
    ]
}

const pending = ref<{ folderId: string; instance: CliInstance } | null>(null)
const planInfo = ref<CliLaunchResult | null>(null)
const confirmOpen = ref(false)
const skipNext = ref(false)
const dryRunOpen = ref(false)
const dryRunText = ref('')

/** 确认弹窗里的启动信息 */
const confirmRows = computed(() => {
    const plan = planInfo.value
    if (plan === null) {
        return []
    }
    const memory = (plan.args ?? []).find((arg) => arg.startsWith('-Xmx')) ?? ''
    return [
        { key: '实例', value: plan.version },
        {
            key: '账户',
            value:
                plan.account === undefined
                    ? '未知'
                    : `${plan.account.name}（${plan.account.kind}）`,
        },
        {
            key: 'Java',
            value: plan.java === undefined ? '未知' : `${plan.java.major} · ${plan.java.vendor}`,
        },
        { key: '内存', value: memory.length > 0 ? memory.replace('-Xmx', '') : '按配置' },
        { key: '目录', value: plan.directory },
    ]
})

onMounted(async () => {
    await versionService.load()
    const first = versionService.currentFolderId
    if (first.length > 0) {
        opened.value = { ...opened.value, [first]: true }
    }
})
</script>

<template>
    <main class="versions">
        <header class="versions__head">
            <h1 class="versions__title">版本列表</h1>
            <GroupButton variant="ghost" :disabled="versionService.foldersLoading" @click="refresh">
                {{ versionService.foldersLoading ? '读取中' : '刷新' }}
            </GroupButton>
        </header>

        <p v-if="versionService.foldersFailure" class="versions__failure">
            <span class="versions__failure-code">
                {{
                    errorSummary(
                        versionService.foldersFailure.code,
                        versionService.foldersFailure.message,
                        versionService.foldersFailure.retryable,
                    )
                }}
            </span>
            <span v-if="versionService.foldersFailure.detail" class="versions__failure-detail">
                {{ versionService.foldersFailure.detail }}
            </span>
        </p>

        <GroupInput
            v-model="keyword"
            label="筛选"
            placeholder="实例名 / 游戏版本 / 加载器 / 状态"
        />

        <p v-if="orderedFolders.length === 0" class="versions__note">还没有登记任何游戏文件夹</p>

        <CollapsibleGroup
            v-for="folder in orderedFolders"
            :key="folder.id"
            :label="folder.name"
            :open="isOpen(folder.id)"
            @update:open="(value: boolean | undefined) => toggleFolder(folder.id, value === true)"
        >
            <div class="versions__folder-row">
                <span class="versions__folder-path">{{ folder.path }}</span>
                <span>{{ folder.instanceCount }} 个实例</span>
                <span>· {{ folder.exists ? '存在' : '不存在' }}</span>
                <span>· {{ folder.writable ? '可写' : '只读' }}</span>
                <span v-if="folder.selected" class="versions__tag versions__tag--current"
                    >已选中该文件夹</span
                >
                <GroupButton
                    v-else
                    variant="ghost"
                    :disabled="versionService.foldersLoading"
                    @click="setCurrent(folder)"
                >
                    设为当前选中
                </GroupButton>
            </div>

            <p v-if="!folder.exists" class="versions__note">该目录不存在，未读取实例</p>

            <p v-else-if="versionService.loadingFolder(folder.id)" class="versions__note">读取中</p>

            <p v-else-if="versionService.failureOf(folder.id)" class="versions__group-failure">
                {{
                    errorSummary(
                        versionService.failureOf(folder.id)!.code,
                        versionService.failureOf(folder.id)!.message,
                        versionService.failureOf(folder.id)!.retryable,
                    )
                }}
                <template v-if="versionService.failureOf(folder.id)!.detail">
                    · {{ versionService.failureOf(folder.id)!.detail }}
                </template>
            </p>

            <p
                v-else-if="versionService.lists[folder.id] && instancesIn(folder.id).length === 0"
                class="versions__note"
            >
                {{ keyword.trim().length > 0 ? '没有匹配的实例' : '该文件夹下没有实例' }}
            </p>

            <ul v-else class="versions__list">
                <li
                    v-for="instance in instancesIn(folder.id)"
                    :key="instance.id"
                    class="versions__row"
                >
                    <div
                        class="versions__main"
                        :class="{
                            'versions__main--selected': instance.id === selectedOf(folder),
                            'versions__main--off': instance.state !== 'ready',
                        }"
                    >
                        <button
                            type="button"
                            class="versions__item"
                            :disabled="versionService.switching !== null"
                            @click="selectInstance(instance, folder.id)"
                        >
                            <span class="versions__item-main">
                                <span class="versions__item-name">{{ instance.name }}</span>
                                <span class="versions__tag">{{ loaderLabel(instance) }}</span>
                                <span class="versions__tag">{{
                                    versionTypeLabel(instance.type)
                                }}</span>
                                <span v-if="instance.state !== 'ready'" class="versions__tag">
                                    {{ stateLabel(instance.state) }}
                                </span>
                                <span
                                    v-if="instance.id === selectedOf(folder)"
                                    class="versions__tag versions__tag--current"
                                >
                                    当前选中
                                </span>
                                <span
                                    v-if="versionService.switching === instance.id"
                                    class="versions__tag"
                                >
                                    切换中
                                </span>
                                <span
                                    v-if="versionService.running[instance.id]"
                                    class="versions__tag"
                                >
                                    运行中
                                </span>
                            </span>
                            <span class="versions__item-meta">
                                游戏 {{ gameVersionLabel(instance.gameVersion) }}
                                <template v-if="instance.java.required">
                                    · Java {{ instance.java.required.major }}
                                </template>
                                · 上次启动 {{ lastPlayedLabel(instance.lastPlayed) }}
                                <template v-if="instance.problem">
                                    · {{ instance.problem }}</template
                                >
                            </span>
                        </button>

                        <PopupMenu
                            :ref="bindMenu(`${folder.id}/${instance.id}`)"
                            manual
                            trigger=".versions__play"
                            :items="menuItems(folder.id, instance)"
                        >
                            <button
                                type="button"
                                class="versions__play"
                                :disabled="launchService.busy || instance.state !== 'ready'"
                                :aria-label="`启动 ${instance.name}（Shift 点击更多）`"
                                :title="`启动 ${instance.name}（Shift 点击更多）`"
                                @click="onPlay(folder.id, instance, $event)"
                            >
                                <PhPlay :size="16" weight="fill" aria-hidden="true" />
                            </button>
                        </PopupMenu>
                    </div>

                    <RouterLink
                        class="versions__setting"
                        :to="`/version/${encodeURIComponent(folder.id)}/${encodeURIComponent(instance.id)}/setting`"
                        :aria-label="`${instance.name} 设置`"
                        :title="`${instance.name} 设置`"
                    >
                        <PhGear :size="18" weight="regular" aria-hidden="true" />
                    </RouterLink>
                </li>
            </ul>
        </CollapsibleGroup>

        <PopupWindow
            v-model:open="confirmOpen"
            title="启动游戏"
            :buttons="[{ label: '取消' }, { label: '启动', onClick: confirmLaunch }]"
        >
            <div class="versions__confirm">
                <div v-for="row in confirmRows" :key="row.key" class="versions__confirm-row">
                    <span class="versions__confirm-key">{{ row.key }}</span>
                    <span class="versions__confirm-value">{{ row.value }}</span>
                </div>
                <GroupSwitch v-model="skipNext" label="不再询问" />
            </div>
        </PopupWindow>

        <PopupWindow v-model:open="dryRunOpen" title="启动命令" context="--dry-run，不会启动进程">
            <pre class="versions__command">{{ dryRunText }}</pre>
        </PopupWindow>

        <GameLaunching />
    </main>
</template>

<style scoped lang="scss">
.versions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 52rem;
    padding: 1.5rem;
}

.versions__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}

.versions__title {
    margin: 0;

    font-size: var(--font-size-3xl);
}

.versions__failure {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;

    margin: 0;
    padding: 0.6rem 0.75rem;

    font-size: var(--font-size-sm);

    background-color: color-mix(in srgb, #c62828 18%, transparent);
    border: 1px solid color-mix(in srgb, #c62828 45%, transparent);
    border-radius: var(--border-radius);
}

.versions__failure-code {
    font-weight: 600;
}

.versions__failure-message {
    color: var(--text-color-dark);
}

.versions__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.versions__folder {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
}

.versions__folder-name {
    font-size: var(--font-size-lg);
    font-weight: 600;
}

.versions__folder-path {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);
    word-break: break-all;
}

.versions__folder-meta {
    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.versions__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-sm);
}

.versions__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

.versions__row {
    display: flex;
    align-items: stretch;
    gap: 0.35rem;
}

/* 行主体可点选中，右侧齿轮进设置 */
.versions__setting {
    display: grid;
    place-items: center;

    flex: 0 0 auto;

    width: 2.25rem;

    color: var(--text-color);

    background-color: var(--bg-color-dark);
    border: 1px solid transparent;
    border-radius: var(--border-radius);

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        border-color var(--transition-duration) var(--transition-ease);

    &:hover {
        border-color: var(--text-color-dark);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }
}

.versions__main {
    display: flex;
    align-items: stretch;

    flex: 1;
    min-width: 0;

    background-color: var(--bg-color-dark);
    border: 1px solid transparent;
    border-radius: var(--border-radius);

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        border-color var(--transition-duration) var(--transition-ease);
}

/* 播放按钮贴在版本项内部最右侧 */
.versions__play {
    display: grid;
    place-items: center;

    flex: 0 0 auto;

    width: 2.25rem;
    padding: 0;

    color: var(--text-color);

    background-color: transparent;
    border: none;
    border-radius: 0 var(--border-radius) var(--border-radius) 0;
    cursor: pointer;

    transition: background-color var(--transition-duration) var(--transition-ease);

    &:hover:not(:disabled) {
        background-color: var(--button-bg-color);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: -2px;
    }

    &:disabled {
        color: var(--text-color-dark);
        cursor: default;
    }
}

.versions__item {
    flex: 1;
    min-width: 0;
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 0.15rem;

    padding: 0.45rem 0.6rem;

    color: var(--text-color);
    font: inherit;
    text-align: left;

    background-color: transparent;
    border: none;
    cursor: pointer;

    &:hover:not(:disabled) {
        background-color: var(--button-bg-color);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }

    &:disabled {
        cursor: default;
    }
}

.versions__main--selected {
    border-color: var(--text-color);
}

.versions__main--off {
    opacity: 0.6;
}

.versions__item-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
}

.versions__item-name {
    font-size: var(--font-size-sm);
    font-weight: 600;
}

.versions__item-meta {
    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    word-break: break-all;
}

.versions__tag {
    padding: 0 0.4rem;

    color: var(--text-color);

    font-size: var(--font-size-xs);
    font-weight: 400;

    background-color: var(--button-bg-color);
    border-radius: calc(var(--border-radius) / 2);
}

.versions__tag--current {
    background-color: var(--bg-opposite);
    color: var(--text-color-opposite);
}

.versions__confirm {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.versions__confirm-row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;

    font-size: var(--font-size-sm);
}

.versions__confirm-key {
    flex: 0 0 4rem;

    color: var(--text-color-dark);
}

.versions__confirm-value {
    flex: 1;
    min-width: 0;

    word-break: break-all;
}

.versions__command {
    max-height: 16rem;
    margin: 0;
    padding: 0.5rem;

    overflow: auto;

    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    word-break: break-all;

    background-color: var(--bg-color-dark);
    border-radius: var(--border-radius);
}

.versions__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}

.versions__chip {
    padding: 0.15rem 0.5rem;

    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);

    background-color: var(--button-bg-color);
    border-radius: calc(var(--border-radius) / 2);
}

.versions__folder-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;

    font-size: var(--font-size-xs);
}

.versions__folder-path {
    flex: 1;
    min-width: 0;

    color: var(--text-color-dark);
    font-family: ui-monospace, monospace;

    word-break: break-all;
}

.versions__tag--current {
    background-color: var(--bg-opposite);
    color: var(--text-color-opposite);
}

.versions__group-failure {
    margin: 0;

    font-size: var(--font-size-xs);

    word-break: break-all;
}
</style>
