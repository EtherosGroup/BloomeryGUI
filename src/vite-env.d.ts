/// <reference types="vite/client" />

/** 构建期注入的 GUI 版本 */
declare const __APP_VERSION__: string

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}
