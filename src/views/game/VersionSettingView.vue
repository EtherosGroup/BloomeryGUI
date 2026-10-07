<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BackButton from '@/components/BackButton.vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import { BloomeryError } from '@/api/bloomery'
import { errorSummary } from '@/api/errorMessages'
import { ensureDirectory } from '@/api/files'
import { openPath } from '@/api/system'
import type { CliInstance } from '@/api/types'
import { useCli } from '@/composables/useCli'
import { useVersionService } from '@/stores/VersionService'
import { lastPlayedLabel, loaderLabel, stateLabel, versionTypeLabel } from '@/utils/versionLabel'
import { notifyError, notifySuccess } from '@/utils/notify'

interface CliInstanceInfo extends CliInstance {
    folder: string
    descriptor: Record<string, unknown>
}

interface Failure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封，可重试才有意义 */
    retryable: boolean
}

const route = useRoute()
const router = useRouter()
const versionService = useVersionService()
const instanceId = computed(() => decodeURIComponent(String(route.params.instanceId ?? '')))
/** 文件夹 id：路由里带就用它，旧的两段式链接回落到当前文件夹 */
const folderFromRoute = computed(() => decodeURIComponent(String(route.params.folderId ?? '')))

const info = ref<CliInstanceInfo | null>(null)
const folderId = ref('')
/** 全局上限，只作对照 */
const globalMaxMb = ref<number | null>(null)
const instanceMaxMb = ref<number | null>(null)
/** 实例自定义启动参数 */
const instanceJvmArgs = ref<string[]>([])
/** 全局 JVM 参数，只作对照 */
const globalJvmArgs = ref<string[]>([])
const failure = ref<Failure | null>(null)
const busy = ref(false)
const editing = ref('')
const draft = ref<string | number>('')

/** 重命名草稿 */
const nameDraft = ref('')

function toFailure(error: unknown): Failure {
    return error instanceof BloomeryError
        ? {
              code: error.code,
              message: error.message,
              detail: error.detail,
              retryable: error.retryable,
          }
        : { code: 'Unknown', message: String(error), detail: null, retryable: false }
}

interface FolderEntry {
    key: string
    label: string
    path: string
    /** 打开前先建目录 */
    create: boolean
}

/** 实例目录下的子目录：隔离布局，mods 与 saves 都在实例目录里 */
function childOf(base: string, name: string): string {
    const separator = base.includes('\\') ? '\\' : '/'
    return `${base.replace(/[\\/]+$/, '')}${separator}${name}`
}

const folders = computed<FolderEntry[]>(() => {
    const directory = info.value?.directory ?? ''
    return [
        { key: 'instance', label: '实例文件夹', path: directory, create: false },
        {
            key: 'mods',
            label: 'mod 文件夹',
            path: directory.length > 0 ? childOf(directory, 'mods') : '',
            create: true,
        },
        {
            key: 'saves',
            label: '存档文件夹',
            path: directory.length > 0 ? childOf(directory, 'saves') : '',
            create: true,
        },
    ]
})

/** 用系统默认程序打开目录 */
async function openFolder(folder: FolderEntry): Promise<void> {
    if (folder.path.length === 0) {
        return
    }
    try {
        if (folder.create) {
            await ensureDirectory(folder.path)
        }
        await openPath(folder.path)
    } catch (error) {
        notifyError(`打开文件夹失败 · ${String(error)}`)
    }
}

/** 实例级寻址：id 可含点号，走 --folder / --instance */
function instanceArgs(rest: string[]): string[] {
    return [...rest, ...folderArgs(), '--instance', instanceId.value]
}

/** 文件夹级寻址 */
function folderArgs(): string[] {
    return ['--folder', folderId.value]
}

async function readValue(args: string[]): Promise<unknown> {
    const client = await useCli().client()
    const result = await client.run<{ key: string; value: unknown }>(['config', 'get', ...args], {
        progress: false,
    })
    return result.value
}

async function readConfig(args: string[]): Promise<number | null> {
    const value = await readValue(args)
    return typeof value === 'number' ? value : null
}

