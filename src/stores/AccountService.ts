import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { BloomeryError } from '@/api/bloomery'
import type { CliAccount } from '@/api/account'
import { useCli } from '@/composables/useCli'

export interface AccountFailure {
    code: string
    message: string
    detail: string | null
}

function toFailure(error: unknown): AccountFailure {
    return error instanceof BloomeryError
        ? { code: error.code, message: error.message, detail: error.detail }
        : { code: 'Unknown', message: String(error), detail: null }
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

    return { accounts, loading, switching, failure, selected, load, select, remove }
})
