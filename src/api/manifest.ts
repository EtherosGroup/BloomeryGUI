/**
 * Mojang 版本清单：CLI 装版本时取同一份
 *
 * 只列出可下载的版本；版本 json 由 CLI 自己按 id 取
 */

/** 与 CLI 的 version/manifest.ts 同一个地址 */
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export interface GameVersion {
    id: string
    /** release / snapshot / old_beta / old_alpha */
    type: string
    /** RFC3339 */
    releaseTime: string
}

function isVersion(row: unknown): row is { id: string; type: string; releaseTime?: unknown } {
    if (typeof row !== 'object' || row === null) {
        return false
    }
    const entry = row as { id?: unknown; type?: unknown }
    return typeof entry.id === 'string' && typeof entry.type === 'string'
}

/** 清单在进程内取一次就够，force 供刷新按钮用 */
let cached: GameVersion[] | null = null

/** 拉可安装的游戏版本，清单本身新在前 */
export async function fetchGameVersions(force = false): Promise<GameVersion[]> {
    if (!force && cached !== null) {
        return cached
    }
    const response = await fetch(MANIFEST_URL)
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
    }
    const body = (await response.json()) as { versions?: unknown }
    const rows = Array.isArray(body.versions) ? body.versions : []

    cached = rows.filter(isVersion).map((row) => ({
        id: row.id,
        type: row.type,
        releaseTime: typeof row.releaseTime === 'string' ? row.releaseTime : '',
    }))
    return cached
}
