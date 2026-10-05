<script setup lang="ts">
withDefaults(
    defineProps<{
        /** primary | ghost | danger */
        variant?: 'primary' | 'ghost' | 'danger'
        /** 撑满容器宽度 */
        block?: boolean
        disabled?: boolean
        type?: 'button' | 'submit'
    }>(),
    {
        variant: 'primary',
        block: false,
        disabled: false,
        type: 'button',
    },
)
</script>

<template>
    <button
        :type="type"
        class="group-button"
        :class="[`group-button--${variant}`, { 'group-button--block': block }]"
        :disabled="disabled"
    >
        <slot />
    </button>
</template>

<style scoped lang="scss">
.group-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    align-self: flex-start;

    min-height: 2.5rem;
    padding: 0.4rem 1rem;

    color: var(--text-color-opposite);
    font-size: var(--font-size-sm);
    font-weight: 500;

    background-color: var(--bg-opposite);
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    cursor: pointer;

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        border-color var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);

    &:hover {
        opacity: 0.88;
    }

    &:active {
        opacity: 0.75;
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    &--ghost {
        color: var(--text-color);
        background-color: var(--button-bg-color);

        &:hover {
            background-color: var(--button-bg-color-dark);
            opacity: 1;
        }
    }

    &--danger {
        color: #ffffff;
        background-color: #c62828;

        &:hover {
            opacity: 1;
            background-color: #b71c1c;
        }
    }

    &--block {
        align-self: stretch;
        width: 100%;
    }
}
</style>
