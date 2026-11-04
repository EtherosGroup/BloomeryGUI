<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import BackButton from '@/components/BackButton.vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupCheckbox from '@/components/GroupCheckbox.vue'
import GroupInput from '@/components/GroupInput.vue'
import GroupSelect from '@/components/GroupSelect.vue'
import ModProgress from '@/views/mod/ModProgress.vue'
import { errorSummary } from '@/api/errorMessages'
import { openPath } from '@/api/system'
import { MOD_API_REQUIRED, type CliModFile } from '@/api/types'
import type { ModAction } from '@/stores/ModService'
import { useEnvironmentCheckService } from '@/stores/EnvironmentCheckService'
import { useModDownloadService } from '@/stores/ModDownloadService'
import { useModService } from '@/stores/ModService'
import { useModTarget } from '@/composables/useModTarget'
import { notifyError, notifySuccess } from '@/utils/notify'
import { versionTypeLabel } from '@/utils/versionLabel'
import { downloadsText, gameText, loaderText, sizeText, skipLabel } from '@/utils/modText'

const mod = useModService()
const queue = useModDownloadService()
const envCheck = useEnvironmentCheckService()
const router = useRouter()
const {
    folderId,
    instanceId,
    folderOptions,
    instanceOptions,
    scope,
    installable,
    instanceFailure,
    instancesLoading,
    ready,
    pickFolder,
} = useModTarget()

/** 已装文件的多选，存磁盘上的真实文件名 */
const chosen = ref<string[]>([])
/** 检索命中的多选，存 slug：安装回传它，不回传用户输入的词 */
const wanted = ref<string[]>([])
const keyword = ref('')
const deps = ref(true)
const booted = ref(false)

const SEARCH_LIMIT = 20
const SKELETON_ROWS = [0, 1, 2, 3, 4]

const engineTooOld = computed(() => mod.apiChecked && !mod.supported)
const apiText = computed(() => (mod.apiVersion === null ? '未知' : String(mod.apiVersion)))
const modsPathEmpty = computed(() => mod.modsPath.length === 0)

const scopeText = computed(() => {
    const current = scope.value
    if (current === null) {
        return ''
    }
    const loader = current.loader === null ? '原版' : current.loader
    return `${current.gameVersion ?? '未知版本'} · ${loader}`
})

const canSearch = computed(
    () => booted.value && !mod.searching && scope.value !== null && keyword.value.trim().length > 0,
)

/* ---------- 已装 ---------- */

const disabledCount = computed(() => mod.files.length - mod.enabledCount)

const chosenFiles = computed(() => mod.files.filter((row) => chosen.value.includes(row.filename)))
const chosenEnabledCount = computed(() => chosenFiles.value.filter((row) => row.enabled).length)
const chosenDisabledCount = computed(() => chosenFiles.value.length - chosenEnabledCount.value)

/** 禁用取启用项，启用取禁用项，混选由 CLI 跳过不适用项 */
const canDisable = computed(
    () => !mod.mutating && chosenEnabledCount.value > 0 && scope.value !== null,
)
const canEnable = computed(
    () => !mod.mutating && chosenDisabledCount.value > 0 && scope.value !== null,
)
const canRemove = computed(
    () => !mod.mutating && chosenFiles.value.length > 0 && scope.value !== null,
)

const resolveText = computed(() => {
    const row = mod.resolveProgress
    return row === null ? '' : `${row.done}/${row.total}`
})

const mutationChanges = computed(() => mod.mutationReport?.changed ?? [])
const mutationSkips = computed(() => mod.mutationReport?.skipped ?? [])

/* ---------- 检索 ---------- */

const canInstall = computed(
    () =>
        scope.value !== null &&
        installable.value &&
        wanted.value.length > 0 &&
        !mod.installBusy &&
        !mod.mutating,
)

async function boot(): Promise<void> {
    await mod.checkApi()
    if (!mod.supported) {
        return
    }
    await ready()
    booted.value = true
    await syncTarget()
}

/** 换实例：两处多选都作废，已装列表重读 */
async function syncTarget(): Promise<void> {
    const current = scope.value
    if (current === null) {
        return
    }
    chosen.value = []
    wanted.value = []
    await mod.loadList(current)
    if (keyword.value.trim().length > 0) {
        await mod.search(current, keyword.value, SEARCH_LIMIT, true)
    }
}

async function runSearch(): Promise<void> {
    const current = scope.value
    if (current === null || keyword.value.trim().length === 0) {
        return
    }
    await mod.search(current, keyword.value, SEARCH_LIMIT)
}

