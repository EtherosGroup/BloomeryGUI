<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { errorSummary } from '@/api/errorMessages'
import GroupInput from '@/components/GroupInput.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import { useCli } from '@/composables/useCli'
import type { CliImportReport, CliImportSkipped } from '@/api/types'
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

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ imported: [] }>()

const { client } = useCli()

const target = ref('')
const busy = ref(false)
const checking = ref(false)
const cliVersion = ref('')
const tooOld = ref(false)
const failure = ref<{
    code: string
    message: string
    detail: string | null
    retryable: boolean
} | null>(null)
const report = ref<CliImportReport | null>(null)

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
    target.value = ''
    busy.value = false
    cliVersion.value = ''
    tooOld.value = false
    failure.value = null
    report.value = null
}

/** 打开时先看 CLI 版本：太旧只能提示升级，run 一定 UnknownCommand */
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
    } catch (error) {
        failure.value = toFailure(error)
    } finally {
        checking.value = false
    }
})

async function runImport(dryRun: boolean): Promise<void> {
    const path = target.value.trim()
    if (path.length === 0) {
        notifyError('路径为空')
        return
    }
    if (tooOld.value) {
        notifyError(`CLI 版本 ${cliVersion.value} 低于 ${REQUIRED_CLI_VERSION}，导入会报命令不存在`)
    }
    if (busy.value) {
        return
    }
    busy.value = true
    failure.value = null
    report.value = null
    try {
        const args = ['import', path]
        if (dryRun) {
            args.push('--dry-run')
        }
        report.value = await (await client()).run<CliImportReport>(args, { progress: false })
        if (!dryRun) {
            emit('imported')
        }
    } catch (error) {
        failure.value = toFailure(error)
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

const selectedText = computed(() => {
    const row = report.value?.selected
    if (row === undefined) {
        return ''
    }
    const parts = [row.folder, row.instance, row.account].filter(
        (item): item is string => item !== null && item.length > 0,
    )
    return parts.length === 0 ? '保持原样' : parts.join(' · ')
})

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
        context="从 HMCL 3.16+ 数据目录搬游戏文件夹、Java 与离线账号"
        :buttons="buttons"
    >
        <div class="import">
            <p v-if="checking" class="import__note">检测 CLI 版本…</p>
            <p v-else-if="tooOld" class="import__warn">
                CLI 版本 {{ cliVersion }} 低于
                {{ REQUIRED_CLI_VERSION }}，导入会报命令不存在，请先升级
            </p>

            <GroupInput
                v-model="target"
                label="HMCL 数据目录"
                placeholder="如 ~/.local/share/hmcl"
                :disabled="busy"
            />
            <p class="import__note">
                自动识别 local home / user home / local-stable 布局；相对路径按家目录解析。
            </p>
            <p v-if="busy" class="import__note">正在处理，逐个探测 Java 可能需要几秒…</p>

            <p v-if="failure" class="import__failure">
                <span class="import__failure-code">{{ failureLabel }}</span>
                <span v-if="failure.detail" class="import__failure-detail">
                    {{ failure.detail }}
                </span>
            </p>

            <div v-if="report" class="import__report">
                <p class="import__banner">
                    {{ report.dryRun ? '试运行：未写入任何数据' : '导入完成' }}
                </p>
                <p class="import__note">{{ report.source.path }}</p>

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
                    <p class="import__row">{{ selectedText }}</p>
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

    padding-top: 0.2rem;

    border-top: 1px solid color-mix(in srgb, var(--text-color) 14%, transparent);
}

.import__banner {
    margin: 0;

    font-size: var(--font-size-sm);
    font-weight: 600;
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
