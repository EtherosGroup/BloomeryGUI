import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
    downloadFile,
    killProgram,
    runProgram,
    runProgramStream,
    systemFacts,
    type SystemFacts,
} from '@/api/program'
import { openPath } from '@/api/system'

/** Node.js 最低可用主版本 */
const NODE_MIN_MAJOR = 22

export interface ToolFact {
    /** 是否探测到 */
    found: boolean
    /** 版本号原文 */
    version: string
    /** 主版本号，解析不到为 null */
    major: number | null
}

export type EnvSituation = 'no-node' | 'no-bloomery' | 'node-too-old' | 'bloomery-update' | 'ready'

/** 一次更新的结果 */
export interface UpdateOutcome {
    ok: boolean
    /** 被用户取消 */
    cancelled: boolean
    /** 更新前后的版本 */
    before: string
    after: string
    /** 执行的命令 */
    command: string
    /** 输出尾部若干行 */
    tail: string[]
    /** 失败简述 */
    error: string
}

const NODE_INDEX = 'https://nodejs.org/dist/index.json'
const BLOOMERY_LATEST = 'https://registry.npmjs.org/bloomery/latest'

/** 从任意输出里取第一段 x.y.z */
function semver(text: string): string {
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(text)
    return match === null ? '' : `${match[1]}.${match[2]}.${match[3]}`
}

function majorOf(version: string): number | null {
    const match = /^(\d+)\./.exec(version)
    return match === null ? null : Number(match[1])
}

/** 比较语义化版本，left 更新返回 1 */
function compare(left: string, right: string): number {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    for (let index = 0; index < 3; index += 1) {
        const one = a[index] ?? 0
        const other = b[index] ?? 0
        if (one !== other) {
            return one > other ? 1 : -1
        }
    }
    return 0
}

