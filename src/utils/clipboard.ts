/** 复制文本：优先用异步剪贴板，不可用时退回临时 textarea */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard !== undefined && window.isSecureContext) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch {
        // 落到下面的兜底
    }

    try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const done = document.execCommand('copy')
        area.remove()
        return done
    } catch {
        return false
    }
}