/** 字符串数组类配置，取不到按空处理 */
async function readArgs(args: string[]): Promise<string[]> {
    const value = await readValue(args)
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
}

/** 重读全局值、实例覆盖值与启动参数 */
async function refreshValues(): Promise<void> {
    globalMaxMb.value = await readConfig(['launch.memory.maxMb'])
    instanceMaxMb.value = await readConfig(instanceArgs(['memory.maxMb']))
    globalJvmArgs.value = await readArgs(['launch.jvmArgs'])
    instanceJvmArgs.value = await readArgs(instanceArgs(['jvmArgs']))
}

async function load(): Promise<void> {
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        info.value = await client.run<CliInstanceInfo>(['version', 'info', instanceId.value], {
            progress: false,
        })
        folderId.value =
            folderFromRoute.value.length > 0
                ? folderFromRoute.value
                : (await client.run<{ id: string }>(['version', 'list'], { progress: false })).id
        await refreshValues()
    } catch (error) {
        info.value = null
        failure.value = toFailure(error)
    } finally {
        busy.value = false
    }
}

function startEdit(value: number | null): void {
    editing.value = 'instance'
    draft.value = value === null ? '' : String(value)
}

/** 空格分隔，双引号包住带空格的整段 */
function parseArgs(text: string): string[] {
    const rows: string[] = []
    for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
        rows.push(match[1] ?? match[2] ?? '')
    }
    return rows
}

/** 带空格的整段加回引号，来回编辑不丢边界 */
function argsText(rows: string[]): string {
    return rows.map((row) => (/\s/.test(row) ? `"${row}"` : row)).join(' ')
}

/** 进入启动参数编辑态，草稿预填当前值 */
function startEditArgs(): void {
    editing.value = 'args'
    draft.value = argsText(instanceJvmArgs.value)
}

/** 进入改名编辑态，草稿预填当前名 */
function startRename(): void {
    nameDraft.value = info.value?.id ?? instanceId.value
    editing.value = 'name'
}

/** 写实例覆盖，成功后重读 */
async function commit(): Promise<void> {
    // 数字输入框的 v-model 可能是 number，统一按字符串处理
    const value = String(draft.value ?? '').trim()
    if (value.length === 0) {
        editing.value = ''
        return
    }
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        await client.run(['config', 'set', ...instanceArgs(['memory.maxMb', value])], {
            progress: false,
        })
        await refreshValues()
        editing.value = ''
    } catch (error) {
        failure.value = toFailure(error)
    } finally {
        busy.value = false
    }
}

/** 清除实例覆盖 */
async function reset(): Promise<void> {
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        await client.run(['config', 'unset', ...instanceArgs(['memory.maxMb'])], {
            progress: false,
        })
        await refreshValues()
    } catch (error) {
        failure.value = toFailure(error)
    } finally {
        busy.value = false
    }
}

/** 写实例启动参数：CLI 收 JSON 数组 */
async function commitArgs(): Promise<void> {
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        const value = JSON.stringify(parseArgs(String(draft.value ?? '')))
        await client.run(['config', 'set', ...instanceArgs(['jvmArgs', value])], {
            progress: false,
        })
        await refreshValues()
        editing.value = ''
    } catch (error) {
        failure.value = toFailure(error)
    } finally {
        busy.value = false
    }
}

/** 清除实例启动参数 */
async function resetArgs(): Promise<void> {
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        await client.run(['config', 'unset', ...instanceArgs(['jvmArgs'])], { progress: false })
        await refreshValues()
    } catch (error) {
        failure.value = toFailure(error)
    } finally {
        busy.value = false
    }
}

/** 重命名实例，成功后跟随新 id */
async function rename(): Promise<void> {
    const next = String(nameDraft.value ?? '').trim()
    const current = info.value?.id ?? instanceId.value
    if (next.length === 0 || next === current) {
        editing.value = ''
        return
    }
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        const result = await client.run<{
            id: string
            from: string
            rewritten?: string[]
        }>(['version', 'rename', current, next, ...folderArgs()], { progress: false })
        editing.value = ''
        const rewritten = result.rewritten?.length ?? 0
        notifySuccess(rewritten > 0 ? `实例已改名 · 继承引用同步 ${rewritten} 处` : '实例已改名')
        // 列表缓存与页面 id 都要跟着换
        await versionService.load()
        await router.replace(`/version/${encodeURIComponent(result.id)}/setting`)
    } catch (error) {
        failure.value = toFailure(error)
    } finally {
        busy.value = false
    }
}

