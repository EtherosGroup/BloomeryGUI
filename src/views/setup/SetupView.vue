<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import Spinner from '@/components/Spinner.vue'
import {
    useEnvironmentCheckService,
    type EnvSituation,
    type UpdateOutcome,
} from '@/stores/EnvironmentCheckService'
import { useEnvironmentService } from '@/stores/EnvironmentService'
import type { PopupWindowButton } from '@/types/PopupWindowButton'
import { copyText } from '@/utils/clipboard'
import { notifyError, notifySuccess } from '@/utils/notify'

const router = useRouter()
const env = useEnvironmentCheckService()
const environment = useEnvironmentService()

/** 手动设置弹窗：node 给指引，bloomery 写路径 */
/** 动作弹窗：确认、二选一、终端命令、结果 */
const flow = ref<
    | ''
    | 'node-confirm'
    | 'node-brew-confirm'
    | 'bloomery-choose'
    | 'commands'
    | 'updating'
    | 'result'
>('')
const flowTitle = ref('')
const flowText = ref('')
const busy = ref(false)
/** 有 pnpm 时才让用户选 */
const hasPnpm = computed(() => env.pnpm.found)
const npmNote = computed(() => (hasPnpm.value ? '' : '未检测到 pnpm，将使用 npm'))

const manualOpen = ref(false)
const manualTarget = ref<'node' | 'bloomery'>('bloomery')
const manualValue = ref('')

const MESSAGES: Record<EnvSituation, string> = {
    'no-node': '未发现可用的 Node.js，是否要安装或者手动设置？',
    'no-bloomery': '未发现可用的 Bloomery引擎，是否要安装或者手动设置？',
    'node-too-old': '发现可用的 Node.js 但版本过低，是否要更新到最新版本的Node.js？',
    'bloomery-update': '发现可用的 Bloomery更新，是否要更新Bloomery？',
    ready: '环境就绪',
}

/** 手动设置 Node.js 的引导：Linux 按包管理器给命令，macOS 给安装途径 */
const nodeHint = computed(() => {
    if (env.isMacos) {
        const ways = [
            'Homebrew：brew install node',
            '官方安装包：https://nodejs.org/',
            'nvm：https://github.com/nvm-sh/nvm',
        ]
        return ways.join('\n')
    }
    const commands = [
        'Debian / Ubuntu：sudo apt install nodejs npm',
        'Fedora / RHEL：sudo dnf install nodejs npm',
        'Arch：sudo pacman -S nodejs npm',
        '通用：nvm install --lts && nvm alias default lts/*',
    ]
    return commands.join('\n')
})

const nodeText = computed(() => {
    if (!env.node.found) {
        return '未发现'
    }
    const suffix = env.nodeOutdated ? '（过低的版本）' : ''
    return `${env.node.version}${suffix}`
})

const bloomeryText = computed(() => {
    if (!env.bloomery.found) {
        return env.node.found ? '未发现' : '需要 Node.js'
    }
    if (env.bloomeryOutdated) {
        return `${env.bloomery.version}（有可用更新 ${env.latestBloomery}）`
    }
    return env.bloomery.version
})

const nodeAction = computed(() => (!env.node.found ? '安装' : '更新'))
const bloomeryAction = computed(() => (!env.bloomery.found ? '安装' : '更新'))

function openManual(target: 'node' | 'bloomery'): void {
    manualTarget.value = target
    manualValue.value = target === 'bloomery' ? environment.cliPath : ''
    manualOpen.value = true
}

function saveManual(): void {
    if (manualTarget.value === 'bloomery') {
        environment.cliPath = manualValue.value.trim()
        void env.check()
    }
}

function confirm(): void {
    void router.push('/')
}

