<script setup lang="ts">
withDefaults(
    defineProps<{
        label?: string
        disabled?: boolean
    }>(),
    {
        disabled: false,
    },
)

const model = defineModel<boolean>({ default: false })
</script>

<template>
    <label class="group-checkbox" :class="{ 'group-checkbox--disabled': disabled }">
        <input v-model="model" class="group-checkbox__field" type="checkbox" :disabled="disabled" />
        <span v-if="label" class="group-checkbox__label">{{ label }}</span>
    </label>
</template>

<style scoped lang="scss">
.group-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    min-height: 2rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    cursor: pointer;

    &--disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.group-checkbox__field {
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

.group-checkbox__label {
    user-select: none;
}
</style>
