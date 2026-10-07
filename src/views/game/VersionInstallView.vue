<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BackButton from '@/components/BackButton.vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import GroupSelect from '@/components/GroupSelect.vue'
import { errorSummary } from '@/api/errorMessages'
import { fetchGameVersions, type GameVersion } from '@/api/manifest'
import type {
    CliDownloadReport,
    CliGameLoader,
    CliLoaderChannel,
    CliLoaderVersion,
} from '@/api/types'
import { LOADER_NAMES, useInstallService } from '@/stores/InstallService'
import { useVersionService } from '@/stores/VersionService'
import type { ChoiceOptionType } from '@/types/ChoiceOptionType'
import { versionTypeLabel } from '@/utils/versionLabel'
import { notifyError, notifySuccess } from '@/utils/notify'

const install = useInstallService()
const versionService = useVersionService()
const router = useRouter()

/** 可安装的游戏版本，来自 Mojang 清单 */
const versions = ref<GameVersion[]>([])
const versionsLoading = ref(false)
const versionsFailure = ref('')
const keyword = ref('')
const typeFilter = ref('release')
const game = ref('')

/** 一次只展开一个加载器 */
const expanded = ref<string | null>(null)
const expandedLoading = ref(false)
const expandedPage = ref<{
    versions: CliLoaderVersion[]
    page: number
    pages: number
    total: number
} | null>(null)

/** 不装加载器时为 null；loaderVersion 为 null 表示取最新 */
const loaderName = ref<string | null>(null)
const loaderVersion = ref<string | null>(null)

const folderId = ref('')
const displayName = ref('')

/** 清单上千条，一次只列这么多 */
const SHOW_LIMIT = 60

/** 占位行数量，与真实行同布局同高度 */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5]

const CHANNEL_LABEL: Record<CliLoaderChannel, string> = {
    release: '正式',
    beta: '测试',
    alpha: '预览',
}

const typeOptions = computed<ChoiceOptionType[]>(() => {
    const seen = new Map<string, string>()
    for (const row of versions.value) {
        if (!seen.has(row.type)) {
            seen.set(row.type, versionTypeLabel(row.type))
        }
    }
    const rows: ChoiceOptionType[] = [{ value: '', label: '全部类型' }]
    for (const [value, label] of seen) {
        rows.push({ value, label })
    }
    return rows
})

const filtered = computed(() => {
    const text = keyword.value.trim().toLowerCase()
    return versions.value.filter((row) => {
        if (typeFilter.value.length > 0 && row.type !== typeFilter.value) {
            return false
        }
        return text.length === 0 || row.id.toLowerCase().includes(text)
    })
})

const visibleVersions = computed(() => filtered.value.slice(0, SHOW_LIMIT))

const folderOptions = computed<ChoiceOptionType[]>(() =>
    versionService.folders.map((folder) => ({
        value: folder.id,
        label: `${folder.name}（${folder.instanceCount} 个实例）`,
    })),
)

/** 将执行的命令，与页面上的选择一致 */
const commandPreview = computed(() => {
    const rows = ['install', game.value.length > 0 ? game.value : '<版本>']
    if (folderId.value.length > 0) {
        rows.push('--folder', folderId.value)
    }
    if (loaderName.value !== null) {
        const spec =
            loaderVersion.value === null
                ? loaderName.value
                : `${loaderName.value}@${loaderVersion.value}`
        rows.push('--loader', spec)
    }
    if (displayName.value.trim().length > 0) {
        rows.push('--name', displayName.value.trim())
    }
    return rows.join(' ')
})

const canStart = computed(() => !install.busy && game.value.length > 0 && folderId.value.length > 0)

/** 五行通道各自的最新计数 */
const progressRows = computed(() => {
    const rows = new Map<string, { label: string; done: number; total: number; bytes: boolean }>()
    for (const event of install.events) {
        rows.set(event.key ?? event.stage, {
            label: event.stage,
            done: event.done,
            total: event.total,
            bytes: event.bytes,
        })
    }
    return [...rows.values()]
})