onMounted(load)
watch(instanceId, load)
</script>

<template>
    <main class="setting">
        <header class="setting__head">
            <BackButton fallback="/version/list" />
            <h1 class="setting__title">{{ info?.name ?? instanceId }}</h1>
            <GroupButton variant="ghost" :disabled="busy" @click="load">
                {{ busy ? '读取中' : '刷新' }}
            </GroupButton>
        </header>

        <p v-if="failure" class="setting__failure">
            <span class="setting__failure-code">{{
                errorSummary(failure.code, failure.message, failure.retryable)
            }}</span>
            <span v-if="failure.detail" class="setting__failure-detail">{{ failure.detail }}</span>
        </p>

        <template v-if="info">
            <CollapsibleGroup label="实例名" default-open>
                <div class="setting__rows">
                    <div class="setting__row">
                        <span class="setting__key">实例名</span>
                        <span class="setting__value">
                            <template v-if="editing === 'name'">
                                <GroupInput
                                    v-model="nameDraft"
                                    placeholder="新实例名"
                                    :disabled="busy"
                                />
                                <GroupButton variant="ghost" :disabled="busy" @click="rename">
                                    保存
                                </GroupButton>
                                <GroupButton variant="ghost" @click="editing = ''"
                                    >取消</GroupButton
                                >
                            </template>
                            <template v-else>
                                {{ info.id }}
                                <GroupButton variant="ghost" :disabled="busy" @click="startRename">
                                    修改
                                </GroupButton>
                            </template>
                        </span>
                    </div>
                </div>
                <p class="setting__note">改名会同步目录、实例配置键与选中引用</p>
            </CollapsibleGroup>

            <CollapsibleGroup label="实例信息" default-open>
                <div class="setting__rows">
                    <div class="setting__row">
                        <span class="setting__key">实例 id</span>
                        <span class="setting__value setting__value--path">{{ info.id }}</span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">游戏版本</span>
                        <span class="setting__value">{{ info.gameVersion ?? '未知' }}</span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">加载器</span>
                        <span class="setting__value">{{ loaderLabel(info) }}</span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">类型</span>
                        <span class="setting__value">{{ versionTypeLabel(info.type) }}</span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">状态</span>
                        <span class="setting__value">
                            {{ stateLabel(info.state) }}
                            <template v-if="info.problem"> · {{ info.problem }}</template>
                        </span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">Java</span>
                        <span class="setting__value">
                            要求 {{ info.java.required?.major ?? '未知' }}
                        </span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">上次启动</span>
                        <span class="setting__value">{{ lastPlayedLabel(info.lastPlayed) }}</span>
                    </div>
                </div>
            </CollapsibleGroup>

            <CollapsibleGroup label="文件夹" default-open>
                <div class="setting__rows">
                    <div v-for="folder in folders" :key="folder.key" class="setting__row">
                        <span class="setting__key">{{ folder.label }}</span>
                        <span class="setting__value setting__value--path">{{
                            folder.path || '未知'
                        }}</span>
                        <GroupButton
                            variant="ghost"
                            :disabled="busy || folder.path.length === 0"
                            @click="openFolder(folder)"
                        >
                            打开
                        </GroupButton>
                    </div>
                </div>
                <p class="setting__note">mod 与存档文件夹缺失时先建目录</p>
            </CollapsibleGroup>

            <CollapsibleGroup label="内存" default-open>
                <div class="setting__rows">
                    <div class="setting__row">
                        <span class="setting__key">实例上限</span>
                        <span class="setting__value">
                            <template v-if="editing === 'instance'">
                                <GroupInput v-model="draft" type="number" placeholder="MB" />
                                <GroupButton variant="ghost" :disabled="busy" @click="commit">
                                    保存
                                </GroupButton>
                                <GroupButton variant="ghost" @click="editing = ''"
                                    >取消</GroupButton
                                >
                            </template>
                            <template v-else>
                                {{ instanceMaxMb === null ? '未设置' : `${instanceMaxMb} MB` }}
                                <GroupButton
                                    variant="ghost"
                                    :disabled="busy"
                                    @click="startEdit(instanceMaxMb)"
                                >
                                    修改
                                </GroupButton>
                                <GroupButton
                                    variant="ghost"
                                    :disabled="busy || instanceMaxMb === null"
                                    @click="reset"
                                >
                                    清除
                                </GroupButton>
                            </template>
                        </span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">当前生效</span>
                        <span class="setting__value setting__value--muted">
                            {{ instanceMaxMb ?? globalMaxMb ?? 0 }} MB
                            <template v-if="instanceMaxMb === null">· 跟随全局</template>
                        </span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">全局上限</span>
                        <span class="setting__value setting__value--muted">
                            {{ globalMaxMb === null ? '未知' : `${globalMaxMb} MB` }} · 只读
                        </span>
                    </div>
                </div>
                <p class="setting__note">
                    全局参数在「引擎设置」页修改 · 本页 config memory.maxMb --folder
                    {{ folderId || '<文件夹>' }} --instance {{ info.id }}
                </p>
            </CollapsibleGroup>

            <CollapsibleGroup label="启动参数" default-open>
                <div class="setting__rows">
                    <div class="setting__row">
                        <span class="setting__key">自定义</span>
                        <span class="setting__value">
                            <template v-if="editing === 'args'">
                                <GroupInput
                                    v-model="draft"
                                    placeholder="-XX:+UseG1GC -Dfile.encoding=UTF-8"
                                    :disabled="busy"
                                />
                                <GroupButton variant="ghost" :disabled="busy" @click="commitArgs">
                                    保存
                                </GroupButton>
                                <GroupButton variant="ghost" @click="editing = ''"
                                    >取消</GroupButton
                                >
                            </template>
                            <template v-else>
                                {{
                                    instanceJvmArgs.length === 0
                                        ? '未设置'
                                        : argsText(instanceJvmArgs)
                                }}
                                <GroupButton
                                    variant="ghost"
                                    :disabled="busy"
                                    @click="startEditArgs"
                                >
                                    修改
                                </GroupButton>
                                <GroupButton
                                    variant="ghost"
                                    :disabled="busy || instanceJvmArgs.length === 0"
                                    @click="resetArgs"
                                >
                                    清除
                                </GroupButton>
                            </template>
                        </span>
                    </div>
                    <div class="setting__row">
                        <span class="setting__key">全局 JVM</span>
                        <span class="setting__value setting__value--muted">
                            {{ globalJvmArgs.length === 0 ? '未设置' : argsText(globalJvmArgs) }} ·
                            只读
                        </span>
                    </div>
                </div>
                <p class="setting__note">
                    空格分隔，双引号可包住一整段 · 启动时先给全局 JVM 参数，再接本实例的参数 ·
                    config jvmArgs --folder {{ folderId || '<文件夹>' }} --instance {{ info.id }}
                </p>
            </CollapsibleGroup>
        </template>
    </main>
</template>

<style scoped lang="scss">
.setting {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 46rem;
    padding: 1.5rem;
}

.setting__head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.setting__title {
    flex: 1;
    margin: 0;

    font-size: var(--font-size-3xl);
    word-break: break-all;
}

.setting__failure {
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

.setting__failure-code {
    font-weight: 600;
}

.setting__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.setting__rows {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
}

.setting__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    font-size: var(--font-size-sm);
}

.setting__key {
    flex: 0 0 6rem;

    color: var(--text-color-dark);
}

.setting__value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    flex: 1;

    word-break: break-all;
}

.setting__value--muted {
    color: var(--text-color-dark);
}

.setting__value--path {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);
}

.setting__note {
    margin: 0;

    color: var(--text-color-dark);
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);

    word-break: break-all;
}
</style>
