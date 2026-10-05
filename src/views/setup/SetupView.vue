<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import { useEnvironmentCheckService, type EnvSituation } from '@/stores/EnvironmentCheckService'
import { useEnvironmentService } from '@/stores/EnvironmentService'

const router = useRouter()
const env = useEnvironmentCheckService()
const environment = useEnvironmentService()

/** 手动设置弹窗：node 给指引，bloomery 写路径 */
/** 动作弹窗：确认、二选一、终端命令、结果 */
const flow = ref<'' | 'node-confirm' | 'bloomery-choose' | 'linux-commands' | 'result'>('')
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

/** Linux 引导用户在终端执行，按包管理器给命令 */
const linuxHint = computed(() => {
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
        flowText.value = env.linuxCommands.join('\n')
        flow.value = 'linux-commands'
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
    if (env.isLinux) {
        flowTitle.value = '在终端执行'
        flowText.value = env.linuxCommands.join('\n')
        flow.value = 'linux-commands'
        return
    }
    if (env.pnpm.found) {
        flow.value = 'bloomery-choose'
        return
    }
    void runBloomery('npm')
}

async function runNode(): Promise<void> {
    busy.value = true
    flow.value = ''
    try {
        flowText.value = await env.updateNode()
    } catch (error) {
        flowText.value = error instanceof Error ? error.message : String(error)
    } finally {
        busy.value = false
        flowTitle.value = '结果'
        flow.value = 'result'
    }
}

async function runBloomery(manager: 'npm' | 'pnpm'): Promise<void> {
    busy.value = true
    flow.value = ''
    try {
        flowText.value = await env.updateBloomery(manager)
    } catch (error) {
        flowText.value = error instanceof Error ? error.message : String(error)
    } finally {
        busy.value = false
        flowTitle.value = '结果'
        flow.value = 'result'
    }
}

function closeFlow(): void {
    flow.value = ''
}

const flowOpen = computed({
    get: () => flow.value !== '',
    set: (value: boolean) => {
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

        <PopupWindow
            v-model:open="flowOpen"
            :title="flowTitle"
            :buttons="
                flow === 'bloomery-choose'
                    ? [
                          { label: '取消' },
                          { label: '用 pnpm', onClick: () => runBloomery('pnpm') },
                          { label: '用 npm', onClick: () => runBloomery('npm') },
                      ]
                    : flow === 'node-confirm'
                      ? [{ label: '取消' }, { label: '继续', onClick: runNode }]
                      : [{ label: '知道了' }]
            "
        >
            <pre v-if="flow === 'linux-commands' || flow === 'result'" class="setup__commands">{{
                flowText
            }}</pre>
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
                <pre class="setup__commands">{{ linuxHint }}</pre>
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