const reportRows = computed(() => {
    const report = install.report
    if (report === null) {
        return []
    }
    return [
        { key: '实例', value: report.name },
        {
            key: '加载器',
            value:
                report.loader === null ? '原版' : `${report.loader.name} ${report.loader.version}`,
        },
        { key: '库', value: laneText(report.libraries) },
        {
            key: 'natives',
            value: `${report.natives.jars} 个 jar · ${laneText(report.natives.report)}`,
        },
        {
            key: '资源',
            value:
                report.assets === null
                    ? '未装'
                    : `${laneText(report.assets.index)} · ${laneText(report.assets.objects)}`,
        },
        { key: '耗时', value: `${seconds(report.timing.downloadMs + report.timing.finishMs)}` },
        { key: '警告', value: report.warnings.length === 0 ? '无' : report.warnings.join(' · ') },
    ]
})

function laneText(row: CliDownloadReport): string {
    const failed = row.failures.length === 0 ? '' : ` · 失败 ${row.failures.length}`
    return `新下 ${row.downloaded} · 已有 ${row.skipped}${failed}`
}

function seconds(ms: number): string {
    return `${Math.round(ms / 1000)} 秒`
}

function percent(row: { done: number; total: number }): string {
    if (row.total <= 0) {
        return '0%'
    }
    return `${Math.min(100, Math.round((row.done / row.total) * 100))}%`
}

/** 字节通道按 MB 显示，其余按条数 */
function laneCount(row: { done: number; total: number; bytes: boolean }): string {
    const text = (value: number): string =>
        row.bytes ? `${(value / 1024 / 1024).toFixed(1)} MB` : String(value)
    return `${text(row.done)}/${text(row.total)}`
}

/** 拉清单，默认选最新正式版；force 供刷新按钮 */
async function loadVersions(force = false): Promise<void> {
    versionsLoading.value = true
    versionsFailure.value = ''
    try {
        versions.value = await fetchGameVersions(force)
        const first = versions.value.find((row) => row.type === 'release') ?? versions.value[0]
        if (game.value.length === 0 && first !== undefined) {
            game.value = first.id
        }
    } catch (error) {
        versions.value = []
        versionsFailure.value = String(error)
    } finally {
        versionsLoading.value = false
    }
}

async function reload(): Promise<void> {
    install.dropLoaderCache()
    await loadVersions(true)
    await loadLoadersOfGame(true)
}

/** 加载器那栏按选定的游戏版本查，没有版本的不列 */
async function loadLoadersOfGame(force = false): Promise<void> {
    const wanted = game.value
    if (wanted.length === 0) {
        return
    }
    await install.loadAvailableLoaders(wanted, force)
    // 期间又换了版本，旧结果不参与判断
    if (wanted !== game.value) {
        return
    }
    if (
        loaderName.value !== null &&
        !loaderRows.value.some((row) => row.loader === loaderName.value)
    ) {
        loaderName.value = null
        loaderVersion.value = null
    }
}

/** 换游戏版本后，加载器一栏与已选加载器都要重算 */
async function pickGame(id: string): Promise<void> {
    if (id === game.value) {
        return
    }
    game.value = id
    expanded.value = null
    expandedPage.value = null
    loaderVersion.value = null
    await loadLoadersOfGame()
}

/** 这个游戏版本上真的有版本的加载器 */
const loaderRows = computed(() => install.availableLoaders.filter((row) => row.total > 0))

interface LoaderSlot {
    name: string
    /** 已回来的那一行，null 表示还在取 */
    row: CliGameLoader | null
}

/** 四家按固定顺序落位：谁先回都长在该在的位置，没回的先出骨架 */
const loaderSlots = computed<LoaderSlot[]>(() =>
    LOADER_NAMES.map((name) => ({
        name,
        row: install.availableLoaders.find((item) => item.loader === name) ?? null,
    })).filter((slot) => slot.row !== null || install.pendingLoaders.includes(slot.name)),
)

async function toggleLoader(name: string): Promise<void> {
    if (expanded.value === name) {
        expanded.value = null
        expandedPage.value = null
        return
    }
    const wantedGame = game.value
    expanded.value = name
    expandedPage.value = null
    expandedLoading.value = true
    try {
        const page = await install.queryLoader(name, wantedGame, 1)
        // 期间换了加载器或游戏版本就丢掉
        if (page === null || expanded.value !== name || game.value !== wantedGame) {
            return
        }
        expandedPage.value = {
            versions: page.versions,
            page: page.page,
            pages: page.pages,
            total: page.total,
        }
    } finally {
        expandedLoading.value = false
    }
}

