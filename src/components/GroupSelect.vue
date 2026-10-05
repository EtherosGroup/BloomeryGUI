<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { PhCaretDown } from '@phosphor-icons/vue'
import type { ChoiceOptionType } from '@/types/ChoiceOptionType'

const props = withDefaults(
    defineProps<{
        label?: string
        options: ChoiceOptionType[]
        placeholder?: string
        disabled?: boolean
        /** 紧凑按钮形态：只显示箭头，label 转为无障碍名与悬停提示 */
        icon?: boolean
    }>(),
    {
        placeholder: '未选择',
        disabled: false,
        icon: false,
    },
)

const model = defineModel<string>({ default: '' })

const uid = useId()
const listId = `${uid}-list`
const labelId = `${uid}-label`

const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)
const anchor = ref<{
    top: number | null
    bottom: number | null
    left: number | null
    right: number | null
    width: number | null
    maxHeight: number
}>({ top: 0, bottom: null, left: 0, right: null, width: 0, maxHeight: 320 })

const current = computed(() => props.options.find((item) => item.value === model.value) ?? null)

function optionId(index: number): string {
    return `${uid}-option-${index}`
}

/** 跟随触发器定位；下方空间不足时翻到上方；紧凑形态靠右对齐并自适应宽度 */
function place(): void {
    const trigger = root.value?.querySelector('.group-select__trigger')
    if (!trigger) {
        return
    }
    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const flip = below < 140 && above > below
    anchor.value = {
        top: flip ? null : rect.bottom + 4,
        bottom: flip ? window.innerHeight - rect.top + 4 : null,
        left: props.icon ? null : rect.left,
        right: props.icon ? Math.max(8, window.innerWidth - rect.right) : null,
        width: props.icon ? null : rect.width,
        maxHeight: Math.max(96, flip ? above : below),
    }
}

function openList(): void {
    if (props.disabled) {
        return
    }
    open.value = true
}

function close(): void {
    open.value = false
}

function choose(option: ChoiceOptionType): void {
    if (option.disabled) {
        return
    }
    model.value = option.value
    close()
}

/** 跳过禁用项 */
function step(direction: number): void {
    const count = props.options.length
    if (count === 0) {
        return
    }
    let index = activeIndex.value
    for (let hops = 0; hops < count; hops++) {
        index = (index + direction + count) % count
        if (!props.options[index]?.disabled) {
            activeIndex.value = index
            return
        }
    }
}

function onKeydown(event: KeyboardEvent): void {
    if (props.disabled) {
        return
    }
    switch (event.key) {
        case 'Escape':
            if (open.value) {
                event.stopPropagation()
                close()
            }
            break
        case 'ArrowDown':
        case 'ArrowUp':
            event.preventDefault()
            if (!open.value) {
                openList()
                return
            }
            step(event.key === 'ArrowDown' ? 1 : -1)
            break
        case 'Enter':
        case ' ':
            event.preventDefault()
            if (!open.value) {
                openList()
                return
            }
            choose(props.options[activeIndex.value] ?? ({} as ChoiceOptionType))
            break
    }
}

function onPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null
    // 列表 Teleport 到 body，在 root 之外，一并按内部处理
    if (target && (root.value?.contains(target) || list.value?.contains(target))) {
        return
    }
    close()
}

/** 列表自身滚动不算页面滚动 */
function onScroll(event: Event): void {
    const target = event.target as Node | null
    if (target && list.value?.contains(target)) {
        return
    }
    close()
}

function onResize(): void {
    place()
}

watch(open, (value) => {
    if (value) {
        activeIndex.value = Math.max(
            0,
            props.options.findIndex((item) => item.value === model.value),
        )
        place()
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('scroll', onScroll, true)
        window.addEventListener('resize', onResize)
    } else {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', onResize)
    }
})

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
})
</script>

