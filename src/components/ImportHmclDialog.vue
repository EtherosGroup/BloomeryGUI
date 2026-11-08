<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { errorSummary } from '@/api/errorMessages'
import FolderPathPicker from '@/components/FolderPathPicker.vue'
import GroupCheckboxGroup from '@/components/GroupCheckboxGroup.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import { useCli } from '@/composables/useCli'
import type { CliHmclCandidate, CliImportReport, CliImportSkipped } from '@/api/types'
import type { ChoiceOptionType } from '@/types/ChoiceOptionType'
import type { PopupWindowButton } from '@/types/PopupWindowButton'
import { meetsVersion } from '@/utils/meetsVersion'
import { notifyError } from '@/utils/notify'

/** import 命令从 CLI 1.16.0 起才有 */
const REQUIRED_CLI_VERSION = '1.16.0'

const REASON_LABEL: Record<string, string> = {
    exists: '已存在',
    'not-found': '未找到',
    broken: '跑不起来',
    duplicate: '重复',
    credential: '凭据未迁移',
}

const KIND_LABEL: Record<CliHmclCandidate['kind'], string> = {
    local: '便携数据',
    user: '用户数据',
}

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ imported: [] }>()

const { client } = useCli()

/** 手动指定的目录：填了它就只导这一处，勾选列表忽略 */
const manual = ref('')
const busy = ref(false)
const checking = ref(false)
const cliVersion = ref('')
const tooOld = ref(false)
/** 这个 CLI 不认「不带目录的 import」时只留手动输入 */
const detectFailed = ref(false)
const candidates = ref<CliHmclCandidate[]>([])
const selected = ref<string[]>([])
const failure = ref<{
    code: string
    message: string
    detail: string | null
    retryable: boolean
} | null>(null)
const reports = ref<CliImportReport[]>([])

function toFailure(error: unknown): NonNullable<typeof failure.value> {
    return error instanceof BloomeryError
        ? {
              code: error.code,
              message: error.message,
              detail: error.detail,
              retryable: error.retryable,
          }
        : { code: 'Unknown', message: String(error), detail: null, retryable: false }
}

function reset(): void {
    manual.value = ''
    busy.value = false
    cliVersion.value = ''
    tooOld.value = false
    detectFailed.value = false
    candidates.value = []
    selected.value = []
    failure.value = null
    reports.value = []
}

/** 打开时先看 CLI 版本，再看它自己找到了几处 HMCL 数据 */
watch(open, async (visible) => {
    if (!visible) {
        return
    }
    reset()
    checking.value = true
    try {
        const info = await (await client()).probe()
        cliVersion.value = info.version
        tooOld.value = !meetsVersion(info.version, REQUIRED_CLI_VERSION)
        if (tooOld.value) {
            return
        }
        // 不按版本号猜：老 CLI 的 import 缺位置参数会报 UsageError，那就退回手动输入
        try {
            const found = await (
                await client()
            ).run<{ candidates: CliHmclCandidate[] }>(['import'], { progress: false })
            candidates.value = found.candidates
            // 找到的都先勾上：只想导其中一处的话取消其余即可
            selected.value = found.candidates.map((item) => item.path)
        } catch {
            detectFailed.value = true
            candidates.value = []
        }
    } catch (error) {
        failure.value = toFailure(error)
    } finally {
        checking.value = false
    }
})

const candidateOptions = computed<ChoiceOptionType[]>(() =>
    candidates.value.map((item) => ({
        value: item.path,
        label: `${item.path} · ${KIND_LABEL[item.kind]} · 文件夹 ${item.folders} · 账号 ${item.accounts}`,
    })),
)

/** 手动填的优先，否则用勾选的那些 */
const targets = computed<string[]>(() => {
    const typed = manual.value.trim()
    return typed.length > 0 ? [typed] : selected.value
})

async function runImport(dryRun: boolean): Promise<void> {
    const paths = targets.value
    if (paths.length === 0) {
        notifyError('先勾选一个数据目录，或手动填一个')
        return
    }
    if (tooOld.value) {
        notifyError(`CLI 版本 ${cliVersion.value} 低于 ${REQUIRED_CLI_VERSION}，导入会报命令不存在`)
        return
    }
    if (busy.value) {
        return
    }
    busy.value = true
    failure.value = null
    reports.value = []
    try {
        const instance = await client()
        const done: CliImportReport[] = []
        // 一处一处来：每次 import 只认一个数据目录，失败不影响后面的
        for (const path of paths) {
            const args = ['import', path]
            if (dryRun) {
                args.push('--dry-run')
            }
            done.push(await instance.run<CliImportReport>(args, { progress: false }))
        }
        reports.value = done
        if (!dryRun) {
            emit('imported')
        }
    } catch (error) {
        failure.value = toFailure(error)
        reports.value = []
    } finally {
        busy.value = false
    }
}

const buttons = computed<PopupWindowButton[]>(() => [
    { label: '试运行', onClick: () => runImport(true), closeOnClick: false },
    { label: '导入', onClick: () => runImport(false), closeOnClick: false },
])

const failureLabel = computed(() => {
    const row = failure.value
    return row === null ? '' : errorSummary(row.code, row.message, row.retryable)
})

function selectedText(report: CliImportReport): string {
    const row = report.selected
    const parts = [row.folder, row.instance, row.account].filter(
        (item): item is string => item !== null && item.length > 0,
    )
    return parts.length === 0 ? '保持原样' : parts.join(' · ')
}

