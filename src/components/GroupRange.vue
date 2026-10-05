<script setup lang="ts">
withDefaults(
    defineProps<{
        label?: string
        min?: number
        max?: number
        step?: number
        disabled?: boolean
        /** 显示当前值 */
        showValue?: boolean
    }>(),
    {
        min: 0,
        max: 100,
        step: 1,
        disabled: false,
        showValue: true,
    },
)

const model = defineModel<number>({ default: 0 })
</script>

<template>
    <label class="group-range" :class="{ 'group-range--disabled': disabled }">
        <span class="group-range__head">
            <span v-if="label" class="group-range__label">{{ label }}</span>
            <span v-if="showValue" class="group-range__value">{{ model }}</span>
        </span>
        <input
            v-model.number="model"
            class="group-range__field"
            type="range"
            :min="min"
            :max="max"
            :step="step"
            :disabled="disabled"
        />
    </label>
</template>

<style scoped lang="scss">
.group-range {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    &--disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.group-range__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
}

.group-range__value {
    min-width: 3ch;

    color: var(--text-color-dark);
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.group-range__field {
    width: 100%;
    height: 1.5rem;
    margin: 0;

    accent-color: var(--bg-opposite);
    cursor: pointer;

    &:disabled {
        cursor: not-allowed;
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }
}
</style>