<template>
    <div
        ref="root"
        class="group-select"
        :class="{
            'group-select--open': open,
            'group-select--disabled': disabled,
            'group-select--icon': icon,
        }"
    >
        <span v-if="label && !icon" :id="labelId" class="group-select__label">{{ label }}</span>

        <button
            type="button"
            class="group-select__trigger"
            :class="{ 'group-select__trigger--icon': icon }"
            role="combobox"
            :aria-expanded="open"
            :aria-controls="listId"
            :aria-labelledby="label && !icon ? labelId : undefined"
            :aria-label="icon ? label : undefined"
            :title="icon ? label : undefined"
            :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
            :disabled="disabled"
            @click="open ? close() : openList()"
            @keydown="onKeydown"
        >
            <span
                v-if="!icon"
                class="group-select__value"
                :class="{ 'group-select__value--empty': current === null }"
            >
                {{ current?.label ?? placeholder }}
            </span>
            <PhCaretDown
                class="group-select__caret"
                :size="16"
                weight="regular"
                aria-hidden="true"
            />
        </button>
    </div>

    <Teleport to="body">
        <ul
            v-if="open"
            :id="listId"
            ref="list"
            class="group-select__list"
            :class="{ 'group-select__list--icon': icon }"
            role="listbox"
            :aria-labelledby="label && !icon ? labelId : undefined"
            :style="{
                top: anchor.top === null ? undefined : `${anchor.top}px`,
                bottom: anchor.bottom === null ? undefined : `${anchor.bottom}px`,
                left: anchor.left === null ? undefined : `${anchor.left}px`,
                right: anchor.right === null ? undefined : `${anchor.right}px`,
                width: anchor.width === null ? undefined : `${anchor.width}px`,
                maxHeight: `${anchor.maxHeight}px`,
            }"
        >
            <li
                v-for="(option, index) in options"
                :id="optionId(index)"
                :key="option.value"
                class="group-select__option"
                :class="{
                    'group-select__option--active': index === activeIndex,
                    'group-select__option--selected': option.value === model,
                    'group-select__option--disabled': option.disabled,
                }"
                role="option"
                :aria-selected="option.value === model"
                :aria-disabled="option.disabled"
                @pointermove="activeIndex = index"
                @click="choose(option)"
            >
                {{ option.label }}
            </li>
        </ul>
    </Teleport>
</template>

<style scoped lang="scss">
.group-select {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.group-select__label {
    color: var(--text-color);
    font-size: var(--font-size-sm);
}

.group-select__trigger {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    width: 100%;
    min-height: 2.25rem;
    padding: 0.35rem 0.6rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);
    text-align: left;

    background-color: var(--bg-color);
    border: 1px solid var(--button-bg-color-dark);
    border-radius: var(--border-radius);
    cursor: pointer;

    transition:
        border-color var(--transition-duration) var(--transition-ease),
        background-color var(--transition-duration) var(--transition-ease);

    &:hover:not(:disabled) {
        border-color: var(--text-color-dark);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.group-select__trigger--icon {
    justify-content: center;

    flex: 1;
    width: 2.25rem;
    padding: 0;

    background-color: var(--button-bg-color);
    border-color: transparent;
}

.group-select__value {
    flex: 1;

    overflow: hidden;

    white-space: nowrap;
    text-overflow: ellipsis;
}

.group-select__value--empty {
    color: var(--text-color-dark);
}

.group-select__caret {
    flex: 0 0 auto;
    opacity: 0.7;

    transition: transform var(--transition-duration) var(--transition-ease);
}

.group-select--open .group-select__caret {
    transform: rotate(180deg);
}

.group-select__list {
    position: fixed;
    z-index: 40;

    display: flex;
    flex-direction: column;

    margin: 0;
    padding: 0.25rem;

    overflow-y: auto;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: var(--bg-color);
    border: 1px solid color-mix(in srgb, var(--text-color) 18%, transparent);
    border-radius: var(--border-radius);

    list-style: none;
}

.group-select__list--icon {
    min-width: 8rem;
}

.group-select__option {
    padding: 0.4rem 0.5rem;

    border-radius: calc(var(--border-radius) / 1.5);
    cursor: pointer;
}

.group-select__option--active {
    background-color: var(--button-bg-color);
}

.group-select__option--selected {
    font-weight: 600;
}

.group-select__option--disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
</style>
