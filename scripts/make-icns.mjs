/*
 * 生成 src-tauri/icons/icon.icns：现代 PNG 载荷的 ICNS，只用 node 标准库
 *
 * 结构：'icns' + u32 总长（均大端）；每个元素 = 4 字节类型 + u32 长度（含 8 字节头）+ PNG 字节
 * 载荷直接取仓库已有的几档 PNG，逐张解析 IHDR 断言尺寸，避免拿错图写进 icns
 * 纯拼接、无时间戳，重复执行字节稳定
 */
import { readFileSync, writeFileSync } from 'node:fs'

const OUTPUT = 'src-tauri/icons/icon.icns'

// Apple 的 icns 类型 ↔ 像素尺寸；一个类型一档，ic08/ic13、ic09/ic14 共用同一张 PNG
const ENTRIES = [
    { type: 'ic11', file: 'src-tauri/icons/32x32.png', size: 32 },
    { type: 'ic12', file: 'src-tauri/icons/64x64.png', size: 64 },
    { type: 'ic07', file: 'src-tauri/icons/128x128.png', size: 128 },
    { type: 'ic13', file: 'src-tauri/icons/128x128@2x.png', size: 256 },
    { type: 'ic08', file: 'src-tauri/icons/128x128@2x.png', size: 256 },
    { type: 'ic14', file: 'src-tauri/icons/icon.png', size: 512 },
    { type: 'ic09', file: 'src-tauri/icons/icon.png', size: 512 },
    { type: 'ic10', file: 'app-icon.png', size: 1024 },
]

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function fail(message) {
    console.log(`失败：${message}`)
    process.exit(1)
}

// 只读 IHDR：宽高在第 16/20 字节（大端），不解码像素即可判定
function readPng(file) {
    let png
    try {
        png = readFileSync(file)
    } catch {
        fail(`${file} 读不到`)
    }
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
        fail(`${file} 不是合法 PNG（签名不符）`)
    }
    if (png.toString('latin1', 12, 16) !== 'IHDR') {
        fail(`${file} 首个数据块不是 IHDR`)
    }
    return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

const elements = []
for (const entry of ENTRIES) {
    const { png, width, height } = readPng(entry.file)
    if (width !== entry.size || height !== entry.size) {
        fail(
            `${entry.file} 实际 ${width}x${height}，${entry.type} 需要 ${entry.size}x${entry.size}`,
        )
    }
    const header = Buffer.alloc(8)
    header.write(entry.type, 0, 4, 'latin1')
    header.writeUInt32BE(png.length + 8, 4)
    elements.push({ type: entry.type, png, bytes: Buffer.concat([header, png]) })
}

const body = Buffer.concat(elements.map((element) => element.bytes))
const head = Buffer.alloc(8)
head.write('icns', 0, 4, 'latin1')
head.writeUInt32BE(body.length + 8, 4)

const icns = Buffer.concat([head, body])

// --check：只比对不落盘，CI 用它拦住“换了 PNG 忘了重跑本脚本”
if (process.argv.includes('--check')) {
    let current = null
    try {
        current = readFileSync(OUTPUT)
    } catch {
        current = null
    }
    if (current === null || !current.equals(icns)) {
        fail(`${OUTPUT} 与现有 PNG 不一致，运行 pnpm run icons:icns 重新生成`)
    }
    console.log(`检查通过 ${OUTPUT} ${icns.length} 字节，与 PNG 一致`)
    process.exit(0)
}

writeFileSync(OUTPUT, icns)

for (const element of elements) {
    const surface = `${element.png.readUInt32BE(16)}x${element.png.readUInt32BE(20)}`
    console.log(`条目 ${element.type} ${surface} ${element.png.length} 字节`)
}
console.log(`写入 ${OUTPUT} ${icns.length} 字节，${elements.length} 个条目`)
