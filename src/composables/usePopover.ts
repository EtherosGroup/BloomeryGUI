import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

export interface PopoverAnchor {
    top: number | null
    bottom: number | null
    left: number | null
    right: number | null
    maxHeight: number
}

export interface PopoverOptions {
    /** 触发元素选择器，在 root 内查找 */
    trigger: string
    /** beside：贴在触发元素右侧；below：贴在下方，空间不足时上翻 */
    placement: 'beside' | 'below'
    /** 与触发元素的间距 */
    gap?: number
    /** 视口内保留的最小边距 */
    margin?: number
}

export interface Popover {
    root: Ref<HTMLElement | null>
    content: Ref<HTMLElement | null>
    open: Ref<boolean>
    anchor: Ref<PopoverAnchor>
    place: () => void
    close: () => void
    toggle: () => void
}

/**
 * 锚定在触发元素旁的浮层：定位、点外部关闭、滚动关闭、Esc 关闭、窗口变化重新定位
 * 点触发元素自身不算外部，交回调用方决定开关
 */
export function usePopover(options: PopoverOptions): Popover {
    const gap = options.gap ?? 4
    const margin = options.margin ?? 8

    const root = ref<HTMLElement | null>(null)
    const content = ref<HTMLElement | null>(null)
    const open = ref(false)
    const anchor = ref<PopoverAnchor>({
        top: 0,
        bottom: null,
        left: 0,
        right: null,
        maxHeight: 320,
    })

    function place(): void {
        const trigger = root.value?.querySelector(options.trigger)
        if (!trigger) {
            return
        }
        const rect = trigger.getBoundingClientRect()

        if (options.placement === 'beside') {
            // 下方空间不足时改为贴着触发元素底边向上展开，长列表才拿得到高度
            const below = window.innerHeight - rect.top - margin
            const above = rect.bottom - margin
            const flip = below < 240 && above > below
            anchor.value = {
                top: flip ? null : rect.top,
                bottom: flip ? window.innerHeight - rect.bottom : null,
                left: rect.right + gap,
                right: null,
                maxHeight: Math.max(96, flip ? above : below),
            }
            return
        }

        const below = window.innerHeight - rect.bottom - gap - margin
        const above = rect.top - gap - margin
        const flip = below < 120 && above > below
        anchor.value = {
            top: flip ? null : rect.bottom + gap,
            bottom: flip ? window.innerHeight - rect.top + gap : null,
            left: null,
            right: Math.max(margin, window.innerWidth - rect.right),
            maxHeight: Math.max(96, flip ? above : below),
        }
    }

    function close(): void {
        open.value = false
    }

    function toggle(): void {
        open.value = !open.value
    }

    function onPointerDown(event: PointerEvent): void {
        const target = event.target as Node | null
        if (target && (root.value?.contains(target) || content.value?.contains(target))) {
            return
        }
        close()
    }

    function onScroll(event: Event): void {
        const target = event.target as Node | null
        if (target && content.value?.contains(target)) {
            return
        }
        close()
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape' && open.value) {
            event.stopPropagation()
            close()
        }
    }

    function onResize(): void {
        place()
    }

    function listen(): void {
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('scroll', onScroll, true)
        document.addEventListener('keydown', onKeydown)
        window.addEventListener('resize', onResize)
    }

    function unlisten(): void {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('scroll', onScroll, true)
        document.removeEventListener('keydown', onKeydown)
        window.removeEventListener('resize', onResize)
    }

    watch(open, (value) => {
        if (value) {
            place()
            listen()
        } else {
            unlisten()
        }
    })

    onBeforeUnmount(unlisten)

    return { root, content, open, anchor, place, close, toggle }
}
