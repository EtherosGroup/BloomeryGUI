<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        /** true 显示，false 淡出 */
        visible?: boolean
    }>(),
    {
        visible: false,
    },
)
</script>

<template>
    <Transition name="loading">
        <div v-if="props.visible" class="container">
            <p class="title">Bloomery Launcher</p>
            <p class="subtitle">Etheros Group</p>
            <!-- 在这里加一个 Java版MC启动时下方的加载条，可以开一个store或者.ts什么的 -->
        </div>
    </Transition>
</template>

<style scoped lang="scss">
.container {
    position: fixed;
    inset: 0;
    z-index: 100;

    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;

    background-color: #ef323d;
    color: #ffffff;
}

.title {
    font-size: var(--font-size-4xl);
    font-weight: 600;
}

.subtitle {
    font-size: var(--font-size-sm);
}

.loading-enter-active,
.loading-leave-active {
    transition: opacity var(--transition-duration) var(--transition-ease);
}

.loading-enter-from,
.loading-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .loading-enter-active,
    .loading-leave-active {
        transition: none;
    }
}
</style>
