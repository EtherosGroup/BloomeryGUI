<script setup lang="ts">
import type { ChoiceOptionType } from '@/types/ChoiceOptionType'

withDefaults(
    defineProps<{
        label?: string
        options: ChoiceOptionType[]
        disabled?: boolean
    }>(),
    {
        disabled: false,
    },
)

const model = defineModel<string[]>({ default: () => [] })
</script>

<template>
    <fieldset class="group-checkbox-group" :disabled="disabled">
        <legend v-if="label" class="group-checkbox-group__legend">{{ label }}</legend>
        <label v-for="option in options" :key="option.value" class="group-checkbox-group__option">
            <input
                v-model="model"
                class="group-checkbox-group__field"
                type="checkbox"
                :value="option.value"
                :disabled="option.disabled || disabled"
            />
            <span class="group-checkbox-group__label">{{ option.label }}</span>
        </label>
    </fieldset>
</template>

<style scoped lang="scss">
.group-checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    margin: 0;
    padding: 0;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    border: 0;

    &:disabled {
        opacity: 0.45;
    }
}

.group-checkbox-group__legend {
    padding: 0;

    color: var(--text-color);
    font-size: var(--font-size-sm);
}

.group-checkbox-group__option {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    min-height: 2rem;

    cursor: pointer;
}

.group-checkbox-group__field {
    flex: 0 0 auto;

    width: 1.05rem;
    height: 1.05rem;

    accent-color: var(--bg-opposite);
    cursor: inherit;

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }
}

.group-checkbox-group__label {
    user-select: none;
}
</style>