/** 加载器版本按页追加 */
async function loadMore(): Promise<void> {
    const current = expandedPage.value
    const name = expanded.value
    if (current === null || name === null || current.page >= current.pages) {
        return
    }
    const wantedGame = game.value
    expandedLoading.value = true
    try {
        const page = await install.queryLoader(name, wantedGame, current.page + 1)
        // 期间换了加载器、游戏版本或已翻过页就丢掉
        if (
            page === null ||
            expanded.value !== name ||
            game.value !== wantedGame ||
            expandedPage.value !== current
        ) {
            return
        }
        expandedPage.value = {
            versions: [...current.versions, ...page.versions],
            page: page.page,
            pages: page.pages,
            total: page.total,
        }
    } finally {
        expandedLoading.value = false
    }
}

function chooseLoader(name: string | null, version: string | null): void {
    loaderName.value = name
    loaderVersion.value = version
}

async function start(): Promise<void> {
    if (!canStart.value) {
        return
    }
    const ok = await install.start(
        {
            game: game.value,
            loader: loaderName.value,
            loaderVersion: loaderVersion.value,
            name: displayName.value,
        },
        folderId.value,
    )
    if (!ok) {
        reportFailure()
        return
    }
    notifySuccess(`已安装 · ${install.report?.name ?? game.value}`)
    // 装完把列表刷新，新实例立刻可见
    await versionService.loadFolders()
    await versionService.loadList(folderId.value)
}

async function cancel(): Promise<void> {
    await install.cancel()
}

function toList(): void {
    void router.push('/version/list')
}

onMounted(async () => {
    await versionService.loadFolders()
    folderId.value = versionService.currentFolderId
    await reload()
})

function failureText(
    code: string,
    message: string,
    retryable: boolean,
    detail: string | null,
): string {
    const head = errorSummary(code, message, retryable)
    return detail === null ? head : `${head} · ${detail}`
}

function reportFailure(): void {
    const failure = install.failure
    if (failure !== null) {
        notifyError(failureText(failure.code, failure.message, failure.retryable, failure.detail))
    }
}
</script>

