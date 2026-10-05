<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import { errorSummary } from '@/api/errorMessages'
import { useCli } from '@/composables/useCli'
import GroupButton from '@/components/GroupButton.vue'
import GroupLabel from '@/components/GroupLabel.vue'
import GroupSelect from '@/components/GroupSelect.vue'
import GameLaunching from '@/components/GameLaunching.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import GroupSwitch from '@/components/GroupSwitch.vue'
import { useLaunchService } from '@/stores/LaunchService'
import { useVersionService } from '@/stores/VersionService'
import type { CliLaunchResult } from '@/api/types'
import type { ChoiceOptionType } from '@/types/ChoiceOptionType'
import { notifySuccess, notifyError } from '@/utils/notify'

type TimeSection = 'morning' | 'noon' | 'afternoon' | 'night' | 'midnight' | 'dawn'

function getTimeSection(): TimeSection {
    const hour = new Date().getHours()

    if (hour >= 5 && hour < 8) {
        return 'dawn'
    }
    if (hour >= 8 && hour < 11) {
        return 'morning'
    }
    if (hour >= 11 && hour < 13) {
        return 'noon'
    }
    if (hour >= 13 && hour < 18) {
        return 'afternoon'
    }
    if (hour >= 18 && hour < 23) {
        return 'night'
    }
    // 23:00 - 04:59
    return 'midnight'
}

function getGreeting(): string {
    switch (getTimeSection()) {
        case 'dawn':
            return '凌晨'
        case 'morning':
            return '早上好'
        case 'noon':
            return '中午好'
        case 'afternoon':
            return '下午好'
        case 'night':
            return '入夜了'
        case 'midnight':
            return '午夜了'
        default:
            return '欢迎使用 Bloomery Launcher'
    }
}

const appVersion = __APP_VERSION__

const engineVersion = ref('')
const engineFailure = ref('')
const versionService = useVersionService()

const instanceOptions = computed<ChoiceOptionType[]>(() =>
    versionService.instances.map((instance) => ({
        label: instance.id,
        value: instance.id,
        disabled: instance.state !== 'ready',
    })),
)

/** 选择框与 CLI 的选中实例双向对齐，改动即切换 */
const choice = computed<string>({
    get: () => versionService.selectedInstance ?? '',
    set: (value) => void switchInstance(value),
})

async function switchInstance(id: string): Promise<void> {
    if (id.length === 0 || id === versionService.selectedInstance) {
        return
    }
    await versionService.select(id)
    const failure = versionService.failure
    if (failure !== null) {
        const detail = failure.detail === null ? '' : ` · ${failure.detail}`
        notifyError(`${errorSummary(failure.code, failure.message)}${detail}`)
    }
}

const launchService = useLaunchService()
const confirmOpen = ref(false)
const skipNext = ref(false)
const planInfo = ref<CliLaunchResult | null>(null)

/** 确认弹窗里的启动信息 */
const confirmRows = computed(() => {
    const plan = planInfo.value
    if (plan === null) {
        return []
    }
    const memory = (plan.args ?? []).find((arg) => arg.startsWith('-Xmx')) ?? ''
    return [
        { key: '实例', value: plan.version },
        {
            key: '账户',
            value:
                plan.account === undefined
                    ? '未知'
                    : `${plan.account.name}（${plan.account.kind}）`,
        },
        {
            key: 'Java',
            value: plan.java === undefined ? '未知' : `${plan.java.major} · ${plan.java.vendor}`,
        },
        { key: '内存', value: memory.length > 0 ? memory.replace('-Xmx', '') : '按配置' },
    ]
})

/** 启动选中实例：先取启动计划，再按设置决定是否确认 */
async function requestLaunch(): Promise<void> {
    const id = versionService.selectedInstance
    if (id === null) {
        notifyError('未选择实例')
        return
    }
    const plan = await launchService.prepare(id, versionService.list?.id ?? '')
    if (plan === null) {
        const failure = launchService.failure
        if (failure !== null) {
            const detail = failure.detail === null ? '' : ` · ${failure.detail}`
            notifyError(`${errorSummary(failure.code, failure.message)}${detail}`)
        }
        return
    }
    if (launchService.skipConfirm) {
        await runLaunch(id)
        return
    }
    planInfo.value = plan
    skipNext.value = false
    confirmOpen.value = true
}

async function confirmLaunch(): Promise<void> {
    confirmOpen.value = false
    const id = versionService.selectedInstance
    if (id === null) {
        return
    }
    if (skipNext.value) {
        launchService.setSkipConfirm(true)
    }
    await runLaunch(id)
}

async function runLaunch(id: string): Promise<void> {
    const ok = await launchService.start(id, versionService.list?.id ?? '')
    if (!ok) {
        const failure = launchService.failure
        if (failure !== null) {
            const detail = failure.detail === null ? '' : ` · ${failure.detail}`
            notifyError(`${errorSummary(failure.code, failure.message)}${detail}`)
        }
        return
    }
    notifySuccess(`已启动 · ${id}`)
}

onMounted(async () => {
    try {
        const info = await (await useCli().client()).probe()
        engineVersion.value = info.version
    } catch (error) {
        engineFailure.value = error instanceof BloomeryError ? error.code : 'Unknown'
    }
    await versionService.load()
})
</script>

<template>
    <div class="container">
        <div class="overview">
            <p class="overview__title">{{ getGreeting() }}</p>
            <p class="overview__subtitle">APP 版本 {{ appVersion }}</p>
            <p class="overview__subtitle">
                引擎版本 {{ engineVersion.length > 0 ? engineVersion : engineFailure || '未检测' }}
            </p>
        </div>

        <div class="quick-start">
            <div class="quick-start__main">
                <GroupButton block @click="requestLaunch">启动游戏</GroupButton>
                <GroupLabel class="quick-start__instance">
                    {{ versionService.selectedInstance ?? '未选择实例' }}
                </GroupLabel>
            </div>
            <GroupSelect
                v-model="choice"
                icon
                label="选择实例"
                :options="instanceOptions"
            ></GroupSelect>
        </div>

        <PopupWindow
            v-model:open="confirmOpen"
            title="启动游戏"
            :buttons="[{ label: '取消' }, { label: '启动', onClick: confirmLaunch }]"
        >
            <div class="overview__confirm">
                <div v-for="row in confirmRows" :key="row.key" class="overview__confirm-row">
                    <span class="overview__confirm-key">{{ row.key }}</span>
                    <span class="overview__confirm-value">{{ row.value }}</span>
                </div>
                <GroupSwitch v-model="skipNext" label="不再询问" />
            </div>
        </PopupWindow>

        <GameLaunching />
    </div>
</template>

<style scoped lang="scss">
.container {
    display: flex;
}

.overview {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    padding: 1rem;
}

.overview__title {
    font-size: var(--font-size-3xl);
    font-weight: 600;
}

.overview__subtitle {
    color: var(--text-color-dark);
    font-size: var(--font-size-sm);
}

.quick-start {
    position: fixed;
    right: 1rem;
    bottom: 1rem;

    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 0.5rem;

    width: 15%;
    height: 10%;

    &__main {
        display: flex;
        flex: 1;
        align-self: stretch;
        min-width: 0;
        flex-direction: column;
        align-items: stretch;
        gap: 0.25rem;

        /* 按钮吃掉剩余高度，label 保持自身高度 */
        > :first-child {
            flex: 1;
        }
    }
}

.quick-start__instance {
    text-align: center;
}
</style>
