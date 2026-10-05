<script setup lang="ts">
import { onMounted, ref } from 'vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import GroupSelect from '@/components/GroupSelect.vue'
import GroupSwitch from '@/components/GroupSwitch.vue'
import { BloomeryError } from '@/api/bloomery'
import { errorSummary } from '@/api/errorMessages'
import { useCli } from '@/composables/useCli'
import type { ChoiceOptionType } from '@/types/ChoiceOptionType'
import { notifyError } from '@/utils/notify'

/** 控件类型：开关、枚举、整数、文本、JSON 字面量 */
type FieldKind = 'switch' | 'select' | 'number' | 'text' | 'json'

interface Field {
    /** 全局点分键 */
    key: string
    label: string
    kind: FieldKind
    options?: ChoiceOptionType[]
    /** 整数下界，来自 CLI 的校验 */
    min?: number
    /** 可置 null */
    nullable?: boolean
    placeholder?: string
    hint?: string
}

interface Section {
    label: string
    fields: Field[]
}

interface Failure {
    code: string
    message: string
    detail: string | null
}

function options(entries: [string, string][]): ChoiceOptionType[] {
    return entries.map(([value, label]) => ({ value, label }))
}

/** 键与取值范围照 src/config/setting.ts，不自行编造 */
const sections: Section[] = [
    {
        label: '外观',
        fields: [
            { key: 'language', label: '语言', kind: 'text', placeholder: 'system' },
            {
                key: 'appearance.color',
                label: '颜色输出',
                kind: 'select',
                options: options([
                    ['auto', '自动'],
                    ['always', '始终'],
                    ['never', '从不'],
                ]),
            },
            { key: 'appearance.unicode', label: 'Unicode 符号', kind: 'switch' },
            {
                key: 'appearance.progress',
                label: '进度样式',
                kind: 'select',
                options: options([
                    ['bar', '进度条'],
                    ['plain', '纯文本'],
                    ['off', '关闭'],
                ]),
            },
        ],
    },
    {
        label: '日志',
        fields: [
            { key: 'log.enabled', label: '写日志', kind: 'switch' },
            {
                key: 'log.level',
                label: '级别',
                kind: 'select',
                options: options([
                    ['debug', 'debug'],
                    ['info', 'info'],
                    ['warning', 'warning'],
                    ['error', 'error'],
                    ['silent', 'silent'],
                ]),
            },
            {
                key: 'log.directory',
                label: '日志目录',
                kind: 'text',
                nullable: true,
                placeholder: '留空即清空',
            },
            { key: 'log.keep', label: '保留份数', kind: 'number', hint: '-1 表示不限' },
        ],
    },
    {
        label: '网络',
        fields: [
            {
                key: 'network.proxy',
                label: '代理',
                kind: 'text',
                nullable: true,
                placeholder: '留空即清空',
            },
            { key: 'network.timeoutMs', label: '超时（毫秒）', kind: 'number', min: 1000 },
            { key: 'network.retries', label: '重试次数', kind: 'number', min: 0 },
            { key: 'network.concurrency', label: '并发下载数', kind: 'number', min: 1 },
        ],
    },
    {
        label: '下载',
        fields: [
            {
                key: 'download.verify',
                label: '校验强度',
                kind: 'select',
                options: options([
                    ['strict', '严格'],
                    ['warn', '仅告警'],
                    ['off', '关闭'],
                ]),
            },
        ],
    },
    {
        label: 'Java',
        fields: [
            { key: 'java.autoDetect', label: '自动探测', kind: 'switch' },
            { key: 'java.autoDownload', label: '自动下载', kind: 'switch' },
            {
                key: 'java.runtimeDirectory',
                label: '运行时目录',
                kind: 'text',
                nullable: true,
                placeholder: '留空即清空',
            },
        ],
    },
    {
        label: '启动',
        fields: [
            { key: 'launch.memory.minMb', label: '内存下限 MB', kind: 'number', min: 128 },
            { key: 'launch.memory.maxMb', label: '内存上限 MB', kind: 'number', min: 512 },
            { key: 'launch.window.width', label: '窗口宽', kind: 'number', min: 320 },
            { key: 'launch.window.height', label: '窗口高', kind: 'number', min: 240 },
            { key: 'launch.window.fullscreen', label: '全屏', kind: 'switch' },
            {
                key: 'launch.jvmArgs',
                label: 'JVM 参数',
                kind: 'json',
                placeholder: '["-XX:+UseG1GC"]',
                hint: 'JSON 数组，整体替换',
            },
            {
                key: 'launch.gameArgs',
                label: '游戏参数',
                kind: 'json',
                placeholder: '["--demo"]',
                hint: 'JSON 数组，整体替换',
            },
        ],
    },
]

