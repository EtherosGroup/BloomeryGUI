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
import { MOD_API_REQUIRED, type CliModHit } from '@/api/types'
import { useModService } from '@/stores/ModService'
import { useModTarget } from '@/composables/useModTarget'
import { notifyError, notifySuccess } from '@/utils/notify'
import { downloadsText, gameText, loaderText } from '@/utils/modText'

const mod = useModService()
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

const keyword = ref('')
/** 选中的命中项，存 slug：安装回传它，不回传用户输入的词 */
const picked = ref('')
const deps = ref(true)
/** 门禁与目标都已就绪，此时换实例才需要重取 */
const booted = ref(false)

/** 一次检索返回的条数 */
const SEARCH_LIMIT = 20
const SKELETON_ROWS = [0, 1, 2, 3, 4]

const selected = computed(() => mod.hits.find((row) => row.slug === picked.value) ?? null)

/** 探过引擎而且 api 不够 */
const engineTooOld = computed(() => mod.apiChecked && !mod.supported)
const apiText = computed(() => (mod.apiVersion === null ? '未知' : String(mod.apiVersion)))

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

/** 只有加载器实例能装，原版实例给不出加载器 */
const canInstall = computed(
    () => scope.value !== null && selected.value !== null && installable.value && !mod.installBusy,
)

const modsPathEmpty = computed(() => mod.modsPath.length === 0)

const failedEntries = computed(() => mod.installReport?.failed ?? [])

async function boot(): Promise<void> {
    await mod.checkApi()
    if (!mod.supported) {
        return
    }
    await ready()
    booted.value = true
    await syncTarget()
}

/** 换实例：旧命中作废，已装列表重读；关键词还在就按新实例再检一次 */
async function syncTarget(): Promise<void> {
    const current = scope.value
    if (current === null) {
        return
    }
    picked.value = ''
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

function pick(hit: CliModHit): void {
    picked.value = hit.slug
}

async function startInstall(): Promise<void> {
    const current = scope.value
    const hit = selected.value
    if (current === null || hit === null || !canInstall.value) {
        return
    }
    // 传 slug：CLI 对像 slug 的目标按项目取，传搜索词会落到搜索排名第一的项目
    const ok = await mod.install(current, [hit.slug], { deps: deps.value })
    if (!ok) {
        const failure = mod.installFailure
        if (failure !== null) {
            notifyError(
                failureText(failure.code, failure.message, failure.retryable, failure.detail),
            )
        }
        return
    }
    const failed = failedEntries.value
    if (failed.length > 0) {
        notifyError(`${failed[0].query} 装不上 · ${errorSummary(failed[0].code, failed[0].detail)}`)
        return
    }
    notifySuccess(`已安装 · ${hit.title}`)
}

async function cancel(): Promise<void> {
    await mod.cancel()
}

async function openMods(): Promise<void> {
    if (modsPathEmpty.value) {
        return
    }
    await openPath(mod.modsPath).catch(() => notifyError('打不开 MOD 文件夹'))
}

function toBatch(): void {
    void router.push('/mod/batch-install')
}

function failureText(
    code: string,
    message: string,
    retryable: boolean,
    detail: string | null,
): string {
    const head = errorSummary(code, message, retryable)
    return detail === null ? head : `${head} · ${detail}`
}

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
            <h1 class="mod__title">安装模组</h1>
            <GroupButton variant="ghost" :disabled="mod.installBusy" @click="boot">
                {{ mod.searching ? '读取中' : '刷新' }}
            </GroupButton>
        </header>

        <p v-if="engineTooOld" class="mod__failure">
            <span class="mod__failure-code">引擎版本过低</span>
            <span class="mod__failure-detail">
                当前引擎 api {{ apiText }} · MOD 相关命令要 api {{ MOD_API_REQUIRED }} 起 ·
                升级：npm update -g bloomery
            </span>
        </p>

        <CollapsibleGroup label="目标" default-open>
            <GroupSelect
                v-model="folderId"
                label="游戏文件夹"
                :options="folderOptions"
                :disabled="mod.installBusy"
            />
            <GroupSelect
                v-model="instanceId"
                label="实例"
                :options="instanceOptions"
                :disabled="mod.installBusy || instancesLoading"
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
            <template v-else>
                <p class="mod__note">在当前实例上检索：{{ scopeText }}</p>
                <p v-if="!installable" class="mod__note">原版实例，MOD 不加载 · 加载器实例可用</p>
            </template>
        </CollapsibleGroup>

        <CollapsibleGroup label="检索" default-open>
            <GroupInput
                v-model="keyword"
                label="关键词"
                placeholder="MOD 名称，例如 sodium"
                :disabled="mod.installBusy || engineTooOld"
                @keyup.enter="runSearch"
            />
            <GroupCheckbox v-model="deps" label="连必需依赖一起装" :disabled="mod.installBusy" />
            <p class="mod__note">
                Modrinth 公开接口 · 一次 {{ SEARCH_LIMIT }} 条{{
                    scope === null ? '' : ' · 已经在当前实例上过滤'
                }}
            </p>
            <div class="mod__actions">
                <GroupButton :disabled="!canSearch" @click="runSearch">
                    {{ mod.searching ? '检索中' : '检索' }}
                </GroupButton>
            </div>
        </CollapsibleGroup>

        <CollapsibleGroup
            v-if="mod.searching || mod.searched || mod.searchFailure !== null"
            label="检索结果"
            default-open
        >
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

            <p v-else-if="mod.hits.length === 0" class="mod__note">
                没有匹配的 MOD{{ scope === null ? '' : ' · 当前实例上过滤后为空' }}
            </p>

            <template v-else>
                <p class="mod__note">命中 {{ mod.hits.length }} 个</p>
                <ul class="mod__list">
                    <li v-for="row in mod.hits" :key="row.id">
                        <button
                            type="button"
                            class="mod__row"
                            :class="{ 'mod__row--on': row.slug === picked }"
                            :disabled="mod.installBusy"
                            @click="pick(row)"
                        >
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
                        </button>
                    </li>
                </ul>

                <div class="mod__actions">
                    <GroupButton :disabled="!canInstall" @click="startInstall">
                        {{ mod.installBusy ? '安装中' : '安装选中' }}
                    </GroupButton>
                    <GroupButton v-if="mod.installBusy" variant="ghost" @click="cancel">
                        取消
                    </GroupButton>
                </div>
            </template>
        </CollapsibleGroup>

        <ModProgress />

        <CollapsibleGroup v-if="booted && scope !== null" label="这个实例已装" default-open>
            <div v-if="mod.listLoading" class="mod__list" aria-busy="true">
                <div v-for="row in SKELETON_ROWS" :key="row" class="mod__row mod__wait">
                    <span
                        class="skeleton"
                        :style="{ width: `${30 + (row % 3) * 12}%`, height: '1rem' }"
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
                <p class="mod__note">
                    已装 {{ mod.files.length }} 个 · 启用 {{ mod.enabledCount }} 个{{
                        mod.listResolving ? ' · 反查中' : ''
                    }}
                </p>
                <div class="mod__actions">
                    <GroupButton variant="ghost" @click="toBatch">批量管理</GroupButton>
                    <GroupButton variant="ghost" :disabled="modsPathEmpty" @click="openMods">
                        打开 MOD 文件夹
                    </GroupButton>
                </div>
            </template>
        </CollapsibleGroup>
    </main>
</template>

<style scoped lang="scss">
@use './mod-page.scss';
</style>