/** 点 Node 的安装/更新 */
function actNode(): void {
    if (env.isLinux) {
        flowTitle.value = '在终端执行'
        flowText.value = env.installCommands.join('\n')
        flow.value = 'commands'
        return
    }
    if (env.isMacos) {
        if (!env.brew.found) {
            flowTitle.value = '在终端执行'
            flowText.value = env.installCommands.join('\n')
            flow.value = 'commands'
            return
        }
        flowTitle.value = '使用 Homebrew 安装 Node.js'
        flowText.value = '用 Homebrew 安装 Node.js · 命令输出会实时显示 · 过程中可以取消'
        flow.value = 'node-brew-confirm'
        return
    }
    if (env.node.found && env.nvm.found) {
        void runNode()
        return
    }
    flowTitle.value = '即将下载并运行 Node.js 安装包'
    flowText.value = env.nvm.found
        ? 'nvm 更新到最新 LTS，安装过程由 nvm 完成'
        : `未检测到 nvm 等更新工具 · 下载并运行最新版 Node.js 安装包 · 安装过程手动完成 · ${env.nodeInstaller.name || '无版本号'}`
    flow.value = 'node-confirm'
}

/** 点 Bloomery 的安装/更新 */
function actBloomery(): void {
    outcome.value = null
    if (env.pnpm.found) {
        flow.value = 'bloomery-choose'
        return
    }
    void runBloomery('npm')
}

async function runNode(): Promise<void> {
    busy.value = true
    outcome.value = null
    flowTitle.value = '更新 Node.js'
    flowText.value = '更新 Node.js'
    flow.value = 'updating'
    flowStartedAt.value = Date.now()
    startTicker()
    try {
        flowText.value = await env.updateNode()
    } catch (error) {
        flowText.value = error instanceof Error ? error.message : String(error)
    } finally {
        busy.value = false
        stopTicker()
        flowTitle.value = '结果'
        flow.value = 'result'
    }
}

async function runBloomery(manager: 'npm' | 'pnpm'): Promise<void> {
    busy.value = true
    outcome.value = null
    const verb = env.bloomery.found ? 'update' : 'install'
    flowText.value = manager === 'pnpm' ? 'pnpm add -g bloomery' : `npm ${verb} -g bloomery`
    flowTitle.value = '更新 Bloomery'
    flow.value = 'updating'
    flowStartedAt.value = Date.now()
    startTicker()
    try {
        outcome.value = await env.updateBloomery(manager)
    } catch (error) {
        outcome.value = {
            ok: false,
            cancelled: false,
            before: env.bloomery.version,
            after: env.bloomery.version,
            command: '',
            tail: [],
            error: error instanceof Error ? error.message : String(error),
        }
    } finally {
        busy.value = false
        stopTicker()
        flowTitle.value = '结果'
        flow.value = 'result'
    }
}

/** macOS：用 Homebrew 安装 Node.js（过期的 formula 会顺带升级），实时输出 */
async function runBrewNode(): Promise<void> {
    busy.value = true
    outcome.value = null
    flowText.value = 'brew install node'
    flowTitle.value = '更新 Node.js'
    flow.value = 'updating'
    flowStartedAt.value = Date.now()
    startTicker()
    try {
        outcome.value = await env.updateNodeWithBrew()
    } catch (error) {
        outcome.value = {
            ok: false,
            cancelled: false,
            before: env.node.version,
            after: env.node.version,
            command: '',
            tail: [],
            error: error instanceof Error ? error.message : String(error),
        }
    } finally {
        busy.value = false
        stopTicker()
        flowTitle.value = '结果'
        flow.value = 'result'
    }
}

/** 最近一次 Bloomery 更新的结果；node 那条仍用 flowText */
const outcome = ref<UpdateOutcome | null>(null)

/* ---------- 更新中的秒针与输出 ---------- */

const now = ref(Date.now())
const flowStartedAt = ref(0)
let ticker: number | undefined

function startTicker(): void {
    stopTicker()
    now.value = Date.now()
    ticker = window.setInterval(() => {
        now.value = Date.now()
    }, 1000)
}

function stopTicker(): void {
    if (ticker !== undefined) {
        window.clearInterval(ticker)
        ticker = undefined
    }
}

