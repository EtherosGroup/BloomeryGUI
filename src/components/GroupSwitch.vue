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
    <label class="group-switch" :class="{ 'group-switch--disabled': disabled }">
        <input
            v-model="model"
            class="group-switch__field"
            type="checkbox"
            role="switch"
            :disabled="disabled"
        />
        <span v-if="label" class="group-switch__label">{{ label }}</span>
    </label>
</template>

<style scoped lang="scss">
.group-switch {
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

.group-switch__field {
    position: relative;
    flex: 0 0 auto;

    width: 2.5rem;
    height: 1.4rem;
    margin: 0;

    appearance: none;
    background-color: var(--button-bg-color-dark);
    border-radius: 999px;
    cursor: inherit;

    transition: background-color var(--transition-duration) var(--transition-ease);

    // 手柄 1.05rem + 边距 0.175rem ×2 ⇒ 行程 1.1rem
    &::after {
        content: '';

        position: absolute;
        top: 0.175rem;
        left: 0.175rem;

        width: 1.05rem;
        height: 1.05rem;

        background-color: var(--text-color);
        border-radius: 50%;

        transition: transform var(--transition-duration) var(--transition-ease);
    }

    &:checked {
        background-color: var(--bg-opposite);

        &::after {
            background-color: var(--text-color-opposite);
            transform: translateX(1.1rem);
        }
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }
}

.group-switch__label {
    user-select: none;
}

@media (prefers-reduced-motion: reduce) {
    .group-switch__field,
    .group-switch__field::after {
        transition: none;
    }
}
</style>
