import type { CliModSearch } from './types'

/** 一次操作落在哪个实例上；gameVersion 与 loader 由实例推导，用来筛检索结果 */
export interface ModScope {
    folderId: string
    instanceId: string
    gameVersion: string | null
    /** 原版实例为 null */
    loader: string | null
}

/** 界面上的 MOD 管理动作 */
export type ModAction = 'remove' | 'disable' | 'enable'

/**
 * 实例目标参数
 *
 * --version 与 --folder 一起给：CLI 在指定文件夹里按下标找实例，只给 --version 会在当前文件夹里找
 */
export function targetArgs(scope: ModScope): string[] {
    const args: string[] = []
    if (scope.folderId.length > 0) {
        args.push('--folder', scope.folderId)
    }
    if (scope.instanceId.length > 0) {
        args.push('--version', scope.instanceId)
    }
    return args
}

/** 检索：带实例就由 CLI 解析出游戏版本与加载器做分面过滤 */
export function searchArgs(scope: ModScope, query: string, limit: number): string[] {
    return ['mod', 'search', query, ...targetArgs(scope), '--limit', String(limit)]
}

/** 已装列表：offline 跳过 sha1 反查，用来做两段式渲染的第一段 */
export interface ListOptions {
    /** 不联网反查已装 MOD */
    offline?: boolean
    /** 忽略中文名表的 TTL，强制重新拉取 */
    refreshNames?: boolean
}

export function listArgs(scope: ModScope, options: ListOptions = {}): string[] {
    const args = ['mod', 'list', ...targetArgs(scope)]
    if (options.offline === true) {
        args.push('--offline')
    }
    if (options.refreshNames === true) {
        args.push('--refresh-names')
    }
    return args
}

/**
 * 安装：支持多个目标
 *
 * deps 两个方向都要显式给，省略会回落到 CLI 设置里的 installDependencies
 */
export function installArgs(scope: ModScope, targets: string[], deps: boolean): string[] {
    return ['mod', 'install', ...targets, ...targetArgs(scope), deps ? '--deps' : '--no-deps']
}

/** 删除 / 禁用 / 启用：目标取 mod list 给的 filename */
export function mutateArgs(action: ModAction, scope: ModScope, targets: string[]): string[] {
    return ['mod', action, ...targets, ...targetArgs(scope)]
}

/** 入队安装：同一套参数加 --async，任务落到 CLI 的下载队列 */
export function queueArgs(scope: ModScope, targets: string[], deps: boolean): string[] {
    return [...installArgs(scope, targets, deps), '--async']
}

/** 检索结果里能直接当安装目标的字段，优先 slug */
export function targetOfHit(hit: CliModSearch['hits'][number]): string {
    return hit.slug.length > 0 ? hit.slug : hit.id
}
