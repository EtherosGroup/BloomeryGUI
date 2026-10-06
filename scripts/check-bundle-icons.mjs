/*
 * bundle.icon 与磁盘一致性：编译期只读第一个 .png 与第一个 .ico，其余条目无人校验
 * 缺项在本地可能全绿，直到某个打包器去读它才炸，所以这里逐个断言
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
        console.log(`通过 ${icon} ${size} 字节`)
    }
}

const extension = icons.map((icon) => icon.split('.').pop())
if (!extension.includes('png') || !extension.includes('ico')) {
    failed += 1
    console.log('失败：缺少 .png 或 .ico（Windows 资源与 Linux 图标各需其一）')
}

console.log(failed === 0 ? `${icons.length} 项通过` : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
