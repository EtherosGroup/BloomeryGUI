<script setup lang="ts">
import { useRouter } from 'vue-router'
import { PhArrowLeft } from '@phosphor-icons/vue'

const props = withDefaults(
    defineProps<{
        /** 无历史可回退时的落点 */
        fallback?: string
        label?: string
    }>(),
    {
        fallback: '/',
        label: '返回',
    },
)

const router = useRouter()

/** 有历史回退时 back，其次 fallback */
function back(): void {
    const hasHistory =
        window.history.state?.back !== undefined && window.history.state?.back !== null
    if (hasHistory) {
        router.back()
        return
    }
    void router.push(props.fallback)
}
</script>

<template>
    <button type="button" class="back" :aria-label="label" :title="label" @click="back">
        <PhArrowLeft :size="18" weight="regular" aria-hidden="true" />
        <span class="back__label">{{ label }}</span>
    </button>
</template>

<style scoped lang="scss">
.back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;

    flex: 0 0 auto;

    min-height: 2rem;
    padding: 0.25rem 0.6rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: var(--bg-color-dark);
    border: 1px solid transparent;
    border-radius: var(--border-radius);
    cursor: pointer;

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        border-color var(--transition-duration) var(--transition-ease);

    &:hover {
        border-color: var(--text-color-dark);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }
}

.back__label {
    user-select: none;
}
</style>