<template>
    <main class="install">
        <header class="install__head">
            <BackButton fallback="/version/list" />
            <h1 class="install__title">安装新版本</h1>
            <GroupButton variant="ghost" :disabled="install.busy" @click="reload">
                {{ versionsLoading ? '读取中' : '刷新' }}
            </GroupButton>
        </header>

        <p v-if="versionsFailure" class="install__failure">
            <span class="install__failure-code">清单读取失败</span>
            <span class="install__failure-detail">{{ versionsFailure }}</span>
        </p>

        <p v-if="install.loadersFailure && install.report === null" class="install__failure">
            <span class="install__failure-code">
                {{
                    errorSummary(
                        install.loadersFailure.code,
                        install.loadersFailure.message,
                        install.loadersFailure.retryable,
                    )
                }}
            </span>
            <span v-if="install.loadersFailure.detail" class="install__failure-detail">
                {{ install.loadersFailure.detail }}
            </span>
        </p>

        <CollapsibleGroup label="游戏版本" default-open>
            <GroupInput
                v-model="keyword"
                label="筛选"
                placeholder="版本号，例如 1.20"
                :disabled="versionsLoading"
            />
            <GroupSelect
                v-model="typeFilter"
                label="类型"
                :options="typeOptions"
                :disabled="versionsLoading"
            />
            <div v-if="versionsLoading" class="install__versions" aria-busy="true">
                <div v-for="row in SKELETON_ROWS" :key="row" class="install__version install__wait">
                    <span
                        class="install__skeleton"
                        :style="{ width: `${38 + (row % 3) * 12}%`, height: '1.05rem' }"
                        aria-hidden="true"
                    ></span>
                    <span
                        class="install__skeleton"
                        style="width: 3.2rem; height: 0.95rem"
                        aria-hidden="true"
                    ></span>
                    <span
                        class="install__skeleton"
                        style="width: 4.2rem; height: 0.95rem"
                        aria-hidden="true"
                    ></span>
                </div>
            </div>
            <template v-else>
                <p class="install__note">
                    匹配 {{ filtered.length }} 个 · 列出前
                    {{ Math.min(filtered.length, SHOW_LIMIT) }} 个{{
                        filtered.length > SHOW_LIMIT ? ' · 用筛选缩小范围' : ''
                    }}
                </p>
                <ul class="install__versions">
                    <li v-for="row in visibleVersions" :key="row.id">
                        <button
                            type="button"
                            class="install__version"
                            :class="{ 'install__version--on': row.id === game }"
                            :disabled="install.busy"
                            @click="pickGame(row.id)"
                        >
                            <span class="install__version-id">{{ row.id }}</span>
                            <span class="install__tag">{{ versionTypeLabel(row.type) }}</span>
                            <span class="install__version-time">{{
                                row.releaseTime.slice(0, 10)
                            }}</span>
                        </button>
                    </li>
                </ul>
            </template>
        </CollapsibleGroup>

        <CollapsibleGroup label="加载器" default-open>
            <p v-if="game.length === 0" class="install__note">请选择一个游戏版本</p>
            <template v-else>
                <div class="install__loader">
                    <div class="install__loader-row">
                        <button
                            type="button"
                            class="install__loader-name"
                            :class="{ 'install__loader-name--on': loaderName === null }"
                            :disabled="install.busy"
                            @click="chooseLoader(null, null)"
                        >
                            原版
                        </button>
                        <span class="install__loader-meta">不安装加载器</span>
                    </div>
                </div>

                <div v-for="(slot, index) in loaderSlots" :key="slot.name" class="install__loader">
                    <template v-if="slot.row !== null">
                        <div class="install__loader-row">
                            <button
                                type="button"
                                class="install__loader-name"
                                :class="{ 'install__loader-name--on': loaderName === slot.name }"
                                :disabled="install.busy"
                                @click="chooseLoader(slot.name, null)"
                            >
                                {{ slot.name }}
                            </button>
                            <span class="install__loader-meta">
                                最新 {{ slot.row.latest ?? '没有' }} · {{ slot.row.total }} 个版本
                            </span>
                            <GroupButton
                                variant="ghost"
                                :disabled="install.busy"
                                @click="toggleLoader(slot.name)"
                            >
                                {{ expanded === slot.name ? '收起' : '展开' }}
                            </GroupButton>
                        </div>

                        <div v-if="expanded === slot.name" class="install__loader-body">
                            <div
                                v-if="expandedLoading && expandedPage === null"
                                class="install__chips"
                                aria-busy="true"
                            >
                                <span
                                    v-for="row in SKELETON_ROWS"
                                    :key="row"
                                    class="install__skeleton"
                                    :style="{
                                        width: `${3.6 + (row % 3) * 1.4}rem`,
                                        height: '1.35rem',
                                    }"
                                    aria-hidden="true"
                                ></span>
                            </div>
                            <template v-else-if="expandedPage !== null">
                                <p class="install__note">
                                    {{ game }} 上可用 {{ expandedPage.total }} 个 · 第
                                    {{ expandedPage.page }}/{{ expandedPage.pages }} 页
                                </p>
                                <div class="install__chips">
                                    <button
                                        type="button"
                                        class="install__chip"
                                        :class="{
                                            'install__chip--on':
                                                loaderName === slot.name && loaderVersion === null,
                                        }"
                                        :disabled="install.busy"
                                        @click="chooseLoader(slot.name, null)"
                                    >
                                        最新
                                    </button>
                                    <button
                                        v-for="item in expandedPage.versions"
                                        :key="item.version"
                                        type="button"
                                        class="install__chip"
                                        :class="{
                                            'install__chip--on':
                                                loaderName === slot.name &&
                                                loaderVersion === item.version,
                                        }"
                                        :disabled="install.busy"
                                        @click="chooseLoader(slot.name, item.version)"
                                    >
                                        {{ item.version }}
                                        <span class="install__chip-channel">
                                            {{ CHANNEL_LABEL[item.channel] }}
                                        </span>
                                    </button>
                                </div>
                                <GroupButton
                                    v-if="expandedPage.page < expandedPage.pages"
                                    variant="ghost"
                                    :disabled="expandedLoading || install.busy"
                                    @click="loadMore"
                                >
                                    {{ expandedLoading ? '读取中' : '加载更多' }}
                                </GroupButton>
                            </template>
                            <p v-else class="install__note">这个游戏版本上没有可用版本</p>
                        </div>
                    </template>

                    <div v-else class="install__loader-row" aria-busy="true">
                        <span
                            class="install__skeleton"
                            style="width: 4.6rem; height: 1.9rem"
                            aria-hidden="true"
                        ></span>
                        <span
                            class="install__skeleton"
                            :style="{ width: `${24 + (index % 3) * 10}%`, height: '0.95rem' }"
                            aria-hidden="true"
                        ></span>
                        <span
                            class="install__skeleton"
                            style="width: 3.6rem; height: 2.3rem"
                            aria-hidden="true"
                        ></span>
                    </div>
                </div>

                <p class="install__note">
                    {{ game }} 上可装 {{ loaderRows.length }} 种加载器 · 没有这个版本记录的不列
                </p>
                <p v-if="install.pendingLoaders.length > 0" class="install__note">
                    四家并行取，先回的先出
                </p>
                <p
                    v-for="warning in install.availableWarnings"
                    :key="warning"
                    class="install__note"
                >
                    {{ warning }}
                </p>
            </template>
        </CollapsibleGroup>

        <CollapsibleGroup label="目标" default-open>
            <GroupSelect
                v-model="folderId"
                label="目标文件夹"
                :options="folderOptions"
                :disabled="install.busy"
            />
            <GroupInput
                v-model="displayName"
                label="显示名"
                placeholder="留空由Bloomery自动处理"
                :disabled="install.busy"
            />
            <p class="install__note">{{ commandPreview }}</p>
            <div class="install__actions">
                <GroupButton :disabled="!canStart" @click="start">
                    {{ install.busy ? '安装中' : '开始安装' }}
                </GroupButton>
                <GroupButton v-if="install.busy" variant="ghost" @click="cancel">取消</GroupButton>
            </div>
        </CollapsibleGroup>

        <CollapsibleGroup
            v-if="install.busy || install.report !== null || install.failure !== null"
            label="进度"
            default-open
        >
            <ul v-if="progressRows.length > 0" class="install__lanes">
                <li v-for="lane in progressRows" :key="lane.label" class="install__lane">
                    <span class="install__lane-label">{{ lane.label }}</span>
                    <span class="install__lane-track">
                        <span class="install__lane-bar" :style="{ width: percent(lane) }"></span>
                    </span>
                    <span class="install__lane-count">{{ laneCount(lane) }}</span>
                </li>
            </ul>
            <p v-else-if="install.busy" class="install__note">已开始，等待进度</p>

            <p v-if="install.cancelled" class="install__note">已取消</p>
            <p v-else-if="install.failure !== null" class="install__failure">
                <span class="install__failure-code">
                    {{
                        errorSummary(
                            install.failure.code,
                            install.failure.message,
                            install.failure.retryable,
                        )
                    }}
                </span>
                <span v-if="install.failure.detail" class="install__failure-detail">
                    {{ install.failure.detail }}
                </span>
            </p>

            <template v-if="install.report !== null">
                <div class="install__rows">
                    <div v-for="row in reportRows" :key="row.key" class="install__row">
                        <span class="install__key">{{ row.key }}</span>
                        <span class="install__value">{{ row.value }}</span>
                    </div>
                </div>
                <div class="install__actions">
                    <GroupButton variant="ghost" @click="toList">去版本列表</GroupButton>
                    <GroupButton variant="ghost" @click="install.close">关闭</GroupButton>
                </div>
            </template>
        </CollapsibleGroup>
    </main>
