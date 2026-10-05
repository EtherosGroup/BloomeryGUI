<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhDotsThree } from '@phosphor-icons/vue'
import GroupButton from '@/components/GroupButton.vue'
import PopupMenu from '@/components/PopupMenu.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import type { CliAccount } from '@/api/account'
import { errorSummary } from '@/api/errorMessages'
import { useAccountService } from '@/stores/AccountService'
import { accountTypeLabel, avatarInitial, avatarUrl } from '@/utils/accountAvatar'
import type { PopupMenuItem } from '@/components/PopupMenu.vue'

const accountService = useAccountService()

/** 打开操作弹窗的账户 */
/** 待二次确认移除的账户 */
const pending = ref<CliAccount | null>(null)
const failedIds = ref<Set<string>>(new Set())

const confirmOpen = computed({
    get: () => pending.value !== null,
    set: (value: boolean) => {
        if (!value) {
            pending.value = null
        }
    },
})

import type { PopupWindowButton } from '@/types/PopupWindowButton'
import { notifySuccess, notifyError } from '@/utils/notify'

/** 每行的操作项，锚定在 ... 按钮旁 */
function actionsFor(account: CliAccount): PopupMenuItem[] {
    return [
        {
            label: '设为当前',
            onClick: () => accountService.select(account),
        },
        {
            label: '刷新状态',
            onClick: () => accountService.load(),
        },
        {
            label: '移除账户',
            danger: true,
            onClick: () => {
                pending.value = account
            },
        },
    ]
}

/** 头像加载失败后改用文字占位 */
function onAvatarError(id: string): void {
    const next = new Set(failedIds.value)
    next.add(id)
    failedIds.value = next
}

function showImage(account: CliAccount): boolean {
    return avatarUrl(account) !== null && !failedIds.value.has(account.id)
}

function report(): void {
    const failure = accountService.failure
    if (failure === null) {
        return
    }
    const detail = failure.detail === null ? '' : ` · ${failure.detail}`
    notifyError(`${errorSummary(failure.code, failure.message)}${detail}`)
}

async function confirmRemove(): Promise<void> {
    const account = pending.value
    if (account === null) {
        return
    }
    await accountService.remove(account)
    report()
    if (accountService.failure === null) {
        notifySuccess(`账户已移除 · ${account.name}`)
    }
}

/** 二次确认按钮：取消不做事，确认移除走 CLI */
const confirmButtons: PopupWindowButton[] = [
    { label: '取消' },
    { label: '确认移除', onClick: confirmRemove },
]

onMounted(accountService.load)
</script>

<template>
    <main class="accounts">
        <header class="accounts__head">
            <h1 class="accounts__title">账户管理</h1>
            <GroupButton
                variant="ghost"
                :disabled="accountService.loading"
                @click="accountService.load"
            >
                {{ accountService.loading ? '读取中' : '刷新' }}
            </GroupButton>
        </header>

        <p v-if="accountService.failure" class="accounts__failure">
            <span class="accounts__failure-code">
                {{ errorSummary(accountService.failure.code, accountService.failure.message) }}
            </span>
            <span v-if="accountService.failure.detail" class="accounts__failure-detail">
                {{ accountService.failure.detail }}
            </span>
        </p>

        <p v-if="accountService.accounts.length === 0" class="accounts__note">
            当前数据目录下没有账户
        </p>

        <ul v-else class="accounts__list">
            <li v-for="account in accountService.accounts" :key="account.id" class="accounts__row">
                <span class="accounts__avatar">
                    <img
                        v-if="showImage(account)"
                        class="accounts__image"
                        :src="avatarUrl(account) ?? undefined"
                        alt=""
                        @error="onAvatarError(account.id)"
                    />
                    <span v-else class="accounts__initial">{{ avatarInitial(account.name) }}</span>
                </span>

                <span class="accounts__text">
                    <span class="accounts__name">{{ account.name }}</span>
                    <span class="accounts__meta">
                        {{ accountTypeLabel(account.type) }} · {{ account.status }}
                    </span>
                </span>

                <span v-if="account.selected" class="accounts__tag">当前</span>
                <span
                    v-if="accountService.switching === account.id"
                    class="accounts__tag accounts__tag--busy"
                >
                    处理中
                </span>

                <PopupMenu :items="actionsFor(account)">
                    <GroupButton
                        variant="ghost"
                        :disabled="accountService.switching !== null"
                        aria-label="账户操作"
                        title="账户操作"
                    >
                        <PhDotsThree :size="18" weight="bold" aria-hidden="true" />
                    </GroupButton>
                </PopupMenu>
            </li>
        </ul>

        <PopupWindow
            v-model:open="confirmOpen"
            title="移除账户"
            :context="
                pending
                    ? `${pending.name}（${accountTypeLabel(pending.type)}）的账户与登录凭据一并删除，无法撤销`
                    : ''
            "
            :buttons="confirmButtons"
        />
    </main>
</template>

<style scoped lang="scss">
.accounts {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 46rem;
    padding: 1.5rem;
}

.accounts__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}

.accounts__title {
    margin: 0;

    font-size: var(--font-size-3xl);
}

.accounts__failure {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;

    margin: 0;
    padding: 0.6rem 0.75rem;

    font-size: var(--font-size-sm);

    background-color: color-mix(in srgb, #c62828 18%, transparent);
    border: 1px solid color-mix(in srgb, #c62828 45%, transparent);
    border-radius: var(--border-radius);
}

.accounts__failure-code {
    font-weight: 600;
}

.accounts__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.accounts__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-sm);
}

.accounts__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

.accounts__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;

    padding: 0.5rem 0.6rem;

    background-color: var(--bg-color-dark);
    border: 1px solid transparent;
    border-radius: var(--border-radius);
}

.accounts__avatar {
    display: grid;
    place-items: center;

    flex: 0 0 auto;

    width: 2rem;
    height: 2rem;

    overflow: hidden;
}

.accounts__image,
.accounts__initial {
    width: 100%;
    height: 100%;

    border-radius: 50%;
}

.accounts__image {
    object-fit: cover;
}

.accounts__initial {
    display: grid;
    place-items: center;

    color: var(--text-color);
    font-size: var(--font-size-sm);
    font-weight: 600;

    background-color: var(--button-bg-color);
}

.accounts__text {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
}

.accounts__name {
    overflow: hidden;

    font-size: var(--font-size-sm);
    font-weight: 600;

    white-space: nowrap;
    text-overflow: ellipsis;
}

.accounts__meta {
    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.accounts__tag {
    flex: 0 0 auto;

    padding: 0 0.4rem;

    color: var(--text-color);
    font-size: var(--font-size-xs);

    background-color: var(--button-bg-color);
    border-radius: calc(var(--border-radius) / 2);
}

.accounts__tag--busy {
    color: var(--text-color-dark);
    background-color: transparent;
}
</style>
