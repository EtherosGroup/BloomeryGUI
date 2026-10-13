<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import BackButton from '@/components/BackButton.vue'
import GroupButton from '@/components/GroupButton.vue'
import ProgressLanes from '@/components/ProgressLanes.vue'
import { errorSummary } from '@/api/errorMessages'
import { useDownloadService, type DownloadTask, type TaskState } from '@/stores/DownloadService'
import { installReportRows } from '@/utils/installReport'

const download = useDownloadService()
const router = useRouter()

const STATE_LABEL: Record<TaskState, string> = {
    running: '进行中',
    done: '完成',
    failed: '失败',
    cancelled: '已取消',
}

/** 秒针：进行中的任务显示已用时长 */
const now = ref(Date.now())
let timer: number | undefined

function stopTimer(): void {
    if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
    }
}

watch(
    () => download.activeCount,
    (count) => {
        if (count > 0 && timer === undefined) {
            timer = window.setInterval(() => {
                now.value = Date.now()
            }, 1000)
            return
        }
        if (count === 0) {
            stopTimer()
        }
    },
    { immediate: true },
)

onBeforeUnmount(stopTimer)

const tasks = computed(() => download.tasks)

function elapsedOf(task: DownloadTask): string {
    const end = task.finishedAt ?? now.value
    return `已用 ${Math.max(0, Math.round((end - task.startedAt) / 1000))} 秒`
}

/** 目标描述：实例未生成时只有游戏版本与加载器 */
function targetOf(task: DownloadTask): string {
    const loader =
        task.loader === null
            ? '原版'
            : task.loaderVersion === null
              ? task.loader
              : `${task.loader} ${task.loaderVersion}`
    return `${task.game} · ${loader}`
}

function toInstall(): void {
    void router.push('/version/install')
}
</script>

<template>
    <main class="download">
        <header class="download__head">
            <BackButton fallback="/version/install" />
            <h1 class="download__title">安装任务</h1>
            <GroupButton
                variant="ghost"
                :disabled="!download.hasFinished"
                @click="download.clearFinished"
            >
                清理已完成
            </GroupButton>
        </header>

        <p v-if="tasks.length === 0" class="download__note">
            没有后台任务 · 在安装新版本页点「后台安装」
        </p>

        <ul v-else class="download__list">
            <li v-for="task in tasks" :key="task.id" class="download__task">
                <div class="download__row">
                    <span class="download__instance">
                        {{ task.instance.length > 0 ? task.instance : targetOf(task) }}
                    </span>
                    <span class="download__state" :class="`download__state--${task.state}`">
                        {{ STATE_LABEL[task.state] }}
                    </span>
                    <span class="download__meta">{{ elapsedOf(task) }}</span>
                </div>
                <p v-if="task.instance.length > 0" class="download__note">{{ targetOf(task) }}</p>

                <ProgressLanes
                    :events="task.events"
                    :waiting="task.state === 'running' ? '已开始，等待进度' : ''"
                />

                <p v-if="task.failure !== null" class="download__failure">
                    <span class="download__failure-code">
                        {{
                            errorSummary(
                                task.failure.code,
                                task.failure.message,
                                task.failure.retryable,
                            )
                        }}
                    </span>
                    <span v-if="task.failure.detail" class="download__failure-detail">
                        {{ task.failure.detail }}
                    </span>
                </p>

                <div v-if="task.report !== null" class="download__rows">
                    <div
                        v-for="row in installReportRows(task.report)"
                        :key="row.key"
                        class="download__row-item"
                    >
                        <span class="download__key">{{ row.key }}</span>
                        <span class="download__value">{{ row.value }}</span>
                    </div>
                </div>

                <div class="download__actions">
                    <GroupButton
                        v-if="task.state === 'running'"
                        variant="ghost"
                        @click="download.cancel(task.id)"
                    >
                        取消
                    </GroupButton>
                    <GroupButton v-else variant="ghost" @click="download.remove(task.id)">
                        移除
                    </GroupButton>
                </div>
            </li>
        </ul>

        <div class="download__actions">
            <GroupButton variant="ghost" @click="toInstall">去安装新版本</GroupButton>
        </div>
    </main>
</template>

<style scoped lang="scss">
.download {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 52rem;
    padding: 1.5rem;
}

.download__head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.download__title {
    flex: 1;
    margin: 0;

    font-size: var(--font-size-3xl);
}

.download__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);

    word-break: break-all;
}

.download__list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

.download__task {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;

    padding: 0.75rem;

    background-color: var(--group-content-bg);
    border: 1px solid color-mix(in srgb, var(--text-color) 10%, transparent);
    border-radius: var(--border-radius);
}

.download__row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
}

.download__instance {
    font-size: var(--font-size-lg);
    font-weight: 600;
    word-break: break-all;
}

.download__state {
    flex: none;

    padding: 0.05rem 0.4rem;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);

    background-color: color-mix(in srgb, var(--text-color) 12%, transparent);
    border-radius: calc(var(--border-radius) / 2);
}

.download__state--done {
    color: #2e7d32;
}

.download__state--failed {
    color: #c62828;
}

.download__meta {
    margin-left: auto;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    white-space: nowrap;
}

.download__failure {
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

.download__failure-code {
    font-weight: 600;
}

.download__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.download__rows {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
}

.download__row-item {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;

    font-size: var(--font-size-xs);
}

.download__key {
    flex: 0 0 3.5rem;
    color: var(--text-color-dark);
}

.download__value {
    flex: 1;
    word-break: break-all;
}

.download__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}
</style>
