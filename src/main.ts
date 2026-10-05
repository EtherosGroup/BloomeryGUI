import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import App from './App.vue'
import router from './router'
import { useAppearanceService } from '@/stores/AppearanceService'
import { useEnvironmentService } from '@/stores/EnvironmentService'

import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

import Vue3Toastify, { type ToastContainerOptions } from 'vue3-toastify'
import 'vue3-toastify/dist/index.css'
// 覆盖 toastify 尺寸与配色，排在自带样式之后
import '@/assets/style/toastify.scss'

// style
import '@/assets/style/font.scss'
import '@/assets/style/variables.scss'
import '@/assets/style/global.scss'

NProgress.configure({
    showSpinner: false,
    minimum: 0.1,
    easing: 'ease',
    speed: 200,
    trickle: true,
})

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

const app = createApp(App)

app.use(Vue3Toastify, {
    autoClose: 3000,
    position: 'top-center',
    theme: 'auto', // 'light' | 'dark' | 'colored' | 'auto'
    clearOnUrlChange: false,
    // 不显示关闭按钮，全部自动关闭；点击正文由 notify 助手接管为复制
    closeButton: false,
    closeOnClick: false,
} as ToastContainerOptions)
app.use(pinia)
app.use(router)

// 清理旧版持久化设置里的默认数据目录
useEnvironmentService(pinia).dropLegacyHome()
// 恢复主题，watcher 立即作用于根元素
useAppearanceService(pinia)

app.mount('#app')

// 移除 index.html 的首帧占位
document.getElementById('boot-splash')?.remove()