/** 由其它命令维护的键，这里只读 */
const managedKeys: { label: string; entry: string }[] = [
    { label: '默认账户 selectedAccount', entry: 'auth login / auth use / auth logout' },
    { label: '当前文件夹 selectedFolder', entry: 'folder select' },
    { label: '当前实例 selectedInstance', entry: 'version select' },
    { label: 'Java 列表 java.list', entry: 'java add / java remove / java scan' },
    { label: '下载源 download.sources', entry: 'mirror use' },
]

const config = ref<Record<string, unknown> | null>(null)
const failure = ref<Failure | null>(null)
const busy = ref(false)
const editing = ref('')
const draft = ref<string | number>('')

/** 按点分键取值 */
function valueAt(key: string): unknown {
    let cursor: unknown = config.value
    for (const segment of key.split('.')) {
        if (cursor === null || typeof cursor !== 'object') {
            return undefined
        }
        cursor = (cursor as Record<string, unknown>)[segment]
    }
    return cursor
}

function textAt(key: string): string {
    const value = valueAt(key)
    if (value === null || value === undefined) {
        return '未设置'
    }
    if (Array.isArray(value)) {
        return value.length === 0 ? '空' : JSON.stringify(value)
    }
    if (typeof value === 'object') {
        return JSON.stringify(value)
    }
    return String(value)
}

function booleanAt(key: string): boolean {
    return valueAt(key) === true
}

function toFailure(error: unknown): Failure {
    return error instanceof BloomeryError
        ? { code: error.code, message: error.message, detail: error.detail }
        : { code: 'Unknown', message: String(error), detail: null }
}

async function read(): Promise<void> {
    const client = await useCli().client()
    const result = await client.run<{ config: Record<string, unknown> }>(['config', 'get'], {
        progress: false,
    })
    config.value = result.config
}

async function load(): Promise<void> {
    busy.value = true
    failure.value = null
    try {
        await read()
    } catch (error) {
        config.value = null
        failure.value = toFailure(error)
    } finally {
        busy.value = false
    }
}

function report(error: unknown, quiet: boolean): void {
    const next = toFailure(error)
    failure.value = next
    if (quiet) {
        const detail = next.detail === null ? '' : ` · ${next.detail}`
        notifyError(`${errorSummary(next.code, next.message)}${detail}`)
    }
}

/** 写全局键，文本类强制当字符串 */
async function write(field: Field, value: string, quiet = false): Promise<void> {
    if (field.kind === 'number') {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || (field.min !== undefined && parsed < field.min)) {
            failure.value = {
                code: 'UsageError',
                message: '取值不合法',
                detail: field.min === undefined ? '需要整数' : `需要不小于 ${field.min} 的整数`,
            }
            return
        }
    }
    if (field.kind === 'json' && value.trim().length > 0) {
        try {
            const parsed: unknown = JSON.parse(value)
            if (!Array.isArray(parsed)) {
                throw new Error('需要数组')
            }
        } catch {
            failure.value = { code: 'UsageError', message: '取值不合法', detail: '需要 JSON 数组' }
            return
        }
    }
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        const args = ['config', 'set', field.key, value]
        // null 是 JSON 字面量，不能被 --string 当成字符串
        if (value !== 'null' && (field.kind === 'text' || field.kind === 'select')) {
            args.push('--string')
        }
        await client.run(args, { progress: false })
        await read()
        editing.value = ''
    } catch (error) {
        report(error, quiet)
    } finally {
        busy.value = false
    }
}

/** 开关与枚举改动即写 */
function writeNow(field: Field, value: string): void {
    void write(field, value, true)
}

/** 清空为 null */
async function clear(field: Field): Promise<void> {
    await write(field, 'null')
}

/** 恢复默认 */
async function restore(field: Field): Promise<void> {
    busy.value = true
    failure.value = null
    try {
        const client = await useCli().client()
        await client.run(['config', 'unset', field.key], { progress: false })
        await read()
        editing.value = ''
    } catch (error) {
        report(error, true)
    } finally {
        busy.value = false
    }
}

