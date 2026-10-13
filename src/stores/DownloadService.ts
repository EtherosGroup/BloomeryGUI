import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { InstallTarget } from '@/api/installArgs'
import { killCli } from '@/api/transport.tauri'
import type { CliInstallReport, CliProgressEvent } from '@/api/types'

/** 后台任务的存活状态 */
export type TaskState = 'running' | 'done' | 'failed' | 'cancelled'

export interface DownloadFailure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封，可重试才有意义 */
    retryable: boolean
}

/** 一个转到后台的安装任务 */
export interface DownloadTask {
    /** 调用 id，与前台那次调用同一个，取消时交给 killCli */
    id: string
    /** 目标实例名，装完才有 */
    instance: string
    game: string
    loader: string | null
    loaderVersion: string | null
    folderId: string
    state: TaskState
    /** 进度事件，与前台安装同一套通道 */
    events: CliProgressEvent[]
    report: CliInstallReport | null
    failure: DownloadFailure | null
    startedAt: number
    finishedAt: number | null
}

/** 接管前台的落点：之后那次调用的事件与结果写到这里 */
export interface AdoptedInstall {
    emit: (event: CliProgressEvent) => void
    finish: (report: CliInstallReport) => void
    abort: (failure: DownloadFailure) => void
    /** 这次调用在转后台之前就被取消了 */
    aborted: () => void
}

/** 待接管的调用 */
export interface AdoptInput {
    id: string
    target: InstallTarget
    folderId: string
    /** 已收到的进度，接管后继续追加 */
    events: CliProgressEvent[]
    startedAt: number
}

/**
 * 后台安装任务
 *
 * CLI 的 install 没有 --async，进程从起就一直由界面持有；转后台只是把落点从页面换到任务，
 * 所以离开页面不中断，退出应用才结束
 */
export const useDownloadService = defineStore('DownloadService', () => {
    const tasks = ref<DownloadTask[]>([])

    const activeCount = computed(
        () => tasks.value.filter((task) => task.state === 'running').length,
    )
    const hasFinished = computed(() => tasks.value.some((task) => task.state !== 'running'))

    /** 进度事件只留最近一截，通道数固定所以界面不会越来越长 */
    const EVENT_LIMIT = 200

    function push(task: DownloadTask, event: CliProgressEvent): void {
        task.events.push(event)
        if (task.events.length > EVENT_LIMIT) {
            task.events.shift()
        }
    }

    /** 接管一次正在跑的安装；这个调用已经有任务时给 null */
    function adopt(input: AdoptInput): AdoptedInstall | null {
        if (tasks.value.some((task) => task.id === input.id)) {
            return null
        }
        const task: DownloadTask = {
            id: input.id,
            instance: '',
            game: input.target.game,
            loader: input.target.loader,
            loaderVersion: input.target.loaderVersion,
            folderId: input.folderId,
            state: 'running',
            events: [...input.events],
            report: null,
            failure: null,
            startedAt: input.startedAt,
            finishedAt: null,
        }
        tasks.value = [...tasks.value, task]

        return {
            emit: (event) => {
                if (task.state === 'running') {
                    push(task, event)
                }
            },
            finish: (report) => {
                task.report = report
                task.instance = report.name
                task.state = 'done'
                task.finishedAt = Date.now()
            },
            abort: (failure) => {
                if (task.state === 'cancelled') {
                    return
                }
                task.failure = failure
                task.state = 'failed'
                task.finishedAt = Date.now()
            },
            aborted: () => {
                if (task.state !== 'running') {
                    return
                }
                task.state = 'cancelled'
                task.finishedAt = Date.now()
            },
        }
    }

    /** 取消：杀掉这个任务的 CLI 进程，与前台是同一次调用 */
    async function cancel(id: string): Promise<void> {
        const task = tasks.value.find((item) => item.id === id)
        if (task === undefined || task.state !== 'running') {
            return
        }
        task.state = 'cancelled'
        task.finishedAt = Date.now()
        await killCli(id).catch(() => undefined)
    }

    /** 移除一条已结束的任务 */
    function remove(id: string): void {
        tasks.value = tasks.value.filter((task) => task.id !== id || task.state === 'running')
    }

    function clearFinished(): void {
        tasks.value = tasks.value.filter((task) => task.state === 'running')
    }

    return {
        tasks,
        activeCount,
        hasFinished,
        adopt,
        cancel,
        remove,
        clearFinished,
    }
})
