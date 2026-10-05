<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import GroupButton from '@/components/GroupButton.vue'
import type { PopupWindowButton } from '@/types/PopupWindowButton'

const props = withDefaults(
    defineProps<{
        title: string
        /** 补充说明，可空 */
        context?: string
        buttons?: PopupWindowButton[]
    }>(),
    {
        context: '',
        buttons: () => [],
    },
)

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ close: [] }>()

const titleId = useId()
const panel = ref<HTMLElement | null>(null)
const busy = ref(false)

function close(): void {
    open.value = false
    emit('close')
}

/** 按钮回调跑完再决定是否关闭 */
async function run(button: PopupWindowButton): Promise<void> {
    busy.value = true
    try {
        await button.onClick?.()
    } finally {
        busy.value = false
    }
    if (button.closeOnClick ?? true) {
        close()
    }
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open.value) {
        event.stopPropagation()
        close()
    }
}

// 打开时接管焦点与 Esc；遮罩不响应点击
watch(open, (visible) => {
    if (visible) {
        document.addEventListener('keydown', onKeydown)
        void nextTick(() => panel.value?.focus())
        return
    }
    document.removeEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
    <Teleport to="body">
        <Transition name="popup">
            <div v-if="open" class="popup">
                <div
                    ref="panel"
                    class="popup__panel"
                    role="dialog"
                    aria-modal="true"
                    :aria-labelledby="titleId"
                    tabindex="-1"
                >
                    <header class="popup__head">
                        <h2 :id="titleId" class="popup__title">{{ props.title }}</h2>
                        <button
                            type="button"
                            class="popup__close"
                            aria-label="关闭"
                            title="关闭"
                            @click="close"
                        >
                            <PhX :size="16" weight="regular" aria-hidden="true" />
                        </button>
                    </header>

                    <p v-if="props.context.length > 0" class="popup__context">
                        {{ props.context }}
                    </p>

                    <slot />

                    <footer v-if="props.buttons.length > 0" class="popup__actions">
                        <GroupButton
                            v-for="button in props.buttons"
                            :key="button.label"
                            variant="ghost"
                            :disabled="busy"
                            @click="run(button)"
                        >
                            {{ button.label }}
                        </GroupButton>
                    </footer>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped lang="scss">
.popup {
    position: fixed;
    inset: 0;
    z-index: 200;

    display: grid;
    place-items: center;

    padding: 1.5rem;

    background-color: rgb(0 0 0 / 0.45);

    transition: opacity var(--transition-duration) var(--transition-ease);
}

/* 遮罩淡入淡出，面板再叠一点位移与缩放 */
.popup-enter-from,
.popup-leave-to {
    opacity: 0;
}

.popup-enter-from .popup__panel,
.popup-leave-to .popup__panel {
    opacity: 0;
    transform: translateY(0.5rem) scale(0.97);
}

.popup__panel {
    display: flex;
    width: min(30rem, 100%);
    flex-direction: column;
    gap: 0.75rem;

    max-height: 100%;
    padding: 1rem;

    overflow-y: auto;

    color: var(--text-color);

    background-color: var(--bg-color);
    border: 1px solid var(--text-color-dark);
    border-radius: var(--border-radius);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.35);

    transition:
        opacity var(--transition-duration) var(--transition-ease),
        transform var(--transition-duration) var(--transition-ease);

    &:focus-visible {
        outline: none;
    }
}

.popup__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
}

.popup__title {
    margin: 0;

    font-size: var(--font-size-lg);
    word-break: break-all;
}

.popup__close {
    display: grid;
    place-items: center;

    flex: 0 0 auto;

    width: 1.75rem;
    height: 1.75rem;
    padding: 0;

    color: var(--text-color);

    background-color: transparent;
    border: none;
    border-radius: calc(var(--border-radius) / 2);
    cursor: pointer;

    transition: background-color var(--transition-duration) var(--transition-ease);

    &:hover {
        background-color: var(--button-bg-color);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }
}

.popup__context {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-sm);
    word-break: break-all;
}

.popup__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
}

@media (prefers-reduced-motion: reduce) {
    .popup,
    .popup__panel {
        transition: none;
    }
}
</style>
