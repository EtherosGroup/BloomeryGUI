<script setup lang="ts">
import { useId } from 'vue'
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

const model = defineModel<string>({ default: '' })
const groupName = useId()
</script>

<template>
    <fieldset class="group-radio" :disabled="disabled">
        <legend v-if="label" class="group-radio__legend">{{ label }}</legend>
        <label v-for="option in options" :key="option.value" class="group-radio__option">
            <input
                v-model="model"
                class="group-radio__field"
                type="radio"
                :name="groupName"
                :value="option.value"
                :disabled="option.disabled || disabled"
            />
            <span class="group-radio__label">{{ option.label }}</span>
        </label>
    </fieldset>
</template>

<style scoped lang="scss">
.group-radio {
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

.group-radio__legend {
    padding: 0;

    color: var(--text-color);
    font-size: var(--font-size-sm);
}

.group-radio__option {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    min-height: 2rem;

    cursor: pointer;
}

.group-radio__field {
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

.group-radio__label {
    user-select: none;
}
</style>
