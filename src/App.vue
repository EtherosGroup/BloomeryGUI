<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import LoadingPage from '@/components/LoadingPage.vue'
import NavComponent from '@/components/NavComponent.vue'
import { useRoute, useRouter } from 'vue-router'
import { useEnvironmentCheckService } from '@/stores/EnvironmentCheckService'

// 启动页最短展示时长
const LOADING_PAGE_MIN_DURATION = 800
// 字体等待上限
const FONT_WAIT_LIMIT = 2000

// 每次启动都展示
const isLoadingPageVisible = ref(true)

const router = useRouter()
const route = useRoute()
const env = useEnvironmentCheckService()
const mountedAt = performance.now()

onMounted(async () => {
    // 全局字体 7.4MB，就绪后淡出
    await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => window.setTimeout(resolve, FONT_WAIT_LIMIT)),
    ])

    // 探测环境与开屏同时进行，不额外拖慢启动
    const probing = env.check().catch(() => undefined)

    const remaining = Math.max(0, LOADING_PAGE_MIN_DURATION - (performance.now() - mountedAt))
    window.setTimeout(() => {
        isLoadingPageVisible.value = false
    }, remaining)

    // 只有环境用不了才进配置页；有更新不打扰，相关信息在配置页表格里体现
    await probing
    if (!env.usable && router.currentRoute.value.path !== '/setup') {
        await router.replace('/setup')
    }
})
</script>

<template>
    <LoadingPage :visible="isLoadingPageVisible" />

    <div class="app">
        <div class="app__background" aria-hidden="true"></div>

        <NavComponent v-if="route.path !== '/setup'" />

        <main class="app__main">
            <RouterView v-slot="{ Component, route }">
                <Transition name="page" mode="out-in">
                    <component :is="Component" :key="route.fullPath" />
                </Transition>
            </RouterView>
        </main>
    </div>
</template>

<style scoped lang="scss">
.app {
    position: relative;

    display: flex;
    height: 100vh;
    overflow: hidden;
}

/* 背景图固定铺底，遮罩层压住亮度以保证文字可读 */
.app__background {
    position: absolute;
    inset: 0;
    z-index: 0;

    pointer-events: none;

    background-image: var(--app-background-image, none);
    background-position: center;
    background-size: cover;
    background-repeat: no-repeat;

    &::after {
        content: '';

        position: absolute;
        inset: 0;

        /* 颜色跟着主题，强度由用户设置 */
        background-color: var(--app-background-veil-color, #000000);
        opacity: var(--app-background-veil, 0);
    }
}

.app > :not(.app__background) {
    position: relative;
    z-index: 1;
}

.app__main {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
}

.page-enter-active,
.page-leave-active {
    transition: opacity 0.15s ease;
}

.page-enter-from,
.page-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .page-enter-active,
    .page-leave-active {
        transition: none;
    }
}
</style>