</template>

<style scoped lang="scss">
.install {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 52rem;
    padding: 1.5rem;

    // 可点元素的底与悬停：与分组内容区差 8% / 16%，两套主题下都看得出来
    --clickable-bg: color-mix(in srgb, var(--text-color) 8%, var(--group-content-bg));
    --clickable-bg-hover: color-mix(in srgb, var(--text-color) 16%, var(--group-content-bg));
    --clickable-bg-active: color-mix(in srgb, var(--text-color) 26%, var(--group-content-bg));
    // 占位底色与扫光
    --skeleton-bg: color-mix(in srgb, var(--text-color) 18%, var(--group-content-bg));
    --skeleton-glow: color-mix(in srgb, var(--text-color) 34%, transparent);
}

.install__head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.install__title {
    flex: 1;
    margin: 0;

    font-size: var(--font-size-3xl);
}

.install__failure {
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

.install__failure-code {
    font-weight: 600;
}

.install__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.install__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);

    word-break: break-all;
}

.install__versions {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;

    max-height: 18rem;
    margin: 0;
    padding: 0;

    overflow: auto;

    list-style: none;
}

.install__version {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    width: 100%;
    padding: 0.3rem 0.5rem;

    color: var(--text-color);
    font: inherit;
    font-size: var(--font-size-sm);
    text-align: left;

    background-color: var(--clickable-bg);
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    cursor: pointer;

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        border-color var(--transition-duration) var(--transition-ease),
        color var(--transition-duration) var(--transition-ease);

    &:hover:not(:disabled) {
        background-color: var(--clickable-bg-hover);
        border-color: var(--text-color-dark);
    }

    &:active:not(:disabled) {
        background-color: var(--clickable-bg-active);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: -2px;
    }

    &:disabled {
        cursor: default;
    }
}

