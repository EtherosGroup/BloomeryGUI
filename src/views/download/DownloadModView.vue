<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BackButton from '@/components/BackButton.vue'
import GroupButton from '@/components/GroupButton.vue'
import ProgressLanes from '@/components/ProgressLanes.vue'
import { errorSummary } from '@/api/errorMessages'
import { openPath } from '@/api/system'
import type { CliDownloadTask, CliProgressEvent, CliTaskState } from '@/api/types'
import { useModDownloadService } from '@/stores/ModDownloadService'
import { notifyError } from '@/utils/notify'

const queue = useModDownloadService()
const router = useRouter()

const STATE_LABEL: Record<CliTaskState, string> = {
    pending: '等待',
    running: '进行中',
    done: '完成',
    failed: '失败',
    cancelled: '已取消',
}

/** 轮询间隔：队列文件里的进度写盘节流是 1 秒 */
const POLL_INTERVAL = 2000
let timer: number | undefined

/** 当前时刻，算已用时长 */
const now = ref(Date.now())

async function tick(): Promise<void> {
    now.value = Date.now()
    await queue.refresh()
    // 有任务无 worker 时拉起
    await queue.ensureWorker()
}

onMounted(async () => {
    await tick()
    timer = window.setInterval(() => void tick(), POLL_INTERVAL)
})

onBeforeUnmount(() => {
    if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
    }
})

const tasks = computed(() => queue.tasks)

/** 队列只存一条进度快照，摊成进度条的形状 */
function eventsOf(task: CliDownloadTask): CliProgressEvent[] {
    const progress = task.progress
    if (progress === null) {
        return []
    }
    return [
        {
            v: 1,
            stage: progress.stage,
            done: progress.done,
            total: progress.total,
            bytes: progress.bytes,
        },
    ]
}

function scopeOf(task: CliDownloadTask): string {
    const { gameVersion, loader } = task.params
    return `${gameVersion ?? '未知版本'} · ${loader ?? '原版'}`
}

/** 已用时长：进行中按开始时间，结束按收尾时间 */
function elapsedOf(task: CliDownloadTask): string {
    if (task.state === 'pending') {
        return '等待中'
    }
    const start = task.started === null ? task.created : task.started
    const from = Date.parse(start)
    if (!Number.isFinite(from)) {
        return ''
    }
    const end = task.finished === null ? now.value : Date.parse(task.finished)
    const seconds = Math.max(0, Math.round((end - from) / 1000))
    return task.finished === null ? `已用 ${seconds} 秒` : `用时 ${seconds} 秒`
}

async function cancel(task: CliDownloadTask): Promise<void> {
    const ok = await queue.cancel(task.id)
    if (!ok) {
        const failure = queue.failure
        if (failure !== null) {
            notifyError(errorSummary(failure.code, failure.message, failure.retryable))
        }
    }
}

async function retry(task: CliDownloadTask): Promise<void> {
    const ok = await queue.retry(task.id)
    if (!ok) {
        const failure = queue.failure
        if (failure !== null) {
            notifyError(errorSummary(failure.code, failure.message, failure.retryable))
        }
    }
}

async function openMods(task: CliDownloadTask): Promise<void> {
    await openPath(task.params.modsDirectory).catch(() => notifyError('打不开 MOD 文件夹'))
}

function toInstall(): void {
    void router.push('/mod/install')
}
</script>

<template>
    <main class="download">
        <header class="download__head">
            <BackButton fallback="/mod/install" />
            <h1 class="download__title">MOD 下载队列</h1>
            <GroupButton variant="ghost" :disabled="!queue.hasFinished" @click="queue.clear()">
                清理已完成
            </GroupButton>
        </header>

        <p class="download__note">
            后台下载进程：{{ queue.worker === null ? '不在运行' : `pid ${queue.worker}` }}
        </p>

        <p v-if="queue.failure !== null" class="download__failure">
            <span class="download__failure-code">
                {{
                    errorSummary(queue.failure.code, queue.failure.message, queue.failure.retryable)
                }}
            </span>
            <span v-if="queue.failure.detail" class="download__failure-detail">
                {{ queue.failure.detail }}
            </span>
        </p>

        <p v-if="queue.loaded && tasks.length === 0" class="download__note">
            队列为空 · 入口在模组页「加入下载队列」
        </p>

        <ul v-else-if="tasks.length > 0" class="download__list">
            <li v-for="task in tasks" :key="task.id" class="download__task">
                <div class="download__row">
                    <span class="download__instance">{{ task.target }}</span>
                    <span class="download__state" :class="`download__state--${task.state}`">
                        {{ STATE_LABEL[task.state] }}
                    </span>
                    <span class="download__meta">{{ elapsedOf(task) }}</span>
                </div>
                <p class="download__note">
                    {{ scopeOf(task) }}
                    <template v-if="task.attempts > 1"> · 尝试 {{ task.attempts }} 次</template>
                </p>

                <ProgressLanes
                    :events="eventsOf(task)"
                    :waiting="task.state === 'running' ? '已开始，等待进度' : ''"
                />

                <p v-if="task.error !== null" class="download__failure">
                    <span class="download__failure-code">
                        {{
                            errorSummary(task.error.code, task.error.message, task.error.retryable)
                        }}
                    </span>
                    <span v-if="task.error.detail" class="download__failure-detail">
                        {{ task.error.detail }}
                    </span>
                </p>

                <div class="download__actions">
                    <GroupButton
                        v-if="task.state === 'pending' || task.state === 'running'"
                        variant="ghost"
                        @click="cancel(task)"
                    >
                        取消
                    </GroupButton>
                    <GroupButton
                        v-if="task.state === 'failed'"
                        variant="ghost"
                        @click="retry(task)"
                    >
                        重试
                    </GroupButton>
                    <GroupButton variant="ghost" @click="openMods(task)">
                        打开 MOD 文件夹
                    </GroupButton>
                </div>
            </li>
        </ul>

        <div class="download__actions">
            <GroupButton variant="ghost" @click="toInstall">去安装模组</GroupButton>
        </div>
    </main>
</template>

<style scoped lang="scss">
@use './download-page.scss';
</style>
