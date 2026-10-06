<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhDotsThree } from '@phosphor-icons/vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import GroupRadio from '@/components/GroupRadio.vue'
import PopupMenu from '@/components/PopupMenu.vue'
import PopupWindow from '@/components/PopupWindow.vue'
import type { CliAccount } from '@/api/account'
import { errorSummary } from '@/api/errorMessages'
import { openPath } from '@/api/system'
import { notifySuccess, notifyError } from '@/utils/notify'
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

/** 添加账户弹窗 */
const addOpen = ref(false)
const addType = ref('offline')
const addName = ref('')

const addBusy = ref(false)

const addButtons: PopupWindowButton[] = [
    { label: '取消', onClick: cancelAdd },
    // 不 await：等待设备码授权期间取消仍可用
    {
        label: '添加',
        closeOnClick: false,
        onClick: () => {
            void addAccount()
        },
    },
]

async function addAccount(): Promise<void> {
    if (addType.value === 'microsoft') {
        addBusy.value = true
        const done = await accountService.loginMicrosoft()
        addBusy.value = false
        if (!done) {
            report()
            return
        }
        notifySuccess('账户已添加')
        addOpen.value = false
        return
    }

    const done = await accountService.loginOffline(addName.value)
    if (!done) {
        report()
        return
    }
    notifySuccess(`账户已添加 · ${addName.value.trim()}`)
    addName.value = ''
    addOpen.value = false
}

/** 取消：结束等待中的设备码授权 */
async function cancelAdd(): Promise<void> {
    await accountService.cancelLogin()
    addOpen.value = false
}

/** 设备码里的验证链接交给系统浏览器 */
async function openVerify(): Promise<void> {
    const prompt = accountService.device
    if (prompt === null) {
        return
    }
    await openPath(prompt.verificationUriComplete ?? prompt.verificationUri).catch(() => undefined)
}

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
    notifyError(`${errorSummary(failure.code, failure.message, failure.retryable)}${detail}`)
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
            <span class="accounts__actions">
                <GroupButton @click="addOpen = true">添加账户</GroupButton>
                <GroupButton
                    variant="ghost"
                    :disabled="accountService.loading"
                    @click="accountService.load"
                >
                    {{ accountService.loading ? '读取中' : '刷新' }}
                </GroupButton>
            </span>
        </header>

        <p v-if="accountService.failure" class="accounts__failure">
            <span class="accounts__failure-code">
                {{
                    errorSummary(
                        accountService.failure.code,
                        accountService.failure.message,
                        accountService.failure.retryable,
                    )
                }}
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

        <PopupWindow v-model:open="addOpen" title="添加账户" :buttons="addButtons">
            <GroupRadio
                v-model="addType"
                label="类型"
                :options="[
                    { label: '离线登录', value: 'offline' },
                    { label: 'Microsoft', value: 'microsoft' },
                ]"
            />
            <GroupInput v-if="addType === 'offline'" v-model="addName" label="游戏名" />

            <template v-else>
                <template v-if="accountService.device">
                    <div class="accounts__device">
                        <span class="accounts__device-key">验证码</span>
                        <span class="accounts__device-code">{{
                            accountService.device.userCode
                        }}</span>
                    </div>
                    <div class="accounts__device">
                        <span class="accounts__device-key">链接</span>
                        <span class="accounts__device-url">{{
                            accountService.device.verificationUri
                        }}</span>
                        <GroupButton variant="ghost" @click="openVerify">打开</GroupButton>
                    </div>
                    <p class="accounts__note">
                        过期时间 {{ accountService.device.expiresAt }} · 等待浏览器授权
                    </p>
                </template>
                <p v-else-if="addBusy" class="accounts__note">等待设备码</p>
                <p v-else class="accounts__note">微软登录为设备码流程</p>
            </template>
        </PopupWindow>

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

.accounts__device {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    font-size: var(--font-size-sm);
}

.accounts__device-key {
    flex: 0 0 4rem;

    color: var(--text-color-dark);
}

.accounts__device-code,
.accounts__device-url {
    flex: 1;
    min-width: 0;

    font-family: ui-monospace, monospace;

    word-break: break-all;
}

.accounts__device-code {
    font-size: var(--font-size-lg);
    font-weight: 600;
    letter-spacing: 0.1em;
}

.accounts__actions {
    display: flex;
    gap: 0.5rem;
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