/* 选中：反色，一眼看出选的是哪一条 */
.install__version--on {
    color: var(--text-color-opposite);
    background-color: var(--bg-opposite);
    border-color: var(--bg-opposite);

    .install__version-time {
        color: var(--text-color-opposite);
        opacity: 0.75;
    }
}

.install__version-id {
    flex: 1;
    min-width: 0;

    font-family: ui-monospace, monospace;
    word-break: break-all;
}

.install__version-time {
    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

/* 占位：与真实行同布局同高度，出内容前不跳动 */
.install__wait {
    pointer-events: none;
}

.install__skeleton {
    position: relative;
    flex: 0 0 auto;
    overflow: hidden;

    background-color: var(--skeleton-bg);
    border-radius: calc(var(--border-radius) / 2);

    &::after {
        content: '';

        position: absolute;
        inset: 0;

        background-image: linear-gradient(90deg, transparent, var(--skeleton-glow), transparent);
        transform: translateX(-100%);

        animation: install-sweep 1.4s linear infinite;
    }
}

@keyframes install-sweep {
    to {
        transform: translateX(100%);
    }
}

@media (prefers-reduced-motion: reduce) {
    .install__skeleton::after {
        animation: none;
    }
}

.install__tag {
    padding: 0 0.4rem;

    color: var(--text-color);
    font-size: var(--font-size-xs);

    background-color: var(--clickable-bg-hover);
    border-radius: calc(var(--border-radius) / 2);
}

.install__loader {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;

    padding: 0.3rem 0;
}

.install__loader-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}

.install__loader-name {
    padding: 0.15rem 0.5rem;

    color: var(--text-color);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;

    background-color: var(--clickable-bg);
    border: 1px solid transparent;
    border-radius: calc(var(--border-radius) / 2);
    cursor: pointer;

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        border-color var(--transition-duration) var(--transition-ease),
        color var(--transition-duration) var(--transition-ease);

    &:hover:not(:disabled) {
        background-color: var(--clickable-bg-hover);
        border-color: var(--text-color-dark);
    }

    &:active:not(:disabled) {
        background-color: var(--clickable-bg-active);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }

    &:disabled {
        cursor: default;
    }
}

.install__loader-name--on {
    background-color: var(--bg-opposite);
    color: var(--text-color-opposite);
}

.install__loader-meta {
    flex: 1;
    min-width: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.install__loader-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    padding-left: 0.5rem;
    border-left: 2px solid var(--button-bg-color);
}

.install__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
}

.install__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;

    padding: 0.15rem 0.5rem;

    color: var(--text-color);
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);

    background-color: var(--clickable-bg);
    border: 1px solid transparent;
    border-radius: calc(var(--border-radius) / 2);
    cursor: pointer;

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        border-color var(--transition-duration) var(--transition-ease),
        color var(--transition-duration) var(--transition-ease);

    &:hover:not(:disabled) {
        background-color: var(--clickable-bg-hover);
        border-color: var(--text-color-dark);
    }

    &:active:not(:disabled) {
        background-color: var(--clickable-bg-active);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }

    &:disabled {
        cursor: default;
    }
}

.install__chip--on {
    background-color: var(--bg-opposite);
    color: var(--text-color-opposite);
}

.install__chip-channel {
    opacity: 0.7;
}

.install__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}

.install__lanes {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

.install__lane {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    font-size: var(--font-size-xs);
}

.install__lane-label {
    flex: 0 0 6rem;

    color: var(--text-color-dark);
}

.install__lane-track {
    flex: 1;
    min-width: 0;
    height: 0.4rem;

    background-color: var(--bg-color-dark);
    border-radius: 999px;
    overflow: hidden;
}

.install__lane-bar {
    display: block;
    height: 100%;

    background-color: var(--text-color);
}

.install__lane-count {
    flex: 0 0 6rem;

    font-family: ui-monospace, monospace;
    text-align: right;
}

.install__rows {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.install__row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;

    font-size: var(--font-size-sm);
}

.install__key {
    flex: 0 0 5rem;

    color: var(--text-color-dark);
}

.install__value {
    flex: 1;
    min-width: 0;

    word-break: break-all;
}
</style>
