import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { killCli } from '@/api/transport.tauri'
import { appendDiag } from '@/api/diagnostics'
import { gameStatus } from '@/api/game'
import type { CliLaunchResult, CliProgressEvent } from '@/api/types'
import { useCli } from '@/composables/useCli'

export type LaunchStepState = 'pending' | 'current' | 'done' | 'failed'

/** 诊断行：带时间戳写入应用数据目录的 diag.log，写失败不影响主流程 */
function trace(...parts: unknown[]): void {
    const line = `[${new Date().toISOString()}] ${parts.map((part) => String(part)).join(' ')}`
    void appendDiag([line])
}

export interface LaunchStep {
    key: string
    label: string
    state: LaunchStepState
}

export interface LaunchFailure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封，可重试才有意义 */
    retryable: boolean
}

/** 启动流程：确认信息、步骤进度、取消与日志位置 */
export const useLaunchService = defineStore(
    'LaunchService',
    () => {
        /** 不再询问，直接启动 */
        const skipConfirm = ref(false)
        /** dry-run 得到的启动计划，用于确认弹窗 */
        const plan = ref<CliLaunchResult | null>(null)
        /** 正在启动的实例 */
        const instance = ref('')
        /** 实例 id 对文件夹，取消与重试都要用 */
        const folder = ref('')
        /** 进行中的调用 id，用于 killCli */
        const callId = ref('')
        /** pid 与日志路径 */
        const pid = ref<number | null>(null)
        const logPath = ref('')
        /** 进度事件，取最后若干条展示 */
        const events = ref<CliProgressEvent[]>([])
        const failure = ref<LaunchFailure | null>(null)
        const cancelled = ref(false)
        const busy = ref(false)
        /** 进度面板可见性：只有真启动才置 true */
        const active = ref(false)
        /** 窗口判定依据，来自 game_status */
        const windowEvidence = ref('')

        const steps = ref<LaunchStep[]>([])

        const running = computed(() => busy.value)
        /** 最近一条进度：阶段名与已完成数 */
        const latest = computed(() => events.value[events.value.length - 1] ?? null)

        function reset(target: string, scope: string): void {
            instance.value = target
            folder.value = scope
            plan.value = null
            pid.value = null
            windowReadyOnce = false
            logPath.value = ''
            windowReadyOnce = false
            windowEvidence.value = ''
            events.value = []
            failure.value = null
            cancelled.value = false
            steps.value = [
                { key: 'verify', label: '检查文件完整性', state: 'pending' },
                { key: 'repair', label: '补全文件', state: 'pending' },
                { key: 'spawn', label: '拉起游戏进程', state: 'pending' },
                { key: 'window', label: '等待游戏窗口出现', state: 'pending' },
            ]
        }

        function setStep(key: string, state: LaunchStepState): void {
            steps.value = steps.value.map((step) => (step.key === key ? { ...step, state } : step))
        }

        function toFailure(error: unknown): LaunchFailure {
            return error instanceof BloomeryError
                ? {
                      code: error.code,
                      message: error.message,
                      detail: error.detail,
                      retryable: error.retryable,
                  }
                : { code: 'Unknown', message: String(error), detail: null, retryable: false }
        }

        /** 游戏目录：用于读游戏自己的日志 */
        const gameDirectory = ref('')
        /** 轮询次数，用于诊断心跳 */
        let pollTicks = 0
        /** 本次启动是否已经把游戏窗口带到前台（只做一次） */
        let windowReadyOnce = false

        let pollTimer: number | undefined

        function stopPolling(): void {
            if (pollTimer !== undefined) {
                window.clearInterval(pollTimer)
                pollTimer = undefined
            }
        }

        /**
         * 轮询：窗口标志行出现即算完成
         * 日志看两处 —— CLI 捕获的游戏 stdout，以及游戏自己的 <游戏目录>/logs/latest.log
         */
        /** 每秒问一次进程与日志：窗口标志行出现即算拉起完成 */
        function startPolling(): void {
            stopPolling()
            pollTimer = window.setInterval(async () => {
                try {
                    const status = await gameStatus(
                        pid.value,
                        [
                            logPath.value,
                            gameDirectory.value.length > 0
                                ? `${gameDirectory.value}/logs/latest.log`
                                : '',
                        ].filter((entry) => entry.length > 0),
                        !windowReadyOnce,
                    )
                    if (status.evidence !== windowEvidence.value) {
                        trace(
                            '窗口轮询',
                            status.evidence,
                            'alive=',
                            status.alive,
                            'ready=',
                            status.windowReady,
                        )
                    }
                    pollTicks += 1
                    // 每约 15 秒记一次心跳，避免"只在变化时记录"丢掉时间线
                    if (pollTicks % 10 === 0) {
                        trace('窗口轮询心跳', windowEvidence.value, 'alive=', status.alive)
                    }
                    windowEvidence.value = status.evidence
                    if (status.windowReady) {
                        setStep('window', 'done')
                        stopPolling()
                        windowReadyOnce = true
                        trace('窗口就绪', status.evidence)
                        return
                    }
                    if (status.alive === false) {
                        setStep('window', 'failed')
                        stopPolling()
                        trace('进程已退出，轮询停止', status.evidence)
                    }
                } catch (error) {
                    windowEvidence.value = error instanceof Error ? error.message : String(error)
                }
            }, 1500)
        }

        /** 读启动计划，只算不启动 */
        async function prepare(target: string, scope: string): Promise<CliLaunchResult | null> {
            reset(target, scope)
            // 只是读启动计划，进度面板等真启动再出现
            active.value = false
            steps.value = []
            busy.value = true
            try {
                const client = await useCli().client()
                const args = ['launch', target, '--dry-run']
                if (scope.length > 0) {
                    args.push('--folder', scope)
                }
                trace('launch 计划（dry-run）', args.join(' '))

                const result = await client.run<CliLaunchResult>(args, { progress: false })
                plan.value = result
                return result
            } catch (error) {
                failure.value = toFailure(error)
                return null
            } finally {
                busy.value = false
            }
        }

        /** 真启动：一律 --detach，顺带收进度事件 */
        async function start(target: string, scope: string): Promise<boolean> {
            if (steps.value.length === 0 || instance.value !== target) {
                reset(target, scope)
            }
            active.value = true
            busy.value = true
            failure.value = null
            cancelled.value = false
            events.value = []
            pid.value = null
            logPath.value = ''
            setStep('verify', 'done')
            setStep('repair', 'current')

            const id = `launch-${target}-${Date.now()}`
            callId.value = id
            try {
                const client = await useCli().client()
                const args = ['launch', target, '--detach']
                if (scope.length > 0) {
                    args.push('--folder', scope)
                }
                trace('launch 命令', args.join(' '))
                const result = await client.run<CliLaunchResult>(args, {
                    id,
                    onStderrLine: (line) => trace('cli stderr', line),
                    onProgress: (event) => {
                        events.value = [...events.value, event].slice(-200)
                    },
                })
                pid.value = result.pid ?? null
                logPath.value = result.log ?? ''
                gameDirectory.value = result.directory ?? ''
                trace('launch 返回 pid=', result.pid ?? null, 'log=', result.log ?? '(无)')
                setStep('repair', 'done')
                setStep('spawn', 'done')
                setStep('window', 'current')
                startPolling()
                return true
            } catch (error) {
                const state = cancelled.value ? 'pending' : 'failed'
                setStep('repair', state)
                if (!cancelled.value) {
                    failure.value = toFailure(error)
                    trace(
                        '启动失败 code=',
                        failure.value?.code,
                        'message=',
                        failure.value?.message,
                        'detail=',
                        failure.value?.detail ?? '(无)',
                        'retryable=',
                        failure.value?.retryable,
                    )
                }
                return false
            } finally {
                busy.value = false
                callId.value = ''
            }
        }

        /** 取消：杀掉正在干活的 CLI 进程 */
        async function cancel(): Promise<void> {
            stopPolling()
            const id = callId.value
            if (id.length === 0) {
                return
            }
            cancelled.value = true
            await killCli(id).catch(() => undefined)
        }

        function close(): void {
            stopPolling()
            active.value = false
            steps.value = []
            events.value = []
            failure.value = null
            cancelled.value = false
        }

        function setSkipConfirm(value: boolean): void {
            skipConfirm.value = value
        }

        return {
            skipConfirm,
            plan,
            instance,
            folder,
            pid,
            logPath,
            events,
            failure,
            cancelled,
            busy,
            active,
            windowEvidence,
            steps,
            running,
            latest,
            prepare,
            start,
            cancel,
            close,
            setSkipConfirm,
        }
    },
    {
        // 只留跨页面要用的小字段，进度事件不入本地存储
        persist: { pick: ['skipConfirm', 'instance', 'folder', 'pid', 'logPath'] },
    },
)
