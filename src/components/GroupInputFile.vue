<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhUploadSimple, PhX } from '@phosphor-icons/vue'

const props = withDefaults(
    defineProps<{
        label?: string
        /** 接受的文件类型，同原生 accept */
        accept?: string
        /** 单文件大小上限，单位 MB，0 表示不限制 */
        maxSizeMb?: number
        disabled?: boolean
        /** 按钮文案 */
        placeholder?: string
    }>(),
    {
        accept: '',
        maxSizeMb: 0,
        disabled: false,
        placeholder: '选择文件',
    },
)

const model = defineModel<File | null>({ default: null })

const input = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const message = ref('')

const sizeText = computed(() => {
    const file = model.value
    if (file === null) {
        return ''
    }
    const mb = file.size / 1024 / 1024
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`
})

function accept_(file: File): void {
    if (props.maxSizeMb > 0 && file.size > props.maxSizeMb * 1024 * 1024) {
        message.value = `超过 ${props.maxSizeMb} MB`
        return
    }
    message.value = ''
    model.value = file
}

function onPick(event: Event): void {
    const files = (event.target as HTMLInputElement).files
    if (files !== null && files.length > 0) {
        accept_(files[0])
    }
}

function onDrop(event: DragEvent): void {
    dragging.value = false
    if (props.disabled) {
        return
    }
    const files = event.dataTransfer?.files
    if (files !== undefined && files.length > 0) {
        accept_(files[0])
    }
}

function clear(): void {
    model.value = null
    message.value = ''
    if (input.value !== null) {
        input.value.value = ''
    }
}
</script>

<template>
    <div class="group-file">
        <span v-if="label" class="group-file__label">{{ label }}</span>

        <div
            class="group-file__box"
            :class="{
                'group-file__box--dragging': dragging,
                'group-file__box--disabled': disabled,
            }"
            @dragenter.prevent="dragging = true"
            @dragover.prevent
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
        >
            <input
                ref="input"
                class="group-file__field"
                type="file"
                :accept="accept"
                :disabled="disabled"
                @change="onPick"
            />

            <PhUploadSimple :size="18" weight="regular" aria-hidden="true" />
            <span class="group-file__text">
                {{ model === null ? placeholder : model.name }}
            </span>
            <span v-if="sizeText" class="group-file__size">{{ sizeText }}</span>

            <button
                v-if="model !== null"
                type="button"
                class="group-file__clear"
                aria-label="清除选择"
                title="清除选择"
                :disabled="disabled"
                @click.prevent="clear"
            >
                <PhX :size="14" weight="regular" aria-hidden="true" />
            </button>
        </div>

        <span v-if="message" class="group-file__message">{{ message }}</span>
    </div>
</template>

<style scoped lang="scss">
.group-file {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.group-file__label {
    color: var(--text-color);
    font-size: var(--font-size-sm);
}

.group-file__box {
    position: relative;

    display: flex;
    align-items: center;
    gap: 0.5rem;

    min-height: 2.25rem;
    padding: 0.35rem 0.6rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: var(--bg-color);
    border: 1px dashed var(--text-color-dark);
    border-radius: var(--border-radius);

    transition:
        border-color var(--transition-duration) var(--transition-ease),
        background-color var(--transition-duration) var(--transition-ease);

    &:hover {
        border-color: var(--text-color);
    }

    &:focus-within {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }
}

.group-file__box--dragging {
    background-color: var(--button-bg-color);
    border-color: var(--text-color);
    border-style: solid;
}

.group-file__box--disabled {
    opacity: 0.6;
}

/* 覆盖整块，原生点击、聚焦与键盘行为都保留 */
.group-file__field {
    position: absolute;
    inset: 0;

    width: 100%;
    height: 100%;

    opacity: 0;
    cursor: pointer;

    &:disabled {
        cursor: default;
    }
}

.group-file__text {
    overflow: hidden;

    white-space: nowrap;
    text-overflow: ellipsis;
}

.group-file__size {
    flex: 0 0 auto;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.group-file__clear {
    position: relative;
    z-index: 1;

    display: grid;
    place-items: center;

    flex: 0 0 auto;

    width: 1.25rem;
    height: 1.25rem;
    padding: 0;

    color: var(--text-color);

    background-color: var(--button-bg-color);
    border: none;
    border-radius: 50%;
    cursor: pointer;
}

.group-file__message {
    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}
</style>