function startEdit(field: Field): void {
    editing.value = field.key
    const value = valueAt(field.key)
    if (value === null || value === undefined) {
        draft.value = ''
        return
    }
    draft.value = Array.isArray(value) ? JSON.stringify(value) : String(value)
}

onMounted(load)
</script>

<template>
    <main class="bloomery-setting">
        <header class="bloomery-setting__head">
            <h1 class="bloomery-setting__title">引擎设置</h1>
            <GroupButton variant="ghost" :disabled="busy" @click="load">
                {{ busy ? '读取中' : '刷新' }}
            </GroupButton>
        </header>

        <p v-if="failure" class="bloomery-setting__failure">
            <span class="bloomery-setting__failure-code">{{
                errorSummary(failure.code, failure.message)
            }}</span>
            <span v-if="failure.detail" class="bloomery-setting__failure-detail">{{
                failure.detail
            }}</span>
        </p>

        <template v-if="config">
            <CollapsibleGroup
                v-for="section in sections"
                :key="section.label"
                :label="section.label"
            >
                <div class="bloomery-setting__rows">
                    <div
                        v-for="field in section.fields"
                        :key="field.key"
                        class="bloomery-setting__row"
                    >
                        <span class="bloomery-setting__key" :title="field.key">{{
                            field.label
                        }}</span>

                        <span class="bloomery-setting__value">
                            <GroupSwitch
                                v-if="field.kind === 'switch'"
                                :model-value="booleanAt(field.key)"
                                :disabled="busy"
                                @update:model-value="writeNow(field, String($event))"
                            />

                            <GroupSelect
                                v-else-if="field.kind === 'select'"
                                :model-value="textAt(field.key)"
                                :options="field.options ?? []"
                                :disabled="busy"
                                @update:model-value="writeNow(field, String($event))"
                            />

                            <template v-else-if="editing === field.key">
                                <GroupInput
                                    v-model="draft"
                                    :type="field.kind === 'number' ? 'number' : 'text'"
                                    :placeholder="field.placeholder"
                                    :disabled="busy"
                                />
                                <GroupButton
                                    variant="ghost"
                                    :disabled="busy"
                                    @click="write(field, String(draft ?? ''))"
                                >
                                    保存
                                </GroupButton>
                                <GroupButton variant="ghost" :disabled="busy" @click="clear(field)">
                                    清空
                                </GroupButton>
                                <GroupButton variant="ghost" @click="editing = ''"
                                    >取消</GroupButton
                                >
                            </template>

                            <template v-else>
                                <span class="bloomery-setting__shown">{{ textAt(field.key) }}</span>
                                <GroupButton
                                    variant="ghost"
                                    :disabled="busy"
                                    @click="startEdit(field)"
                                >
                                    修改
                                </GroupButton>
                                <GroupButton
                                    variant="ghost"
                                    :disabled="busy"
                                    @click="restore(field)"
                                >
                                    恢复默认
                                </GroupButton>
                            </template>
                        </span>

                        <span v-if="field.hint" class="bloomery-setting__hint">{{
                            field.hint
                        }}</span>
                    </div>
                </div>
            </CollapsibleGroup>

            <CollapsibleGroup label="由其它命令维护">
                <div class="bloomery-setting__rows">
                    <div
                        v-for="item in managedKeys"
                        :key="item.label"
                        class="bloomery-setting__row"
                    >
                        <span class="bloomery-setting__key">{{ item.label }}</span>
                        <span class="bloomery-setting__value bloomery-setting__value--muted">{{
                            item.entry
                        }}</span>
                    </div>
                </div>
            </CollapsibleGroup>
        </template>
    </main>
</template>

<style scoped lang="scss">
.bloomery-setting {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 46rem;
    padding: 1.5rem;
}

.bloomery-setting__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}

.bloomery-setting__title {
    margin: 0;

    font-size: var(--font-size-3xl);
}

.bloomery-setting__failure {
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

.bloomery-setting__failure-code {
    font-weight: 600;
}

.bloomery-setting__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.bloomery-setting__rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.bloomery-setting__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    font-size: var(--font-size-sm);
}

.bloomery-setting__key {
    flex: 0 0 9rem;

    color: var(--text-color-dark);
}

.bloomery-setting__value {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;

    min-width: 0;

    word-break: break-all;
}

.bloomery-setting__value--muted,
.bloomery-setting__shown {
    color: var(--text-color-dark);
}

.bloomery-setting__shown {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);
}

.bloomery-setting__hint {
    flex: 0 0 auto;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}
</style>
