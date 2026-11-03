/*
 * bundle.icon 与磁盘一致性：编译期只读第一个 .png 与第一个 .ico，其余条目无人校验
 * 缺项在本地可能全绿，直到某个打包器去读它才炸，所以这里逐个断言
 * macOS 的 .icns 只有结构坏了才会在打包时才炸，这里顺带查 magic/长度/条目边界
 * 配置路径可用 CONF 覆盖，便于做反向验证
 */
import { readFileSync, statSync } from 'node:fs'

const confPath = process.env.CONF ?? 'src-tauri/tauri.conf.json'
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
const icons = conf.bundle?.icon ?? []

if (icons.length === 0) {
    console.log('失败：bundle.icon 为空，编译期会退回默认路径')
    process.exit(1)
}

let failed = 0
const present = []
for (const icon of icons) {
    let size = 0
    try {
        size = statSync(`src-tauri/${icon}`).size
    } catch {
        size = 0
    }
    if (size === 0) {
        failed += 1
        console.log(`失败 ${icon}：不存在或为空文件`)
    } else {
        present.push(icon)
        console.log(`通过 ${icon} ${size} 字节`)
    }
}

const extension = icons.map((icon) => icon.split('.').pop())
if (!extension.includes('png') || !extension.includes('ico') || !extension.includes('icns')) {
    failed += 1
    console.log('失败：缺少 .png / .ico / .icns（Windows 资源、Linux 图标与 macOS 图标各需其一）')
}

// 现代 PNG 载荷的 icns：没有 ITOC 目录表，只能顺着条目头逐个走
const MANDATORY_ICNS_TYPES = ['ic07', 'ic08', 'ic09', 'ic10']
for (const icon of present.filter((name) => name.endsWith('.icns'))) {
    for (const problem of checkIcns(icon)) {
        failed += 1
        console.log(`失败 ${icon}：${problem}`)
    }
}

function checkIcns(icon) {
    const data = readFileSync(`src-tauri/${icon}`)
    if (data.length < 8 || data.toString('latin1', 0, 4) !== 'icns') {
        return ['头部不是 icns magic，不是合法 ICNS']
    }
    const problems = []
    const total = data.readUInt32BE(4)
    if (total !== data.length) {
        problems.push(`头部长度 ${total} 与文件大小 ${data.length} 不一致`)
    }
    const types = []
    let offset = 8
    while (offset < data.length) {
        if (offset + 8 > data.length) {
            problems.push(`偏移 ${offset} 处不足条目头 8 字节，条目边界断裂`)
            break
        }
        const type = data.toString('latin1', offset, offset + 4)
        const length = data.readUInt32BE(offset + 4)
        if (length < 8) {
            problems.push(`条目 ${type} 长度 ${length} 小于 8 字节`)
            break
        }
        if (offset + length > data.length) {
            problems.push(`条目 ${type} 声明 ${length} 字节，越过文件尾 ${data.length}`)
            break
        }
        types.push(type)
        offset += length
    }
    if (!MANDATORY_ICNS_TYPES.some((type) => types.includes(type))) {
        problems.push('缺少 ic07 / ic08 / ic09 / ic10，没有 macOS 会用的位图')
    }
    return problems
}

console.log(failed === 0 ? `${icons.length} 项通过` : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
