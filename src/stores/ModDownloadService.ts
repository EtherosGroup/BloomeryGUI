import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { queueArgs, type ModScope } from '@/api/modArgs'
import type { CliDownloadQueue, CliDownloadTask, CliModAsyncResult } from '@/api/types'
import { useCli } from '@/composables/useCli'

export interface QueueFailure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封 */
    retryable: boolean
}

function toFailure(error: unknown): QueueFailure {
    return error instanceof BloomeryError
        ? {
              code: error.code,
              message: error.message,
              detail: error.detail,
              retryable: error.retryable,
          }
        : { code: 'Unknown', message: String(error), detail: null, retryable: false }
}

/** 仍在队列中的状态 */
const LIVE = new Set(['pending', 'running'])

/**
 * CLI 下载队列
 *
 * 队列是文件，进程重启后还在；MOD 安装走 --async 入队，由后台 worker 逐个跑
 */
export const useModDownloadService = defineStore('ModDownloadService', () => {
    const tasks = ref<CliDownloadTask[]>([])
    /** 后台下载进程的 pid，没有则为 null */
    const worker = ref<number | null>(null)
    /** 是否成功取过一轮 */
    const loaded = ref(false)
    const loading = ref(false)
    const failure = ref<QueueFailure | null>(null)
    /** 正在拉起 worker，防重入 */
    const startingWorker = ref(false)

    const liveCount = computed(() => tasks.value.filter((task) => LIVE.has(task.state)).length)
    const finishedCount = computed(() => tasks.value.length - liveCount.value)
    const hasFinished = computed(() => finishedCount.value > 0)

    /** 读队列；轮询也走这里 */
    async function refresh(): Promise<void> {
        if (loading.value) {
            return
        }
        loading.value = true
        failure.value = null
        try {
            const client = await useCli().client()
            const result = await client.run<CliDownloadQueue>(['download', 'info'], {
                progress: false,
            })
            tasks.value = Array.isArray(result.tasks) ? result.tasks : []
            worker.value = typeof result.worker === 'number' ? result.worker : null
            loaded.value = true
        } catch (error) {
            failure.value = toFailure(error)
        } finally {
            loading.value = false
        }
    }

    /** 入队：把安装交给后台 worker */
    async function enqueue(
        scope: ModScope,
        targets: string[],
        deps: boolean,
    ): Promise<string[] | null> {
        const wanted = targets.map((item) => item.trim()).filter((item) => item.length > 0)
        if (wanted.length === 0) {
            return null
        }
        failure.value = null
        try {
            const client = await useCli().client()
            const result = await client.run<CliModAsyncResult>(queueArgs(scope, wanted, deps), {
                progress: false,
            })
            const ids = (result.tasks ?? []).map((task) => task.id)
            await refresh()
            return ids
        } catch (error) {
            failure.value = toFailure(error)
            return null
        }
    }

    /** 取消：队列里的任务由 worker 收尾 */
    async function cancel(id: string): Promise<boolean> {
        return await act(['download', 'cancel', id])
    }

    /**
     * 重试：只对 failed 有效
     *
     * retry 只重新排队，不拉 worker；队列有任务而 worker 不在时由 ensureWorker 起一个
     */
    async function retry(id: string): Promise<boolean> {
        const ok = await act(['download', 'retry', id])
        if (ok) {
            await ensureWorker()
        }
        return ok
    }

    /**
     * 队列有任务而 worker 不在时跑一次 download run
     *
     * CLI 提示里给出的命令；进程随应用退出结束，任务留在队列文件
     */
    async function ensureWorker(): Promise<void> {
        if (startingWorker.value || worker.value !== null || liveCount.value === 0) {
            return
        }
        startingWorker.value = true
        try {
            const client = await useCli().client()
            void client
                .run(['download', 'run'], { id: `download-run-${Date.now()}` })
                .catch(() => undefined)
        } finally {
            startingWorker.value = false
        }
    }

    /** 清理已结束的任务 */
    async function clear(): Promise<boolean> {
        return await act(['download', 'clear'])
    }

    async function act(args: string[]): Promise<boolean> {
        failure.value = null
        try {
            const client = await useCli().client()
            await client.run(args, { progress: false })
            await refresh()
            return true
        } catch (error) {
            failure.value = toFailure(error)
            return false
        }
    }

    return {
        tasks,
        worker,
        loaded,
        loading,
        failure,
        liveCount,
        finishedCount,
        hasFinished,
        refresh,
        enqueue,
        ensureWorker,
        cancel,
        retry,
        clear,
    }
})