/** 环境探测：Node / Bloomery / nvm / pnpm / Homebrew 与可更新的最新版本 */
export const useEnvironmentCheckService = defineStore('EnvironmentCheckService', () => {
    const checked = ref(false)
    const checking = ref(false)
    const facts = ref<SystemFacts>({ platform: '', arch: '', downloads: '' })
    /** Linux 上探测到的包管理器名，取不到为空串 */
    const packageManager = ref('')
    const node = ref<ToolFact>({ found: false, version: '', major: null })
    const bloomery = ref<ToolFact>({ found: false, version: '', major: null })
    const nvm = ref<ToolFact>({ found: false, version: '', major: null })
    const pnpm = ref<ToolFact>({ found: false, version: '', major: null })
    /** macOS 上的 Homebrew，非 macOS 恒为未找到 */
    const brew = ref<ToolFact>({ found: false, version: '', major: null })
    /** 官方最新 LTS，取不到为空串 */
    const latestNode = ref('')
    /** npm 上的最新版，取不到为空串 */
    const latestBloomery = ref('')

    async function probe(program: string, args: string[]): Promise<ToolFact> {
        try {
            const outcome = await runProgram(program, args)
            if (!outcome.spawned) {
                return { found: false, version: '', major: null }
            }
            const version = semver(`${outcome.stdout}\n${outcome.stderr}`)
            return { found: version.length > 0, version, major: majorOf(version) }
        } catch {
            return { found: false, version: '', major: null }
        }
    }

    /** 官方版本信息，取不到就留空，不阻断探测 */
    async function fetchLatest(): Promise<void> {
        try {
            const response = await fetch(NODE_INDEX)
            const rows = (await response.json()) as { version: string; lts: string | false }[]
            const lts = rows.find((row) => row.lts !== false)
            latestNode.value = lts === undefined ? '' : lts.version.replace(/^v/, '')
        } catch {
            latestNode.value = ''
        }
        try {
            const response = await fetch(BLOOMERY_LATEST)
            const row = (await response.json()) as { version?: string }
            latestBloomery.value = row.version ?? ''
        } catch {
            latestBloomery.value = ''
        }
    }

    async function check(): Promise<void> {
        checking.value = true
        try {
            facts.value = await systemFacts().catch(() => facts.value)
            if (facts.value.platform === 'linux') {
                packageManager.value = await detectPackageManager()
            }
            node.value = await probe('node', ['--version'])
            bloomery.value = await probe('bloomery', ['--version'])
            nvm.value = await probe('nvm', ['version'])
            pnpm.value = await probe('pnpm', ['--version'])
            if (facts.value.platform === 'macos') {
                brew.value = await probe('brew', ['--version'])
            }
            await fetchLatest()
        } finally {
            checking.value = false
            checked.value = true
        }
    }

    /** 4 种情况：Node 版本低于 22 属于跑不起来，优先级最高 */
    const situation = computed<EnvSituation>(() => {
        if (!node.value.found) {
            return 'no-node'
        }
        if ((node.value.major ?? 0) < NODE_MIN_MAJOR) {
            return 'node-too-old'
        }
        if (!bloomery.value.found) {
            return 'no-bloomery'
        }
        if (
            latestBloomery.value.length > 0 &&
            compare(latestBloomery.value, bloomery.value.version) > 0
        ) {
            return 'bloomery-update'
        }
        return 'ready'
    })

    const nodeOutdated = computed(() => (node.value.major ?? 0) < NODE_MIN_MAJOR)
    const bloomeryOutdated = computed(
        () =>
            latestBloomery.value.length > 0 &&
            bloomery.value.found &&
            compare(latestBloomery.value, bloomery.value.version) > 0,
    )

    /** 环境是否可用：Node 与 Bloomery 都在且 Node 版本够 */
    const usable = computed(() => node.value.found && bloomery.value.found && !nodeOutdated.value)

    const isWindows = computed(() => facts.value.platform === 'windows')
    const isLinux = computed(() => facts.value.platform === 'linux')
    const isMacos = computed(() => facts.value.platform === 'macos')

    /** 依次探测常见包管理器，取第一个可用的 */
    async function detectPackageManager(): Promise<string> {
        for (const name of ['apt', 'dnf', 'pacman', 'zypper']) {
            const outcome = await runProgram(name, ['--version']).catch(() => null)
            if (outcome !== null && outcome.spawned) {
                return name
            }
        }
        return ''
    }

    /** 给用户自己执行的安装命令：Linux 按包管理器，macOS 按 Homebrew 情况 */
    const installCommands = computed<string[]>(() => {
        const rows: string[] = []
        if (isMacos.value) {
            // brew install 对已安装但过期的 formula 会自动升级，统一用它
            if (!brew.value.found) {
                rows.push(
                    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
                )
            }
            rows.push('brew install node')
            rows.push(bloomery.value.found ? 'npm update -g bloomery' : 'npm install -g bloomery')
            rows.push('# 或者用 nvm 安装 Node.js：https://github.com/nvm-sh/nvm')
            return rows
        }
        if (!isLinux.value) {
            return rows
        }
        const pkg = packageManager.value
        if (pkg === 'apt') {
            rows.push('sudo apt update && sudo apt install -y nodejs npm')
        } else if (pkg === 'dnf') {
            rows.push('sudo dnf install -y nodejs npm')
        } else if (pkg === 'pacman') {
            rows.push('sudo pacman -S --needed nodejs npm')
        } else if (pkg === 'zypper') {
            rows.push('sudo zypper install nodejs npm')
        } else {
            rows.push('# 未识别包管理器，按发行版选择 apt / dnf / pacman / zypper')
        }
        rows.push('nvm install --lts && nvm alias default lts/*')
        rows.push('npm update -g bloomery')
        return rows
    })

    /** Windows 上 Node 安装包的下载地址 */
    const nodeInstaller = computed(() => {
        if (latestNode.value.length === 0) {
            return { url: '', name: '' }
        }
        const arch = facts.value.arch === 'x86_64' ? 'x64' : facts.value.arch
        const name = `node-v${latestNode.value}-${arch}.msi`
        return { url: `https://nodejs.org/dist/v${latestNode.value}/${name}`, name }
    })

    /** Windows：下载安装包并交给系统运行，安装过程由用户完成 */
    async function installNode(): Promise<string> {
        if (nodeInstaller.value.url.length === 0) {
            return '无法获取最新版 Node.js 版本号 · 检查网络'
        }
        const target = `${facts.value.downloads}/${nodeInstaller.value.name}`
        const path = await downloadFile(nodeInstaller.value.url, target)
        await openPath(path)
        return `已下载并交给系统运行：${path}`
    }

    /** Windows：有 nvm 就让它装，没有则退回下载安装包 */
    async function updateNode(): Promise<string> {
        if (nvm.value.found) {
            const outcome = await runProgram('nvm', ['install', 'lts'])
            return outcome.spawned
                ? `已通过 nvm 安装 LTS：${(outcome.stdout + outcome.stderr).trim().slice(0, 400)}`
                : 'nvm 调用失败'
        }
        return await installNode()
    }

    /* ---------- 更新流程：流式输出 + 可取消 ---------- */

    /** 正在更新 */
    const updating = ref(false)
    /** 更新输出，保留尾部若干行 */
    const updateLines = ref<string[]>([])
    const UPDATE_LINE_LIMIT = 200

    let updateId = ''
    let updateCancelled = false

    /** 跑一条流式命令：逐行回传输出，结束后复位更新状态 */
    async function streamCommand(
        program: string,
        args: string[],
    ): Promise<{ code: number | null; spawned: boolean; cancelled: boolean }> {
        updating.value = true
        updateCancelled = false
        updateLines.value = []
        updateId = `update-${program}-${Date.now()}`

        try {
            const outcome = await runProgramStream(program, args, {
                id: updateId,
                onLine: (line) => {
                    const text = line.trim()
                    if (text.length === 0) {
                        return
                    }
                    updateLines.value = [...updateLines.value, text].slice(-UPDATE_LINE_LIMIT)
                },
            })
            return { code: outcome.code, spawned: outcome.spawned, cancelled: updateCancelled }
        } finally {
            updating.value = false
            updateId = ''
        }
    }

    /** 更新 Bloomery：输出逐行回传，版本前后对比在结果里 */
    async function updateBloomery(manager: 'npm' | 'pnpm'): Promise<UpdateOutcome> {
        // npm 的 update 对没装过的全局包会报错，未安装时改用 install
        const verb = bloomery.value.found ? 'update' : 'install'
        const args = manager === 'pnpm' ? ['add', '-g', 'bloomery'] : [verb, '-g', 'bloomery']
        const command = `${manager} ${args.join(' ')}`
        const before = bloomery.value.version

        const result = await streamCommand(manager, args)
        await check()
        const tail = updateLines.value.slice(-12)
        if (!result.spawned) {
            return {
                ok: false,
                cancelled: false,
                before,
                after: bloomery.value.version,
                command,
                tail,
                error: `${manager} 调用失败，可能未安装`,
            }
        }
        if (result.cancelled) {
            return {
                ok: false,
                cancelled: true,
                before,
                after: bloomery.value.version,
                command,
                tail,
                error: '已取消',
            }
        }
        return {
            ok: result.code === 0,
            cancelled: false,
            before,
            after: bloomery.value.version,
            command,
            tail,
            error: result.code === 0 ? '' : `${command} 退出码 ${result.code ?? '未知'}`,
        }
    }

    /** macOS：用 Homebrew 安装 Node.js（已装过期的 formula 会自动升级），输出逐行回传 */
    async function updateNodeWithBrew(): Promise<UpdateOutcome> {
        // brew install 对已安装但过期的 formula 会自动升级，也兼容 nvm 装的 Node
        const args = ['install', 'node']
        const command = 'brew install node'
        const before = node.value.version

        const result = await streamCommand('brew', args)
        await check()
        const tail = updateLines.value.slice(-12)
        const after = node.value.version
        if (!result.spawned) {
            return {
                ok: false,
                cancelled: false,
                before,
                after,
                command,
                tail,
                error: 'brew 调用失败，可能未安装',
            }
        }
        if (result.cancelled) {
            return {
                ok: false,
                cancelled: true,
                before,
                after,
                command,
                tail,
                error: '已取消',
            }
        }
        return {
            ok: result.code === 0,
            cancelled: false,
            before,
            after,
            command,
            tail,
            error: result.code === 0 ? '' : `${command} 退出码 ${result.code ?? '未知'}`,
        }
    }

    /** 取消进行中的更新 */
    async function cancelUpdate(): Promise<void> {
        if (updateId.length === 0) {
            return
        }
        updateCancelled = true
        await killProgram(updateId).catch(() => undefined)
    }

    return {
        checked,
        checking,
        facts,
        packageManager,
        isWindows,
        isLinux,
        isMacos,
        brew,
        installCommands,
        nodeInstaller,
        installNode,
        updateNode,
        updateNodeWithBrew,
        node,
        bloomery,
        nvm,
        pnpm,
        latestNode,
        latestBloomery,
        situation,
        nodeOutdated,
        bloomeryOutdated,
        usable,
        updating,
        updateLines,
        updateBloomery,
        cancelUpdate,
        check,
    }
})
