<script setup lang="ts">
withDefaults(
    defineProps<{
        text?: string
        /** xs / sm / base，对应字号 token */
        size?: 'xs' | 'sm' | 'base'
        /** 次级文字色 */
        muted?: boolean
    }>(),
    {
        size: 'sm',
        muted: false,
    },
)
</script>

<template>
    <p class="group-label" :class="[`group-label--${size}`, { 'group-label--muted': muted }]">
        <slot>{{ text }}</slot>
    </p>
</template>

<style scoped lang="scss">
.group-label {
    margin: 0;

    color: var(--text-color);
}

.group-label--xs {
    font-size: var(--font-size-xs);
}

.group-label--sm {
    font-size: var(--font-size-sm);
}

.group-label--base {
    font-size: var(--font-size-base);
}

.group-label--muted {
    color: var(--text-color-dark);
}
</style>