onBeforeUnmount(stopTicker)

const updateElapsed = computed(() => {
    if (flowStartedAt.value === 0) {
        return 0
    }
    return Math.max(0, Math.round((now.value - flowStartedAt.value) / 1000))
})

/** 更新输出尾部，空时显示占位 */
const updateTail = computed(() => env.updateLines.slice(-12).join('\n'))

/** 结果摘要：版本变了给前后对比 */
const outcomeText = computed(() => {
    const result = outcome.value
    if (result === null) {
        return flowText.value
    }
    if (result.cancelled) {
        return '已取消'
    }
    if (!result.ok) {
        return `更新失败 · ${result.error}`
    }
    return result.before === result.after
        ? `已是最新 · ${result.after}`
        : `已更新 · ${result.before} → ${result.after}`
})

/** 弹窗按钮随流程变化 */
const flowButtons = computed<PopupWindowButton[]>(() => {
    switch (flow.value) {
        // 长流程：不等待回调，按钮保持可用，弹窗留到用户关闭
        case 'bloomery-choose':
            return [
                { label: '取消' },
                { label: '用 pnpm', onClick: () => void runBloomery('pnpm'), closeOnClick: false },
                { label: '用 npm', onClick: () => void runBloomery('npm'), closeOnClick: false },
            ]
        case 'node-confirm':
            return [
                { label: '取消' },
                { label: '继续', onClick: () => void runNode(), closeOnClick: false },
            ]
        case 'node-brew-confirm':
            return [
                { label: '取消' },
                { label: '继续', onClick: () => void runBrewNode(), closeOnClick: false },
            ]
        case 'updating':
            return [{ label: '取消', onClick: abortUpdate, closeOnClick: false }]
        case 'result':
            return [
                { label: '复制命令', onClick: copyResultCommand, closeOnClick: false },
                { label: '知道了' },
            ]
        case 'commands':
            return [
                { label: '复制命令', onClick: copyInstallCommands, closeOnClick: false },
                { label: '知道了' },
            ]
        default:
            return [{ label: '知道了' }]
    }
})

async function copyTextAndToast(text: string): Promise<void> {
    const done = await copyText(text)
    if (done) {
        notifySuccess('已复制到剪贴板')
        return
    }
    notifyError('复制失败')
}

function copyInstallCommands(): void {
    void copyTextAndToast(env.installCommands.join('\n'))
}

function copyResultCommand(): void {
    void copyTextAndToast(outcome.value?.command ?? '')
}

function abortUpdate(): void {
    void env.cancelUpdate()
}

function closeFlow(): void {
    flow.value = ''
}

const flowOpen = computed({
    get: () => flow.value !== '',
    set: (value: boolean) => {
        // 更新中拒绝关闭请求
        if (!value && flow.value === 'updating') {
            return
        }
        if (!value) {
            closeFlow()
        }
    },
})

onMounted(() => {
    if (!env.checked) {
        void env.check()
    }
})
</script>

