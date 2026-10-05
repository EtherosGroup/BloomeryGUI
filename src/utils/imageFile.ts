/** 背景图上限：解码后的最长边与编码质量 */
const MAX_EDGE = 2560
const QUALITY = 0.88

/** 首选编码格式，不支持时回落 JPEG */
const PREFERRED_TYPE = 'image/webp'
const FALLBACK_TYPE = 'image/jpeg'

export interface PreparedImage {
    /** 缩放并编码后的图片数据 */
    blob: Blob
    /** 文件扩展名，跟随实际编码结果 */
    extension: string
    width: number
    height: number
}

/** 按最长边等比缩放 */
function fit(width: number, height: number): { width: number; height: number } {
    const longest = Math.max(width, height)
    if (longest <= MAX_EDGE) {
        return { width, height }
    }
    const scale = MAX_EDGE / longest
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    }
}

function decode(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const image = new Image()
        image.addEventListener('load', () => {
            URL.revokeObjectURL(url)
            resolve(image)
        })
        image.addEventListener('error', () => {
            URL.revokeObjectURL(url)
            reject(new Error('图片解码失败'))
        })
        image.src = url
    })
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob === null) {
                    reject(new Error('图片编码失败'))
                    return
                }
                resolve(blob)
            },
            type,
            QUALITY,
        )
    })
}

/** 读成可落盘的图片数据，超限时缩放 */
export async function prepareImage(file: File): Promise<PreparedImage> {
    const image = await decode(file)
    const target = fit(image.naturalWidth || image.width, image.naturalHeight || image.height)

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) {
        throw new Error('画布不可用')
    }
    context.drawImage(image, 0, 0, target.width, target.height)

    let blob = await encode(canvas, PREFERRED_TYPE)
    if (blob.type !== PREFERRED_TYPE) {
        // WebKit 不支持 WebP 编码时返回 PNG，改走 JPEG
        const fallback = await encode(canvas, FALLBACK_TYPE)
        if (fallback.type === FALLBACK_TYPE) {
            blob = fallback
        }
    }

    const subtype = blob.type.split('/')[1] ?? 'png'
    return {
        blob,
        extension: subtype === 'jpeg' ? 'jpg' : subtype,
        width: target.width,
        height: target.height,
    }
}
