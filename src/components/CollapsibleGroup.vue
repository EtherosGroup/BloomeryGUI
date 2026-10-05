<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { VNode } from 'vue'
import { PhCaretDown } from '@phosphor-icons/vue'

const props = withDefaults(
    defineProps<{
        label?: string // 分组标题；用 header 插槽自定义标题时可不传
        defaultOpen?: boolean // 初始展开状态，默认 false（折叠）
    }>(),
    {
        defaultOpen: false,
    },
)

/*
 * 展开状态：无 v-model:open 时组件内部持有，初始值取 defaultOpen
 * model 的 default 写 undefined：布尔 prop 缺省时 Vue 兜成 false
 * （resolvePropValue：isAbsent && !hasDefault），defaultOpen 会被跳过
 */
const model = defineModel<boolean | undefined>('open', { default: undefined })
const localOpen = ref(props.defaultOpen)
const isOpen = computed(() => model.value ?? localOpen.value)

defineSlots<{
    default?: (props: { open: boolean }) => VNode[] // 分组内容；open 为当前展开状态
    header?: (props: { open: boolean }) => VNode[] // 自定义标题；不给则渲染 label
}>()

const uid = useId()
const bodyId = `${uid}-body`

function toggle(): void {
    if (model.value === undefined) {
        localOpen.value = !localOpen.value
    } else {
        model.value = !model.value
    }
}
</script>

<template>
    <section class="group">
        <button
            type="button"
            class="group__toggle"
            :aria-expanded="isOpen"
            :aria-controls="bodyId"
            @click="toggle"
        >
            <slot name="header" :open="isOpen">
                <span class="group__label">{{ props.label }}</span>
            </slot>
            <PhCaretDown class="group__caret" :size="16" weight="regular" aria-hidden="true" />
        </button>

        <div :id="bodyId" class="group__body">
            <div class="group__inner">
                <div class="group__content">
                    <slot :open="isOpen" />
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped lang="scss">
.group {
    display: flex;
    flex-direction: column;

    // 展开区底色
    background-color: var(--group-content-bg);
    border: 1px solid color-mix(in srgb, var(--text-color) 10%, transparent);
    border-radius: var(--border-radius);
}

.group__toggle {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    width: 100%;
    min-height: 2.75rem;
    padding: 0.25rem 0.75rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);
    text-align: left;
    user-select: none;

    // 头部底色
    background-color: var(--group-header-bg);
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);

    // 展开时下方两角不圆，与内容区之间不留缺口
    &[aria-expanded='true'] {
        border-bottom-right-radius: 0;
        border-bottom-left-radius: 0;
    }

    &:hover {
        background-color: var(--button-bg-color-dark);
    }

    &:active {
        opacity: 0.8;
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }
}

.group__label {
    flex: 1;
    font-size: var(--font-size-2xl);
}

.group__caret {
    flex: 0 0 auto;
    opacity: 0.7;

    transition: transform var(--transition-duration) var(--transition-ease);
}

.group__toggle[aria-expanded='true'] .group__caret {
    transform: rotate(180deg);
}

/*
 * 折叠态为默认值，展开态按 aria-expanded 由相邻兄弟选择器覆盖
 * grid-template-rows 管高度，visibility 管可达性：显现立即可见，隐藏留到动画结束
 */
.group__body {
    display: grid;
    grid-template-rows: 0fr;

    visibility: hidden;

    transition:
        grid-template-rows var(--transition-duration) var(--transition-ease) 60ms,
        visibility var(--transition-duration) var(--transition-ease);
}

.group__toggle[aria-expanded='true'] + .group__body {
    grid-template-rows: 1fr;

    visibility: visible;

    transition:
        grid-template-rows var(--transition-duration) var(--transition-ease),
        visibility 0s;
}

.group__inner {
    min-height: 0;
    overflow: hidden;

    opacity: 0;
    transform: translateY(-0.25rem);

    transition:
        opacity 140ms var(--transition-ease),
        transform 140ms var(--transition-ease);
}

.group__content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    padding: 0.5rem 0.75rem;
}

.group__toggle[aria-expanded='true'] + .group__body .group__inner {
    opacity: 1;
    transform: none;

    // 容器先展开，内容后淡入
    transition-delay: 90ms;
}

@media (prefers-reduced-motion: reduce) {
    .group__toggle,
    .group__caret,
    .group__body,
    .group__inner {
        transition: none;
    }
}
</style>
