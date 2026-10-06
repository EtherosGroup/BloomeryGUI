/*
 * 起进程的唯一入口是 program.rs 的 build_command：Windows 上带 CREATE_NO_WINDOW
 * 别处若自己 Command::new 且漏了该标志，会在 Windows 上闪控制台
 * 允许例外：非 Windows 分支（如 Linux 的 kill -0），以斜杠前 6 行内的 cfg(not(windows)) 判定
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function rustFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? rustFiles(path) : path.endsWith('.rs') ? [path] : []
    })
}

const allowed = 'src-tauri/src/program.rs'
let failed = 0
for (const file of rustFiles('src-tauri/src')) {
    if (file.replace(/\\/g, '/').endsWith(allowed)) {
        continue
    }
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, index) => {
        if (!line.includes('Command::new')) {
            return
        }
        const context = lines.slice(Math.max(0, index - 6), index + 1).join('\n')
        const guarded = context.includes('not(windows)') || context.includes('CREATE_NO_WINDOW')
        if (!guarded) {
            failed += 1
            console.log(`失败 ${file}:${index + 1} 自行起进程且未见无窗口标志`)
        }
    })
}

console.log(failed === 0 ? '起进程入口检查通过' : `${failed} 处需要处理`)
process.exit(failed === 0 ? 0 : 1)
