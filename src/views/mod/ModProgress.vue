<script setup lang="ts">
import { computed } from 'vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GroupButton from '@/components/GroupButton.vue'
import ProgressLanes from '@/components/ProgressLanes.vue'
import { errorSummary } from '@/api/errorMessages'
import { openPath } from '@/api/system'
import { useModService } from '@/stores/ModService'
import { notifyError } from '@/utils/notify'
import { sizeText } from '@/utils/modText'

/** mod install 的进度与结果，单装页与批量页共用 */
const mod = useModService()

const visible = computed(
    () => mod.installBusy || mod.installReport !== null || mod.installFailure !== null,
)

/** 装成了什么：逐条列文件，skipped 表示本来就有 */
const installedEntries = computed(() => {
    const report = mod.installReport
    if (report === null) {
        return []
    }
    return report.installs.map((entry) => ({
        query: entry.query,
        title: entry.project.title,
        slug: entry.project.slug,
        version: entry.version.number,
        files: entry.files.map((file) => ({
            name: file.filename,
            size: sizeText(file.size),
            skipped: file.skipped,
        })),
        warnings: entry.warnings,
    }))
})

const failedEntries = computed(() => mod.installReport?.failed ?? [])
const modsPathEmpty = computed(() => mod.modsPath.length === 0)

async function openMods(): Promise<void> {
    if (modsPathEmpty.value) {
        return
    }
    await openPath(mod.modsPath).catch(() => notifyError('打不开 MOD 文件夹'))
}
</script>

<template>
    <CollapsibleGroup v-if="visible" label="进度" default-open>
        <ProgressLanes
            :events="mod.installEvents"
            :waiting="mod.installBusy ? '已开始，等待进度' : ''"
        />

        <p v-if="mod.installCancelled" class="mod__note">已取消</p>
        <p v-else-if="mod.installFailure !== null" class="mod__failure">
            <span class="mod__failure-code">
                {{
                    errorSummary(
                        mod.installFailure.code,
                        mod.installFailure.message,
                        mod.installFailure.retryable,
                    )
                }}
            </span>
            <span v-if="mod.installFailure.detail" class="mod__failure-detail">
                {{ mod.installFailure.detail }}
            </span>
        </p>

        <template v-if="mod.installReport !== null">
            <div v-for="entry in installedEntries" :key="entry.slug" class="mod__result">
                <p class="mod__note">{{ entry.title }}（{{ entry.slug }}）· {{ entry.version }}</p>
                <div class="mod__rows">
                    <div v-for="file in entry.files" :key="file.name" class="mod__row-item">
                        <span class="mod__key">{{ file.skipped ? '已有' : '文件' }}</span>
                        <span class="mod__value">{{ file.name }} · {{ file.size }}</span>
                    </div>
                </div>
                <p v-for="warning in entry.warnings" :key="warning" class="mod__note">
                    {{ warning }}
                </p>
            </div>

            <div v-if="failedEntries.length > 0" class="mod__rows">
                <div v-for="entry in failedEntries" :key="entry.query" class="mod__row-item">
                    <span class="mod__key">失败</span>
                    <span class="mod__value">
                        {{ errorSummary(entry.code, entry.query, entry.retryable) }} ·
                        {{ entry.detail }}
                    </span>
                </div>
            </div>

            <div class="mod__actions">
                <GroupButton variant="ghost" :disabled="modsPathEmpty" @click="openMods">
                    打开 MOD 文件夹
                </GroupButton>
                <GroupButton variant="ghost" @click="mod.close">关闭</GroupButton>
            </div>
        </template>
    </CollapsibleGroup>
</template>

<style scoped lang="scss">
@use './mod-page.scss';
</style>
