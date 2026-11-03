/*
 * 释放被占用的开发端口：Linux 用 fuser / lsof，Windows 用 netstat + taskkill
 * 端口空闲或清理失败都按成功退出，不阻断 pnpm dev
 */
import { execSync } from 'node:child_process'
import { createServer } from 'node:net'

const port = Number(process.argv[2] ?? '1420')

function busy() {
    return new Promise((resolve) => {
        const probe = createServer()
        probe.once('error', () => resolve(true))
        probe.once('listening', () => probe.close(() => resolve(false)))
        probe.listen(port, '127.0.0.1')
    })
}

function run(command) {
    try {
        execSync(command, { stdio: 'ignore', shell: true })
    } catch {
        // 工具不存在或没进程可杀都算正常
    }
}

if (await busy()) {
    if (process.platform === 'win32') {
        run(`netstat -ano | findstr :${port}`)
        try {
            const rows = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' })
            const pids = new Set(
                rows
                    .split('\n')
                    .map((line) => line.trim().split(/\s+/).pop())
                    .filter((pid) => pid !== undefined && /^\d+$/.test(pid)),
            )
            for (const pid of pids) {
                run(`taskkill /PID ${pid} /F`)
            }
        } catch {
            // 没有输出表示端口已释放
        }
    } else {
        run(`fuser -k ${port}/tcp`)
        // macOS 的 xargs 没有 -r（GNU 专有），这里在 Node 里接管 lsof 的 pid 列表
        try {
            const rows = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' })
            const pids = rows
                .split('\n')
                .map((line) => line.trim())
                .filter((pid) => pid.length > 0 && /^\d+$/.test(pid))
            for (const pid of pids) {
                run(`kill -9 ${pid}`)
            }
        } catch {
            // 没有输出表示端口已释放
        }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    process.exit(0)
}

process.exit(0)
