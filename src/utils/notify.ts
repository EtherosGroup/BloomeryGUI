import { toast, type ToastOptions } from 'vue3-toastify'
import { copyText } from '@/utils/clipboard'

/** 点击提示框复制正文，重复点击替换同一条回执 */
const COPY_TOAST_ID = 'notify-copy-done'
/** 悬浮提示 */
const COPY_TITLE = '点击复制'

/**
 * toastify 没有 title 选项，用观察者给插入的提示框补属性
 * 提示框按位置分容器，观察整棵 DOM
 */
let observer: MutationObserver | undefined

function markCopyTitle(node: Node): void {
    if (node instanceof HTMLElement && node.classList.contains('Toastify__toast')) {
        node.title = COPY_TITLE
    }
}

function ensureCopyTitle(): void {
    if (observer !== undefined) {
        return
    }
    observer = new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                markCopyTitle(node)
            }
        }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    for (const node of document.querySelectorAll('.Toastify__toast')) {
        markCopyTitle(node)
    }
}

type NotifyType = 'success' | 'error' | 'warning' | 'info'

async function copy(text: string): Promise<void> {
    ensureCopyTitle()
    const done = await copyText(text)
    toast(done ? '已复制到剪贴板' : '复制失败', {
        type: done ? 'success' : 'error',
        toastId: COPY_TOAST_ID,
        autoClose: 1500,
        closeButton: false,
        closeOnClick: false,
        position: 'bottom-center',
        // 点回执也复制（复制的是原消息），保持"点击即复制"一致
        onClick: () => {
            void copyText(text)
        },
    })
}

/** 统一的提示框：全部自动关闭，无关闭按钮，点击正文复制 */
function notify(type: NotifyType, message: string, options: ToastOptions = {}): void {
    ensureCopyTitle()
    // 没有关闭按钮，error 与 warning 给更长的停留时间
    const duration = type === 'error' || type === 'warning' ? 6000 : 3000
    toast(message, {
        type,
        autoClose: duration,
        closeButton: false,
        closeOnClick: false,
        onClick: () => {
            void copy(message)
        },
        ...options,
    })
}

export const notifySuccess = (message: string, options?: ToastOptions): void =>
    notify('success', message, options)

export const notifyInfo = (message: string, options?: ToastOptions): void =>
    notify('info', message, options)

export const notifyWarn = (message: string, options?: ToastOptions): void =>
    notify('warning', message, options)

export const notifyError = (message: string, options?: ToastOptions): void =>
    notify('error', message, options)
