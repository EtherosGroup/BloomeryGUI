<script setup lang="ts">
withDefaults(
    defineProps<{
        label?: string
        placeholder?: string
        type?: 'text' | 'number' | 'password' | 'search'
        disabled?: boolean
    }>(),
    {
        type: 'text',
        disabled: false,
    },
)

/** 文本输入给 string，数字输入给 number */
const model = defineModel<string | number>({ default: '' })
</script>

<template>
    <label class="group-input">
        <span v-if="label" class="group-input__label">{{ label }}</span>
        <input
            v-model="model"
            class="group-input__field"
            :type="type"
            :placeholder="placeholder"
            :disabled="disabled"
        />
    </label>
</template>

<style scoped lang="scss">
.group-input {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.group-input__label {
    color: var(--text-color);
    font-size: var(--font-size-sm);
}

.group-input__field {
    min-height: 2.25rem;
    padding: 0.35rem 0.6rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: var(--bg-color);
    border: 1px solid var(--button-bg-color-dark);
    border-radius: var(--border-radius);

    transition:
        border-color var(--transition-duration) var(--transition-ease),
        background-color var(--transition-duration) var(--transition-ease);

    &::placeholder {
        color: var(--text-color-dark);
    }

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
</style>
