import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { backgroundUrl } from '@/api/background'

export type ThemeMode = 'system' | 'light' | 'dark'

/** 界面外观：主题、侧栏默认状态与背景图 */
export const useAppearanceService = defineStore(
    'AppearanceService',
    () => {
        const theme = ref<ThemeMode>('system')
        /** 侧栏启动时的初始状态，运行中切换不回写 */
        const navDefaultCollapsed = ref(false)
        /** 侧栏背景不透明度 0-1 */
        const navOpacity = ref(0.8)
        /** 背景图在应用数据目录下的绝对路径，空串表示无 */
        const backgroundPath = ref('')
        /** 背景遮罩强度 0-1，保证文字可读 */
        const backgroundVeil = ref(0.35)

        function applyTheme(value: ThemeMode): void {
            const root = document.documentElement
            if (value === 'system') {
                delete root.dataset.theme
                return
            }
            root.dataset.theme = value
        }

        function applyBackground(): void {
            const root = document.documentElement
            if (backgroundPath.value.length === 0) {
                root.style.removeProperty('--app-background-image')
            } else {
                // 走 asset 协议，图片本体不进本地存储
                root.style.setProperty(
                    '--app-background-image',
                    `url("${backgroundUrl(backgroundPath.value)}")`,
                )
            }
            root.style.setProperty('--app-background-veil', String(backgroundVeil.value))
        }

        // 恢复持久化值时立即生效
        watch(theme, applyTheme, { immediate: true })
        watch([backgroundPath, backgroundVeil], applyBackground, { immediate: true })
        watch(
            navOpacity,
            (value) => {
                document.documentElement.style.setProperty('--nav-opacity', String(value))
            },
            { immediate: true },
        )

        function setTheme(value: ThemeMode): void {
            theme.value = value
        }

        function setNavDefaultCollapsed(value: boolean): void {
            navDefaultCollapsed.value = value
        }

        function setNavOpacity(value: number): void {
            navOpacity.value = value
        }

        function setBackgroundPath(value: string): void {
            backgroundPath.value = value
        }

        function setBackgroundVeil(value: number): void {
            backgroundVeil.value = value
        }

        return {
            theme,
            navDefaultCollapsed,
            navOpacity,
            backgroundPath,
            backgroundVeil,
            setTheme,
            setNavDefaultCollapsed,
            setNavOpacity,
            setBackgroundPath,
            setBackgroundVeil,
        }
    },
    {
        persist: true,
    },
)
