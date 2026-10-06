import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import type { CliAccount } from '@/api/account'
import { killCli } from '@/api/transport.tauri'
import { useCli } from '@/composables/useCli'

export interface AccountFailure {
    code: string
    message: string
    detail: string | null
    /** 来自错误信封，可重试才有意义 */
    retryable: boolean
}

function toFailure(error: unknown): AccountFailure {
    return error instanceof BloomeryError
        ? {
              code: error.code,
              message: error.message,
              detail: error.detail,
              retryable: error.retryable,
          }
        : { code: 'Unknown', message: String(error), detail: null, retryable: false }
}

/** CLI 已登入账户列表 */
export const useAccountService = defineStore('AccountService', () => {
    const accounts = ref<CliAccount[]>([])
    const loading = ref(false)
    /** 正在切换的账户 id */
    const switching = ref<string | null>(null)
    const failure = ref<AccountFailure | null>(null)

    const selected = computed(() => accounts.value.find((item) => item.selected) ?? null)

    async function load(): Promise<void> {
        loading.value = true
        failure.value = null
        try {
            const client = await useCli().client()
            const rows = await client.run<unknown>(['auth', 'list'], { progress: false })
            // 形状不对时按空列表处理，避免渲染期抛错带崩整个界面
            accounts.value = Array.isArray(rows) ? (rows as CliAccount[]) : []
        } catch (error) {
            accounts.value = []
            failure.value = toFailure(error)
        } finally {
            loading.value = false
        }
    }

    /** 切换选中账户：只改 selectedAccount，切完重拉列表 */
    async function select(account: CliAccount): Promise<void> {
        if (account.selected || switching.value !== null) {
            return
        }
        switching.value = account.id
        failure.value = null
        try {
            const client = await useCli().client()
            await client.run(['auth', 'use', account.name, '--type', account.type], {
                progress: false,
            })
            await load()
        } catch (error) {
            failure.value = toFailure(error)
        } finally {
            switching.value = null
        }
    }

    /** 设备码提示，等待用户在浏览器完成授权 */
    const device = ref<{
        userCode: string
        verificationUri: string
        verificationUriComplete: string | null
        expiresAt: string
        message: string
    } | null>(null)
    /** 进行中的微软登录调用 id，用于取消 */
    const loginCallId = ref('')

    /** 微软登录：设备码流程，事件从 stdout 的 NDJSON 逐行回来 */
    async function loginMicrosoft(): Promise<boolean> {
        device.value = null
        failure.value = null
        const id = `auth-login-${Date.now()}`
        loginCallId.value = id
        try {
            const client = await useCli().client()
            await client.run<string>(['auth', 'login', '--type', 'microsoft'], {
                id,
                progress: false,
                raw: true,
                onStdoutLine: (line) => {
                    const text = line.trim()
                    if (text.length === 0 || text.startsWith('{') === false) {
                        return
                    }
                    try {
                        const event = JSON.parse(text) as Record<string, unknown>
                        if (event.event === 'device') {
                            device.value = {
                                userCode: String(event.userCode ?? ''),
                                verificationUri: String(event.verificationUri ?? ''),
                                verificationUriComplete:
                                    typeof event.verificationUriComplete === 'string'
                                        ? event.verificationUriComplete
                                        : null,
                                expiresAt: String(event.expiresAt ?? ''),
                                message: String(event.message ?? ''),
                            }
                        }
                    } catch {
                        // 非 JSON 行忽略
                    }
                },
            })
            await load()
            return failure.value === null
        } catch (error) {
            failure.value = toFailure(error)
            return false
        } finally {
            loginCallId.value = ''
            device.value = null
        }
    }

    /** 取消微软登录 */
    async function cancelLogin(): Promise<void> {
        const id = loginCallId.value
        if (id.length === 0) {
            return
        }
        await killCli(id).catch(() => undefined)
    }

    /** 添加离线账户 */
    async function loginOffline(name: string): Promise<boolean> {
        const value = name.trim()
        if (value.length === 0 || switching.value !== null) {
            return false
        }
        switching.value = value
        failure.value = null
        try {
            const client = await useCli().client()
            await client.run(['auth', 'login', value, '--type', 'offline'], { progress: false })
            await load()
            return failure.value === null
        } catch (error) {
            failure.value = toFailure(error)
            return false
        } finally {
            switching.value = null
        }
    }

    /** 移除账户：走 auth logout，账户与凭据一并删除 */
    async function remove(account: CliAccount): Promise<void> {
        if (switching.value !== null) {
            return
        }
        switching.value = account.id
        failure.value = null
        try {
            const client = await useCli().client()
            await client.run(['auth', 'logout', account.name, '--type', account.type], {
                progress: false,
            })
            await load()
        } catch (error) {
            failure.value = toFailure(error)
        } finally {
            switching.value = null
        }
    }

    return {
        accounts,
        loading,
        switching,
        failure,
        selected,
        device,
        load,
        select,
        remove,
        loginOffline,
        loginMicrosoft,
        cancelLogin,
    }
})