function toggleHit(slug: string): void {
    wanted.value = wanted.value.includes(slug)
        ? wanted.value.filter((item) => item !== slug)
        : [...wanted.value, slug]
}

function toggleFile(filename: string): void {
    chosen.value = chosen.value.includes(filename)
        ? chosen.value.filter((item) => item !== filename)
        : [...chosen.value, filename]
}

function selectAll(): void {
    chosen.value = mod.files.map((row) => row.filename)
}

function clearAll(): void {
    chosen.value = []
}

async function startInstall(): Promise<void> {
    const current = scope.value
    if (current === null || wanted.value.length === 0 || !canInstall.value) {
        return
    }
    const targets = [...wanted.value]
    const ok = await mod.install(current, targets, { deps: deps.value })
    if (!ok) {
        const failure = mod.installFailure
        if (failure !== null) {
            notifyError(errorSummary(failure.code, failure.message, failure.retryable))
        }
        return
    }
    const failed = mod.installReport?.failed ?? []
    const done = (mod.installReport?.installs ?? []).length
    wanted.value = []
    if (failed.length > 0) {
        notifyError(`${failed.length} 个没装上 · ${failed[0].query}`)
        return
    }
    notifySuccess(`已安装 ${done} 个`)
}

/** 删除 / 禁用 / 启用都走同一条通道，结果里带改了哪些、跳过哪些 */
/** 入队：整批交给 CLI 的后台下载进程 */
async function enqueue(): Promise<void> {
    const current = scope.value
    if (current === null || wanted.value.length === 0 || !canInstall.value) {
        return
    }
    const ids = await queue.enqueue(current, [...wanted.value], deps.value)
    if (ids === null) {
        const failure = queue.failure
        if (failure !== null) {
            notifyError(errorSummary(failure.code, failure.message, failure.retryable))
        }
        return
    }
    wanted.value = []
    notifySuccess(`已加入下载队列 ${ids.length} 个`)
    void router.push('/download/mod')
}

async function act(action: ModAction): Promise<void> {
    const current = scope.value
    if (current === null || chosen.value.length === 0) {
        return
    }
    const targets = [...chosen.value]
    const ok = await mod.mutate(action, current, targets)
    if (!ok) {
        const failure = mod.mutationFailure
        if (failure !== null) {
            notifyError(errorSummary(failure.code, failure.message, failure.retryable))
        }
        return
    }
    const report = mod.mutationReport
    const changed = report?.changed.length ?? 0
    const skipped = report?.skipped.length ?? 0
    chosen.value = []
    if (skipped > 0) {
        notifyError(`${changed} 个已处理 · ${skipped} 个跳过`)
        return
    }
    notifySuccess(`已处理 ${changed} 个`)
}

/** 重取云端元数据：丢内存缓存并强刷中文名表 */
async function reloadCloud(): Promise<void> {
    const current = scope.value
    if (current === null || mod.listLoading || mod.listResolving) {
        return
    }
    await mod.loadList(current, { force: true, refreshNames: true })
}

/** 中文名表的缓存状态，引擎给了才有 */
const namesText = computed(() => {
    const meta = mod.namesMeta
    if (meta === null) {
        return ''
    }
    const parts: string[] = []
    // 表未托管时 count 为 0，隐藏该段
    if (typeof meta.count === 'number' && meta.count > 0) {
        parts.push(`${meta.count} 个中文名`)
    }
    if (typeof meta.updatedAt === 'string') {
        const at = new Date(meta.updatedAt)
        if (!Number.isNaN(at.getTime())) {
            parts.push(`更新于 ${at.toLocaleString()}`)
        }
    }
    return parts.join(' · ')
})

async function openMods(): Promise<void> {
    if (modsPathEmpty.value) {
        return
    }
    await openPath(mod.modsPath).catch(() => notifyError('打不开 MOD 文件夹'))
}

function toSingle(): void {
    void router.push('/mod/install')
}

/** 反查成功的用项目名，没反查到就退回文件名 */
/** 文件名前缀里的方括号名 */
const BRACKET_NAME = /^[\[【]([^\]】]+)[\]】]\s*/

function bracketNameOf(filename: string): string | null {
    const match = BRACKET_NAME.exec(filename)
    return match === null ? null : match[1].trim()
}

/** 去掉方括号名与扩展名的剩余部分 */
function bareNameOf(filename: string): string {
    const rest = filename.replace(BRACKET_NAME, '').replace(/\.jar(\.disabled)?$/i, '')
    return rest.length > 0 ? rest : filename
}

/** 中文名：中文名表优先，其次文件名方括号 */
function chineseNameOf(row: CliModFile): string | null {
    const fromTable = row.project?.titleZh ?? null
    if (fromTable !== null && fromTable.trim().length > 0) {
        return fromTable.trim()
    }
    return bracketNameOf(row.filename)
}