/** 跳过项按原因归并成一行，别把每条都铺开 */
function skippedText(rows: CliImportSkipped[]): string {
    if (rows.length === 0) {
        return ''
    }
    const counts = new Map<string, number>()
    for (const row of rows) {
        counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1)
    }
    return [...counts.entries()]
        .map(([reason, count]) => `${REASON_LABEL[reason] ?? reason} ${count}`)
        .join(' · ')
}
</script>

<template>
    <PopupWindow
        v-model:open="open"
        title="导入 HMCL 数据"
        context="自动找 HMCL 的数据目录，勾哪儿导哪儿"
        :buttons="buttons"
    >
        <div class="import">
            <p v-if="checking" class="import__note">检测 CLI 版本与 HMCL 数据目录…</p>
            <p v-else-if="tooOld" class="import__warn">
                CLI 版本 {{ cliVersion }} 低于
                {{ REQUIRED_CLI_VERSION }}，导入会报命令不存在，请先升级
            </p>

            <template v-else>
                <GroupCheckboxGroup
                    v-if="candidates.length > 0"
                    v-model="selected"
                    label="找到的 HMCL 数据目录"
                    :options="candidateOptions"
                    :disabled="busy"
                />
                <p v-else-if="detectFailed" class="import__note">
                    这个 CLI 版本不能自动找目录，请在下面手动填一个。
                </p>
                <p v-else class="import__note">没自动找到 HMCL 数据目录，请在下面手动填一个。</p>

                <FolderPathPicker
                    v-model="manual"
                    label="手动指定目录（留空则用勾选的）"
                    placeholder="如 D:\.hmcl"
                    title="选择 HMCL 数据目录"
                    :disabled="busy"
                />
                <p class="import__note">
                    勾选多个就逐个导入，每个目录各写一次；两处 HMCL 的数据互不相干。
                </p>
                <p v-if="busy" class="import__note">正在处理，逐个探测 Java 可能需要几秒…</p>
            </template>

            <p v-if="failure" class="import__failure">
                <span class="import__failure-code">{{ failureLabel }}</span>
                <span v-if="failure.detail" class="import__failure-detail">
                    {{ failure.detail }}
                </span>
            </p>

            <div v-for="report in reports" :key="report.source.path" class="import__report">
                <p class="import__banner">
                    {{ report.dryRun ? '试运行：未写入任何数据' : '导入完成' }} ·
                    {{ report.source.path }}
                </p>

                <section class="import__block">
                    <p class="import__title">
                        文件夹 · 新增 {{ report.folders.added.length }}
                        <span v-if="skippedText(report.folders.skipped)" class="import__skipped">
                            {{ skippedText(report.folders.skipped) }}
                        </span>
                    </p>
                    <p v-for="row in report.folders.added" :key="row.path" class="import__row">
                        {{ row.id }} · {{ row.path }} · {{ row.versionCount }} 个实例
                    </p>
                </section>

                <section class="import__block">
                    <p class="import__title">
                        Java · 新增 {{ report.java.added.length }}
                        <span v-if="skippedText(report.java.skipped)" class="import__skipped">
                            {{ skippedText(report.java.skipped) }}
                        </span>
                    </p>
                    <p v-for="row in report.java.added" :key="row.path" class="import__row">
                        {{ row.vendor }} {{ row.major }} · {{ row.path }}
                    </p>
                </section>

                <section class="import__block">
                    <p class="import__title">
                        账号 · 新增 {{ report.accounts.added.length }}
                        <span v-if="skippedText(report.accounts.skipped)" class="import__skipped">
                            {{ skippedText(report.accounts.skipped) }}
                        </span>
                    </p>
                    <p v-for="row in report.accounts.added" :key="row.id" class="import__row">
                        {{ row.id }}
                    </p>
                </section>

                <section class="import__block">
                    <p class="import__title">选中状态</p>
                    <p class="import__row">{{ selectedText(report) }}</p>
                </section>

                <section v-if="report.warnings.length > 0" class="import__block">
                    <p class="import__title">未迁移</p>
                    <p v-for="row in report.warnings" :key="row" class="import__row">{{ row }}</p>
                </section>
            </div>
        </div>
    </PopupWindow>
</template>

<style scoped lang="scss">
.import {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

.import__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    line-height: 1.5;
}

.import__warn {
    margin: 0;
    padding: 0.5rem 0.75rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: color-mix(in srgb, #ef6c00 18%, transparent);
    border: 1px solid color-mix(in srgb, #ef6c00 45%, transparent);
    border-radius: var(--border-radius);
}

.import__failure {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;

    margin: 0;
    padding: 0.5rem 0.75rem;

    font-size: var(--font-size-sm);

    background-color: color-mix(in srgb, #c62828 18%, transparent);
    border: 1px solid color-mix(in srgb, #c62828 45%, transparent);
    border-radius: var(--border-radius);
}

.import__failure-code {
    font-weight: 600;
}

.import__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.import__report {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    padding-top: 0.4rem;

    border-top: 1px solid color-mix(in srgb, var(--text-color) 14%, transparent);
}

.import__banner {
    margin: 0;

    font-size: var(--font-size-sm);
    font-weight: 600;
    word-break: break-all;
}

.import__block {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.import__title {
    margin: 0;

    font-size: var(--font-size-sm);
    font-weight: 600;
}

.import__skipped {
    margin-left: 0.4rem;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    font-weight: 400;
}

.import__row {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    line-height: 1.5;
    word-break: break-all;
}
</style>
