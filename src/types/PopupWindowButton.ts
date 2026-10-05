/** 弹窗按钮 */
export interface PopupWindowButton {
    label: string
    /** 点击回调，支持异步 */
    onClick?: () => void | Promise<void>
    /** 点击后是否关闭，默认关闭 */
    closeOnClick?: boolean
}
