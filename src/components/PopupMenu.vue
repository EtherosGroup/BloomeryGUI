<script setup lang="ts">
import { type ComponentPublicInstance } from 'vue'
import { usePopover } from '@/composables/usePopover'

export interface PopupMenuItem {
    label: string
    onClick?: () => void | Promise<void>
    /** 危险操作，按警示色显示 */
    danger?: boolean
}

const props = withDefaults(
    defineProps<{
        items: PopupMenuItem[]
        /** 触发元素选择器，默认 .popup-menu__trigger */
        trigger?: string
        /** 手动模式：不接管宿主点击，由调用方决定何时展开 */
        manual?: boolean
    }>(),
    {
        trigger: '.popup-menu__trigger',
        manual: false,
    },
)

const { root, content, open, anchor, place, close, toggle } = usePopover({
    trigger: props.trigger,
    placement: 'below',
})

/** 函数 ref：字符串 ref 的写法拿不到 TS 的“已使用”判定 */
function bindRoot(el: Element | ComponentPublicInstance | null): void {
    root.value = el instanceof HTMLElement ? el : null
}

function bindContent(el: Element | ComponentPublicInstance | null): void {
    content.value = el instanceof HTMLElement ? el : null
}

/** 选中项：先关层再执行，避免回调里改状态后浮层还挂着 */
async function run(item: PopupMenuItem): Promise<void> {
    close()
    await item.onClick?.()
}

defineExpose({ place, toggle, close, open })
</script>

<template>
    <span :ref="bindRoot" class="popup-menu">
        <span class="popup-menu__trigger" @click="props.manual ? undefined : toggle()">
            <slot />
        </span>
    </span>

    <Teleport to="body">
        <Transition name="popup-menu">
            <ul
                v-if="open"
                :ref="bindContent"
                class="popup-menu__list"
                :style="{
                    top: anchor.top === null ? undefined : `${anchor.top}px`,
                    bottom: anchor.bottom === null ? undefined : `${anchor.bottom}px`,
                    left: anchor.left === null ? undefined : `${anchor.left}px`,
                    right: anchor.right === null ? undefined : `${anchor.right}px`,
                    maxHeight: `${anchor.maxHeight}px`,
                }"
            >
                <li v-for="item in items" :key="item.label">
                    <button
                        type="button"
                        class="popup-menu__item"
                        :class="{ 'popup-menu__item--danger': item.danger }"
                        @click="run(item)"
                    >
                        {{ item.label }}
                    </button>
                </li>
            </ul>
        </Transition>
    </Teleport>
</template>

<style scoped lang="scss">
.popup-menu {
    display: inline-flex;
}

.popup-menu__trigger {
    display: inline-flex;
}

.popup-menu__list {
    position: fixed;
    z-index: 60;

    transition:
        opacity var(--transition-duration) var(--transition-ease),
        transform var(--transition-duration) var(--transition-ease);

    display: flex;
    flex-direction: column;

    min-width: 9rem;
    margin: 0;
    padding: 0.25rem;

    overflow-y: auto;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: var(--bg-color);
    border: 1px solid var(--text-color-dark);
    border-radius: var(--border-radius);
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.25);

    list-style: none;
}

.popup-menu-enter-from,
.popup-menu-leave-to {
    opacity: 0;
    transform: translateY(-0.3rem);
}

.popup-menu__item {
    width: 100%;
    padding: 0.35rem 0.5rem;

    color: inherit;
    font: inherit;
    text-align: left;

    background-color: transparent;
    border: none;
    border-radius: calc(var(--border-radius) / 1.5);
    cursor: pointer;

    transition: background-color var(--transition-duration) var(--transition-ease);

    &:hover {
        background-color: var(--button-bg-color);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: -2px;
    }
}

.popup-menu__item--danger {
    color: #c62828;
}

@media (prefers-reduced-motion: reduce) {
    .popup-menu__list {
        transition: none;
    }
}
</style>