/** 第一行：中文名，其次项目名，最后文件名 */
function titleOf(row: CliModFile): string {
    return chineseNameOf(row) ?? row.project?.title ?? bareNameOf(row.filename)
}

/** 第二行：[英文名] · 版本 · 类型；与第一行同名时省略方括号 */
function subtitleOf(row: CliModFile): string {
    const english = row.project?.title ?? bareNameOf(row.filename)
    const parts: string[] = []
    if (english !== titleOf(row)) {
        parts.push(`[${english}]`)
    }
    if (row.version !== null) {
        parts.push(row.version.number, versionTypeLabel(row.version.type))
    }
    return parts.join(' · ')
}

function changeText(row: { from: string; to: string | null }): string {
    return row.to === null ? `${row.from} · 已删除` : `${row.from} → ${row.to}`
}

// 列表刷新后把已经不存在的文件从多选里摘掉
watch(
    () => mod.files,
    (rows) => {
        const names = new Set(rows.map((row) => row.filename))
        chosen.value = chosen.value.filter((name) => names.has(name))
    },
)

watch(folderId, (id) => {
    if (booted.value && id.length > 0) {
        void pickFolder(id)
    }
})

watch(instanceId, () => {
    if (booted.value) {
        void syncTarget()
    }
})

onMounted(boot)
</script>

