<script setup lang="ts">
/**
 * 进行中的旋转指示器
 *
 * 颜色跟随 currentcolor，放进按钮或提示行都自动适配两套主题
 */
withDefaults(
    defineProps<{
        /** 直径，任意 CSS 长度 */
        size?: string
        /** 无障碍名，随场景改 */
        label?: string
    }>(),
    {
        size: '1rem',
        label: '进行中',
    },
)
</script>

<template>
    <span
        class="spinner"
        :style="{ width: size, height: size }"
        role="status"
        :aria-label="label"
    ></span>
</template>

<style scoped lang="scss">
.spinner {
    display: inline-block;
    flex: none;

    border: 2px solid color-mix(in srgb, currentcolor 25%, transparent);
    border-top-color: currentcolor;
    border-radius: 50%;

    animation: spinner-turn 0.8s linear infinite;
}

@keyframes spinner-turn {
    to {
        transform: rotate(360deg);
    }
}

/*
 * 减弱动效时放慢旋转：这是唯一的活动反馈，停转后无法区分卡死
 */
@media (prefers-reduced-motion: reduce) {
    .spinner {
        animation-duration: 2.6s;
    }
}
</style>
