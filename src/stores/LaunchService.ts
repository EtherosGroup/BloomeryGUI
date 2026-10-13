import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { killCli } from '@/api/transport.tauri'
import { appendDiag } from '@/api/diagnostics'
import { gameStatus, logSizes, type GameLog } from '@/api/game'
import type { CliLaunchResult, CliProgressEvent } from '@/api/types'
import { useCli } from '@/composables/useCli'
import { useAccountService } from '@/stores/AccountService'
import {
    credentialsExpired,
    launchPhaseHint,
    launchSteps,
    planNeedsRefresh,
    type LaunchStep,
    type LaunchStepState,
} from '@/utils/launchPhase'

export type { LaunchStep, LaunchStepState } from '@/utils/launchPhase'

/** 诊断行：带时间戳写入应用数据目录的 diag.log，写失败不影响主流程 */
function trace(...parts: unknown[]): void {
    const line = `[${new Date().toISOString()}] ${parts.map((part) => String(part)).join(' ')}`
    void appendDiag([line])
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
        /** 补全时的警告：资源索引一类补不动的项只说在这里 */
        const warnings = ref<string[]>([])

        const steps = ref<LaunchStep[]>([])

        const running = computed(() => busy.value)

        /** 本次启动微软凭据待续期；续期期间 CLI 无进度事件 */
        const credentialsPending = ref(false)

        /** 当前正在做的那一步，没有则为 null */
        const currentStep = computed(
            () => steps.value.find((step) => step.state === 'current') ?? null,
        )

        /** 准备阶段：dry-run 期间，遮罩还没出来，调用方自己给按钮上的反馈 */
        const preparing = computed(() => busy.value && !active.value)

        /**
         * 已用秒数
         *
         * 续期期间 CLI 无输出，秒针是界面唯一的活动反馈
         */
        const elapsedSeconds = computed(() => {
            void clockTick.value
            if (startedAt.value === 0) {
                return 0
            }
            return Math.max(0, Math.round((Date.now() - startedAt.value) / 1000))
        })

        /** 当前步骤的说明 */
        const phaseHint = computed(() => launchPhaseHint(currentStep.value?.key ?? null))

        /** 起始时刻与秒针 */
        const startedAt = ref(0)
        const clockTick = ref(0)
        let clockTimer: number | undefined

        function stopClock(): void {
            if (clockTimer !== undefined) {
                window.clearInterval(clockTimer)
                clockTimer = undefined
            }
        }

        function startClock(): void {
            stopClock()
            startedAt.value = Date.now()
            clockTick.value = 0
            clockTimer = window.setInterval(() => {
                clockTick.value += 1
            }, 1000)
        }

        /** 手上这份计划是不是这次要启动的实例的：计划里的 version 就是实例 id */
        function planOf(target: string): CliLaunchResult | null {
            const current = plan.value
            return current !== null && current.version === target ? current : null
        }

        /**
         * 这次真启动是否先续期
         *
         * 优先取计划里的 needsRefresh：1.13.1 起 dry-run 不再续期，计划反映的就是真启动前的状态
         * 没走 prepare、或引擎没有这个字段时，退回账户列表的状态判断
         */
        function credentialsStale(target: string): boolean {
            const fromPlan = planNeedsRefresh(planOf(target)?.account)
            return fromPlan ?? credentialsExpired(useAccountService().selected)
        }

        function reset(target: string, scope: string): void {
            // 先按当前计划判断，随后清掉计划
            refreshSteps(target)
            instance.value = target
            folder.value = scope
            plan.value = null
            pid.value = null
            logPath.value = ''
            gameDirectory.value = ''
            logs.value = []
            pollTicks = 0
            windowEvidence.value = ''
            events.value = []
            failure.value = null
            cancelled.value = false
        }

        /**
         * 重算凭据那一步
         *
         * 同实例连续启动不重建步骤，凭据续期后这一步不再出现，
         * 结论按当前计划重取
         */
        function refreshSteps(target: string): void {
            credentialsPending.value = credentialsStale(target)
            steps.value = launchSteps(credentialsPending.value)
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
        /** 本次启动要看的日志与水位 */
        const logs = ref<GameLog[]>([])
        /** 轮询次数，用于诊断心跳 */
        let pollTicks = 0

        let pollTimer: number | undefined

        function stopPolling(): void {
            if (pollTimer !== undefined) {
                window.clearInterval(pollTimer)
                pollTimer = undefined
            }
        }

        /**
         * 本次启动要看的日志：CLI 捕获的游戏 stdout，以及游戏自己的 <游戏目录>/logs/latest.log
         * 启动时记下两份日志的大小作水位，上一次会话留下的标志行不算本次启动
         */
        async function collectLogs(result: CliLaunchResult): Promise<GameLog[]> {
            const paths = [
                result.log ?? '',
                gameDirectory.value.length > 0 ? `${gameDirectory.value}/logs/latest.log` : '',
            ].filter((entry) => entry.length > 0)
            try {
                const sizes = await logSizes(paths)
                return paths.map((path, index) => ({ path, since: sizes[index] ?? 0 }))
            } catch {
                // 记不下水位就只靠窗口枚举判定
                return []
            }
        }

        /** 每秒问一次进程与日志：窗口标志行出现即算拉起完成 */
        function startPolling(): void {
            stopPolling()
            pollTimer = window.setInterval(async () => {
                try {
                    const status = await gameStatus(
                        pid.value,
                        logs.value.length > 0 ? logs.value : null,
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
                        trace('窗口轮询心跳', status.evidence, 'alive=', status.alive)
                    }
                    windowEvidence.value = status.evidence
                    if (status.windowReady) {
                        setStep('window', 'done')
                        stopPolling()
                        stopClock()
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
            // dry-run 只算不联网，重复点会起多个 CLI 进程
            if (busy.value) {
                return null
            }
            busy.value = true
            // 只是读启动计划，进度面板等真启动再出现
            active.value = false
            startClock()
            try {
                reset(target, scope)
                setStep('verify', 'current')
                const client = await useCli().client()
                const args = ['launch', target, '--dry-run']
                if (scope.length > 0) {
                    args.push('--folder', scope)
                }
                trace('launch 计划（dry-run）', args.join(' '))

                const result = await client.run<CliLaunchResult>(args, { progress: false })
                plan.value = result
                // 计划里带着 needsRefresh，真启动会不会先续期以它为准
                refreshSteps(target)
                return result
            } catch (error) {
                failure.value = toFailure(error)
                return null
            } finally {
                busy.value = false
                stopClock()
            }
        }

        /** 真启动：一律 --detach，顺带收进度事件 */
        async function start(target: string, scope: string): Promise<boolean> {
            if (busy.value) {
                return false
            }
            active.value = true
            busy.value = true
            startClock()
            failure.value = null
            cancelled.value = false
            events.value = []
            pid.value = null
            logPath.value = ''
            // 同实例再启动不走 reset，水位在这里清掉
            gameDirectory.value = ''
            logs.value = []
            windowEvidence.value = ''
            // 正常流程里刚跑过 dry-run，计划里的 needsRefresh 就是这次的判据
            if (steps.value.length === 0 || instance.value !== target) {
                reset(target, scope)
            } else {
                refreshSteps(target)
            }
            setStep('verify', 'done')
            // 凭据过期时先续期，该步无进度事件，单独列一步
            setStep(credentialsPending.value ? 'credentials' : 'repair', 'current')

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
                warnings.value = result.repair?.warnings ?? []
                for (const warning of warnings.value) {
                    trace('补全警告', warning)
                }
                logs.value = await collectLogs(result)
                trace('launch 返回 pid=', result.pid ?? null, 'log=', result.log ?? '(无)')
                setStep('credentials', 'done')
                setStep('repair', 'done')
                setStep('spawn', 'done')
                setStep('window', 'current')
                startPolling()
                return true
            } catch (error) {
                const state = cancelled.value ? 'pending' : 'failed'
                setStep('credentials', state)
                setStep('repair', state)
                stopClock()
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
            stopClock()
            const id = callId.value
            if (id.length === 0) {
                return
            }
            cancelled.value = true
            await killCli(id).catch(() => undefined)
        }

        function close(): void {
            stopPolling()
            stopClock()
            startedAt.value = 0
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
            warnings,
            steps,
            credentialsPending,
            currentStep,
            preparing,
            elapsedSeconds,
            phaseHint,
            running,
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
