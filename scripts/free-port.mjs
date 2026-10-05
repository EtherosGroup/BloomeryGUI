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
        run(`lsof -ti tcp:${port} | xargs -r kill`)
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    process.exit(0)
}

process.exit(0)
