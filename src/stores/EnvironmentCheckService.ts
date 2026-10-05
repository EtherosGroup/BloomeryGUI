import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { downloadFile, runProgram, systemFacts, type SystemFacts } from '@/api/program'
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

/** 环境探测：Node / Bloomery / nvm / pnpm 与可更新的最新版本 */
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

    /** Linux 上给用户自己执行的命令 */
    const linuxCommands = computed<string[]>(() => {
        const rows: string[] = []
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

    /** 更新 Bloomery：有 pnpm 时命令由调用方选择 */
    async function updateBloomery(manager: 'npm' | 'pnpm'): Promise<string> {
        const args = manager === 'pnpm' ? ['add', '-g', 'bloomery'] : ['update', '-g', 'bloomery']
        const outcome = await runProgram(manager, args)
        if (!outcome.spawned) {
            return `${manager} 调用失败，可能未安装`
        }
        const text = (outcome.stdout + outcome.stderr).trim()
        await check()
        return text.length > 0 ? text.slice(0, 800) : `${manager} ${args.join(' ')} 已完成`
    }

    return {
        checked,
        checking,
        facts,
        packageManager,
        isWindows,
        isLinux,
        linuxCommands,
        nodeInstaller,
        installNode,
        updateNode,
        updateBloomery,
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
        check,
    }
})