<template>
    <main class="setup">
        <section class="setup__center">
            <p class="setup__message">{{ MESSAGES[env.situation] }}</p>

            <div class="setup__table">
                <div class="setup__row">
                    <span class="setup__name">Node.js</span>
                    <span class="setup__value">{{ nodeText }}</span>
                    <span class="setup__actions">
                        <GroupButton variant="ghost" @click="openManual('node')"
                            >手动设置</GroupButton
                        >
                        <GroupButton :disabled="busy" @click="actNode">{{
                            nodeAction
                        }}</GroupButton>
                    </span>
                </div>

                <div class="setup__row">
                    <span class="setup__name">Bloomery</span>
                    <span class="setup__value">{{ bloomeryText }}</span>
                    <span class="setup__actions">
                        <GroupButton variant="ghost" @click="openManual('bloomery')">
                            手动设置
                        </GroupButton>
                        <GroupButton :disabled="busy" @click="actBloomery">
                            {{ bloomeryAction }}
                        </GroupButton>
                    </span>
                </div>
            </div>

            <p v-if="env.checking" class="setup__note">正在探测环境</p>
            <p v-else-if="env.latestNode.length > 0" class="setup__note">
                最新 Node.js LTS {{ env.latestNode }}
                <template v-if="env.latestBloomery.length > 0">
                    · 最新 Bloomery {{ env.latestBloomery }}
                </template>
            </p>
        </section>

        <GroupButton class="setup__ok" @click="confirm">确定</GroupButton>

        <PopupWindow v-model:open="flowOpen" :title="flowTitle" :buttons="flowButtons">
            <template v-if="flow === 'updating'">
                <p class="setup__note setup__progress">
                    <Spinner size="0.85rem" label="正在更新" />
                    <span>已用 {{ updateElapsed }} 秒</span>
                </p>
                <p class="setup__note">命令 {{ flowText }}</p>
                <pre class="setup__commands">{{ updateTail || '等待输出' }}</pre>
            </template>
            <template v-else-if="flow === 'result' && outcome !== null">
                <p class="setup__note">{{ outcomeText }}</p>
                <p v-if="outcome.command.length > 0" class="setup__note">
                    命令 {{ outcome.command }}
                </p>
                <pre v-if="outcome.tail.length > 0" class="setup__commands">{{
                    outcome.tail.join('\n')
                }}</pre>
            </template>
            <pre
                v-else-if="flow === 'commands' || flow === 'result'"
                class="setup__commands"
                >{{ flowText }}</pre>
            <template v-else>
                <p class="setup__note">{{ flowText }}</p>
                <p v-if="flow === 'bloomery-choose' && npmNote.length > 0" class="setup__note">
                    {{ npmNote }}
                </p>
            </template>
        </PopupWindow>

        <PopupWindow
            v-model:open="manualOpen"
            :title="manualTarget === 'bloomery' ? '手动设置 Bloomery 路径' : '手动设置 Node.js'"
            :buttons="[
                { label: '取消' },
                {
                    label: '保存',
                    onClick: saveManual,
                    closeOnClick: manualTarget === 'bloomery',
                },
            ]"
        >
            <template v-if="manualTarget === 'bloomery'">
                <GroupInput
                    v-model="manualValue"
                    label="CLI 路径"
                    placeholder="可执行文件，或 .js 入口"
                />
                <p class="setup__note">留空则使用 PATH 上的 bloomery</p>
            </template>
            <template v-else>
                <p class="setup__note">Node.js 安装后重新探测</p>
                <pre class="setup__commands">{{ nodeHint }}</pre>
            </template>
        </PopupWindow>
    </main>
</template>

<style scoped lang="scss">
.setup {
    position: relative;

    display: flex;
    height: 100%;
    flex-direction: column;
}

.setup__center {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;

    padding: 2rem;
}

.setup__message {
    margin: 0;

    font-size: var(--font-size-xl);
    text-align: center;
}

.setup__table {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    width: min(44rem, 100%);
}

.setup__row {
    display: flex;
    align-items: center;
    gap: 1rem;

    font-size: var(--font-size-sm);
}

.setup__name {
    flex: 0 0 6rem;

    font-weight: 600;
}

.setup__value {
    flex: 1;
    min-width: 0;

    color: var(--text-color-dark);

    word-break: break-all;
}

.setup__actions {
    display: flex;
    flex: 0 0 auto;
    gap: 0.5rem;
}

// 更新中秒针行
.setup__progress {
    display: flex;
    align-items: center;
    gap: 0.4rem;
}

.setup__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.setup__commands {
    margin: 0;
    padding: 0.5rem;

    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);
    white-space: pre-wrap;

    background-color: var(--bg-color-dark);
    border-radius: var(--border-radius);
}

.setup__ok {
    position: absolute;
    right: 1.5rem;
    bottom: 1.5rem;
}
</style>
