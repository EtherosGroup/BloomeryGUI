<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { PhArrowRight, PhCheck, PhWarning } from '@phosphor-icons/vue'
import GroupButton from '@/components/GroupButton.vue'
import { errorSummary } from '@/api/errorMessages'
import { useLaunchService } from '@/stores/LaunchService'

const launch = useLaunchService()

const visible = computed(() => launch.active && launch.steps.length > 0)

/** 最近一条进度：阶段与计数 */
const progressText = computed(() => {
    const event = launch.latest
    if (event === null) {
        return ''
    }
    return event.total > 0 ? `${event.stage} ${event.done}/${event.total}` : event.stage
})

const finished = computed(
    () => launch.steps.length > 0 && launch.steps.every((step) => step.state === 'done'),
)

const failureText = computed(() => {
    const failure = launch.failure
    if (failure === null) {
        return ''
    }
    const detail = failure.detail === null ? '' : ` · ${failure.detail}`
    return `${errorSummary(failure.code, failure.message)}${detail}`
})

function close(): void {
    launch.close()
}

// 窗口出现（四步全完成）后自动收起，留一小段时间让人看见结果
let hideTimer: number | undefined

watch(finished, (done) => {
    if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer)
        hideTimer = undefined
    }
    if (!done) {
        return
    }
    hideTimer = window.setTimeout(() => {
        hideTimer = undefined
        launch.close()
    }, 1200)
})

onBeforeUnmount(() => {
    if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer)
    }
})
</script>

<template>
    <Transition name="launching">
        <div v-if="visible" class="launching">
            <section class="launching__panel">
                <h2 class="launching__title">正在启动游戏 {{ launch.instance }}</h2>

                <ul class="launching__steps">
                    <li
                        v-for="step in launch.steps"
                        :key="step.key"
                        class="launching__step"
                        :class="`launching__step--${step.state}`"
                    >
                        <span class="launching__mark" aria-hidden="true">
                            <PhCheck v-if="step.state === 'done'" :size="14" weight="bold" />
                            <PhArrowRight
                                v-else-if="step.state === 'current'"
                                :size="14"
                                weight="bold"
                            />
                            <PhWarning
                                v-else-if="step.state === 'failed'"
                                :size="14"
                                weight="bold"
                            />
                            <span v-else class="launching__dot"></span>
                        </span>
                        <span class="launching__label">{{ step.label }}</span>
                    </li>
                </ul>

                <p v-if="progressText" class="launching__progress">{{ progressText }}</p>

                <p v-if="launch.cancelled" class="launching__note">已取消</p>
                <p v-else-if="failureText" class="launching__failure">{{ failureText }}</p>
                <p v-else-if="launch.pid !== null" class="launching__note">
                    进程 PID {{ launch.pid }}
                    <template v-if="launch.windowEvidence"> · {{ launch.windowEvidence }}</template>
                </p>

                <footer class="launching__actions">
                    <GroupButton v-if="launch.busy" variant="ghost" @click="launch.cancel">
                        取消
                    </GroupButton>
                    <!-- 全部完成后自动收起，失败或取消时才需要手动关 -->
                    <GroupButton v-else-if="!finished" @click="close">关闭</GroupButton>
                </footer>
            </section>
        </div>
    </Transition>
</template>

<style scoped lang="scss">
.launching {
    position: fixed;
    inset: 0;
    z-index: 150;

    display: grid;
    place-items: center;

    padding: 1.5rem;

    background-color: rgb(0 0 0 / 0.4);

    transition: opacity var(--transition-duration) var(--transition-ease);
}

/* 与 PopupWindow 同一套进出场：遮罩淡入淡出、面板再叠位移与缩放 */
.launching-enter-from,
.launching-leave-to {
    opacity: 0;
}

.launching-enter-from .launching__panel,
.launching-leave-to .launching__panel {
    opacity: 0;
    transform: translateY(0.5rem) scale(0.97);
}

.launching__panel {
    display: flex;
    width: min(26rem, 100%);
    flex-direction: column;
    gap: 0.75rem;

    padding: 1rem;

    color: var(--text-color);

    background-color: var(--bg-color);
    border: 1px solid var(--text-color-dark);
    border-radius: var(--border-radius);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);

    transition:
        opacity var(--transition-duration) var(--transition-ease),
        transform var(--transition-duration) var(--transition-ease);
}

.launching__title {
    margin: 0;

    font-size: var(--font-size-lg);
    word-break: break-all;
}

.launching__steps {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

.launching__step {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    font-size: var(--font-size-sm);
}

.launching__step--pending {
    color: var(--text-color-dark);
}

.launching__step--current {
    font-weight: 600;
}

.launching__step--failed {
    color: #c62828;
}

.launching__mark {
    display: grid;
    place-items: center;

    width: 1rem;
    height: 1rem;
}

.launching__dot {
    width: 4px;
    height: 4px;

    background-color: currentColor;
    border-radius: 50%;
}

.launching__label {
    word-break: break-all;
}

.launching__progress {
    margin: 0;

    color: var(--text-color-dark);
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);

    word-break: break-all;
}

.launching__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.launching__failure {
    margin: 0;

    font-size: var(--font-size-xs);

    word-break: break-all;
}

.launching__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
}

@media (prefers-reduced-motion: reduce) {
    .launching,
    .launching__panel {
        transition: none;
    }
}
</style>