<template>
    <main class="mod">
        <header class="mod__head">
            <BackButton fallback="/version/list" />
            <h1 class="mod__title">批量安装</h1>
            <GroupButton variant="ghost" :disabled="mod.installBusy || mod.mutating" @click="boot">
                {{ mod.searching ? '读取中' : '刷新' }}
            </GroupButton>
        </header>

        <p v-if="engineTooOld" class="mod__failure">
            <span class="mod__failure-code">引擎版本过低</span>
            <span class="mod__failure-detail">
                当前引擎 api {{ apiText }} · MOD 相关命令要 api {{ MOD_API_REQUIRED }} 起 · 升级：{{
                    envCheck.bloomeryInstallCommand('npm')
                }}
            </span>
        </p>

        <CollapsibleGroup label="目标" default-open>
            <GroupSelect
                v-model="folderId"
                label="游戏文件夹"
                :options="folderOptions"
                :disabled="mod.installBusy || mod.mutating"
            />
            <GroupSelect
                v-model="instanceId"
                label="实例"
                :options="instanceOptions"
                :disabled="mod.installBusy || mod.mutating || instancesLoading"
            />
            <p v-if="instanceFailure !== null" class="mod__failure">
                <span class="mod__failure-code">
                    {{
                        errorSummary(
                            instanceFailure.code,
                            instanceFailure.message,
                            instanceFailure.retryable,
                        )
                    }}
                </span>
                <span v-if="instanceFailure.detail" class="mod__failure-detail">
                    {{ instanceFailure.detail }}
                </span>
            </p>
            <p v-if="scope === null" class="mod__note">先选一个实例</p>
            <p v-else class="mod__note">操作落在：{{ scopeText }}</p>
        </CollapsibleGroup>

        <CollapsibleGroup v-if="booted && scope !== null" label="已装 MOD" default-open>
            <div v-if="mod.listLoading" class="mod__list" aria-busy="true">
                <div v-for="row in SKELETON_ROWS" :key="row" class="mod__row mod__wait">
                    <span
                        class="skeleton"
                        :style="{ width: `${28 + (row % 3) * 12}%`, height: '1rem' }"
                        aria-hidden="true"
                    ></span>
                    <span
                        class="skeleton"
                        :style="{ width: `${46 + (row % 2) * 16}%`, height: '0.9rem' }"
                        aria-hidden="true"
                    ></span>
                </div>
            </div>

            <p v-else-if="mod.listFailure !== null" class="mod__failure">
                <span class="mod__failure-code">
                    {{
                        errorSummary(
                            mod.listFailure.code,
                            mod.listFailure.message,
                            mod.listFailure.retryable,
                        )
                    }}
                </span>
                <span v-if="mod.listFailure.detail" class="mod__failure-detail">
                    {{ mod.listFailure.detail }}
                </span>
            </p>

            <template v-else>
                <div class="mod__cloud">
                    <span class="mod__note">
                        Bloomery 缓存元数据结果，重新加载获取最新
                        <template v-if="namesText.length > 0"> · {{ namesText }}</template>
                    </span>
                    <GroupButton
                        variant="ghost"
                        :disabled="mod.listLoading || mod.listResolving"
                        @click="reloadCloud"
                    >
                        重新加载云端元数据
                    </GroupButton>
                </div>

                <p class="mod__note">
                    已装 {{ mod.files.length }} 个 · 启用 {{ mod.enabledCount }} 个 · 禁用
                    {{ disabledCount }} 个{{
                        mod.listResolving ? ` · 反查项目 ${resolveText}` : ''
                    }}
                </p>

                <p v-if="mod.files.length === 0" class="mod__note">这个实例的 mods 目录是空的</p>

                <template v-else>
                    <div class="mod__toolbar">
                        <GroupButton variant="ghost" :disabled="mod.mutating" @click="selectAll">
                            全选
                        </GroupButton>
                        <GroupButton
                            variant="ghost"
                            :disabled="mod.mutating || chosen.length === 0"
                            @click="clearAll"
                        >
                            清空
                        </GroupButton>
                        <span class="mod__note">
                            已选 {{ chosen.length }} 个 · 启用 {{ chosenEnabledCount }} · 禁用
                            {{ chosenDisabledCount }}
                        </span>
                    </div>

                    <ul class="mod__list mod__list--tall">
                        <li v-for="row in mod.files" :key="row.filename">
                            <label
                                class="mod__row mod__pick"
                                :title="row.filename"
                                :class="{
                                    'mod__row--on': chosen.includes(row.filename),
                                    'mod__row--busy': mod.mutating,
                                }"
                            >
                                <input
                                    class="mod__check"
                                    type="checkbox"
                                    :checked="chosen.includes(row.filename)"
                                    :disabled="mod.mutating"
                                    @change="toggleFile(row.filename)"
                                />
                                <span class="mod__pick-body">
                                    <span class="mod__row-title">{{ titleOf(row) }}</span>
                                    <span v-if="subtitleOf(row).length > 0" class="mod__row-desc">
                                        {{ subtitleOf(row) }}
                                    </span>
                                    <span class="mod__row-tags">
                                        <span
                                            class="mod__tag"
                                            :class="{ 'mod__tag--off': !row.enabled }"
                                        >
                                            {{ row.enabled ? '启用' : '禁用' }}
                                        </span>
                                        <span class="mod__tag">{{ sizeText(row.size) }}</span>
                                        <span v-if="!row.resolved" class="mod__tag">未反查</span>
                                    </span>
                                </span>
                            </label>
                        </li>
                    </ul>

                    <div class="mod__actions">
                        <GroupButton :disabled="!canDisable" @click="act('disable')">
                            禁用选中
                        </GroupButton>
                        <GroupButton :disabled="!canEnable" @click="act('enable')">
                            启用选中
                        </GroupButton>
                        <GroupButton variant="danger" :disabled="!canRemove" @click="act('remove')">
                            删除选中
                        </GroupButton>
                        <GroupButton v-if="mod.mutating" variant="ghost" @click="mod.cancel">
                            取消
                        </GroupButton>
                        <GroupButton variant="ghost" :disabled="modsPathEmpty" @click="openMods">
                            打开 MOD 文件夹
                        </GroupButton>
                    </div>

                    <p v-if="mod.mutationFailure !== null" class="mod__failure">
                        <span class="mod__failure-code">
                            {{
                                errorSummary(
                                    mod.mutationFailure.code,
                                    mod.mutationFailure.message,
                                    mod.mutationFailure.retryable,
                                )
                            }}
                        </span>
                        <span v-if="mod.mutationFailure.detail" class="mod__failure-detail">
                            {{ mod.mutationFailure.detail }}
                        </span>
                    </p>

                    <div
                        v-if="mutationChanges.length > 0 || mutationSkips.length > 0"
                        class="mod__rows"
                    >
                        <div v-for="row in mutationChanges" :key="row.from" class="mod__row-item">
                            <span class="mod__key">已处理</span>
                            <span class="mod__value">{{ changeText(row) }}</span>
                        </div>
                        <div v-for="row in mutationSkips" :key="row.target" class="mod__row-item">
                            <span class="mod__key">跳过</span>
                            <span class="mod__value"
                                >{{ row.target }} · {{ skipLabel(row.reason) }}</span
                            >
                        </div>
                    </div>
                </template>
            </template>
        </CollapsibleGroup>

        <CollapsibleGroup v-if="booted && scope !== null" label="批量安装" default-open>
            <GroupInput
                v-model="keyword"
                label="关键词"
                placeholder="MOD 名称，例如 sodium"
                :disabled="mod.installBusy || engineTooOld"
                @keyup.enter="runSearch"
            />
            <GroupCheckbox v-model="deps" label="连必需依赖一起装" :disabled="mod.installBusy" />
            <p v-if="!installable" class="mod__note">原版实例，MOD 不加载 · 已装列表可管理</p>
            <p class="mod__note">
                Modrinth 公开接口 · 一次 {{ SEARCH_LIMIT }} 条 · 多选一次装，只拉起一次下载
            </p>
            <div class="mod__actions">
                <GroupButton :disabled="!canSearch" @click="runSearch">
                    {{ mod.searching ? '检索中' : '检索' }}
                </GroupButton>
            </div>

            <div v-if="mod.searching" class="mod__list" aria-busy="true">
                <div v-for="row in SKELETON_ROWS" :key="row" class="mod__row mod__wait">
                    <span
                        class="skeleton"
                        :style="{ width: `${32 + (row % 3) * 14}%`, height: '1.05rem' }"
                        aria-hidden="true"
                    ></span>
                    <span
                        class="skeleton"
                        :style="{ width: `${52 + (row % 2) * 18}%`, height: '0.9rem' }"
                        aria-hidden="true"
                    ></span>
                </div>
            </div>

            <p v-else-if="mod.searchFailure !== null" class="mod__failure">
                <span class="mod__failure-code">
                    {{
                        errorSummary(
                            mod.searchFailure.code,
                            mod.searchFailure.message,
                            mod.searchFailure.retryable,
                        )
                    }}
                </span>
                <span v-if="mod.searchFailure.detail" class="mod__failure-detail">
                    {{ mod.searchFailure.detail }}
                </span>
            </p>

            <p v-else-if="mod.searched && mod.hits.length === 0" class="mod__note">
                没有匹配的 MOD{{ scope === null ? '' : ' · 当前实例上过滤后为空' }}
            </p>

            <template v-else-if="mod.hits.length > 0">
                <p class="mod__note">命中 {{ mod.hits.length }} 个 · 已选 {{ wanted.length }} 个</p>
                <ul class="mod__list">
                    <li v-for="row in mod.hits" :key="row.id">
                        <label
                            class="mod__row mod__pick"
                            :class="{ 'mod__row--on': wanted.includes(row.slug) }"
                        >
                            <input
                                class="mod__check"
                                type="checkbox"
                                :checked="wanted.includes(row.slug)"
                                :disabled="mod.installBusy"
                                @change="toggleHit(row.slug)"
                            />
                            <span class="mod__row-head">
                                <span class="mod__row-title">{{ row.title }}</span>
                                <span class="mod__row-slug">{{ row.slug }}</span>
                                <span class="mod__row-meta">
                                    {{ downloadsText(row.downloads) }} 次下载
                                </span>
                            </span>
                            <span class="mod__row-desc">{{ row.description }}</span>
                            <span class="mod__row-tags">
                                <span class="mod__tag">{{ loaderText(row.loaders) }}</span>
                                <span class="mod__tag">{{ gameText(row.gameVersions) }}</span>
                            </span>
                        </label>
                    </li>
                </ul>

                <div class="mod__actions">
                    <GroupButton :disabled="!canInstall" @click="startInstall">
                        {{ mod.installBusy ? '安装中' : `安装已选的 ${wanted.length} 个` }}
                    </GroupButton>
                    <GroupButton v-if="mod.installBusy" variant="ghost" @click="mod.cancel">
                        取消
                    </GroupButton>
                    <GroupButton v-else variant="ghost" :disabled="!canInstall" @click="enqueue">
                        加入下载队列
                    </GroupButton>
                    <GroupButton variant="ghost" @click="toSingle">单装一个</GroupButton>
                </div>
            </template>
        </CollapsibleGroup>

        <ModProgress />
    </main>
</template>

<style scoped lang="scss">
@use './mod-page.scss';

// 已装列表一屏更高
.mod__list--tall {
    max-height: 40rem;
}

.mod__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
}

// 行内放复选框：勾选态与整行高亮同步
.mod__pick {
    flex-direction: row;
    align-items: flex-start;
    gap: 0.6rem;
}

// 云端元数据行：小字在左，按钮在右
.mod__cloud {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
}

// 命令运行中，行不可点
.mod__row--busy {
    cursor: default;
    opacity: 0.6;
}

// 复选框右侧一列
.mod__pick-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.2rem;

    min-width: 0;
}

// 禁用标签，随主题明暗调整
.mod__tag--off {
    color: color-mix(in srgb, #c62828 78%, var(--text-color));
}

.mod__check {
    flex: none;
    width: 1rem;
    height: 1rem;
    margin: 0.15rem 0 0;

    accent-color: var(--text-color);
}
</style>
