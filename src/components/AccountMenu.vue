<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from 'vue'
import type { CliAccount } from '@/api/account'
import { usePopover } from '@/composables/usePopover'
import { accountTypeLabel, avatarInitial, avatarUrl } from '@/utils/accountAvatar'

const props = withDefaults(
    defineProps<{
        accounts: CliAccount[]
        /** 头像按钮尺寸 */
        size?: number
        /** 正在切换的账户 id */
        switching?: string | null
        /** 实际使用的数据目录，空串表示 CLI 默认目录 */
        home?: string
    }>(),
    {
        size: 40,
        switching: null,
        home: '',
    },
)

const emit = defineEmits<{
    /** 点选账户，切换动作由父级执行 */
    select: [account: CliAccount]
}>()

/** 当前选中账户，没有选中时用第一条 */
const current = computed(
    () => props.accounts.find((item) => item.selected) ?? props.accounts[0] ?? null,
)

const failedIds = ref<Set<string>>(new Set())
const {
    root,
    content: list,
    open,
    anchor,
    close,
} = usePopover({
    trigger: '.account-menu__trigger',
    placement: 'beside',
    gap: 8,
})

/** 函数 ref：字符串 ref 的写法拿不到 TS 的“已使用”判定 */
function bindRoot(el: Element | ComponentPublicInstance | null): void {
    root.value = el instanceof HTMLElement ? el : null
}

function bindList(el: Element | ComponentPublicInstance | null): void {
    list.value = el instanceof HTMLElement ? el : null
}

/** 已选中的项与切换中的项不再重复触发 */
function pick(account: CliAccount): void {
    if (account.selected || props.switching !== null) {
        close()
        return
    }
    emit('select', account)
    close()
}

/** 头像加载失败后改用文字占位 */
function onAvatarError(id: string | undefined): void {
    if (id === undefined) {
        return
    }
    const next = new Set(failedIds.value)
    next.add(id)
    failedIds.value = next
}

function showImage(account: CliAccount): boolean {
    return avatarUrl(account) !== null && !failedIds.value.has(account.id)
}
</script>

<template>
    <div :ref="bindRoot" class="account-menu">
        <button
            type="button"
            class="account-menu__trigger"
            :style="{ width: `${size}px`, height: `${size}px` }"
            aria-label="账户列表"
            :aria-expanded="open"
            @click="open = !open"
        >
            <img
                v-if="current && avatarUrl(current) && !failedIds.has(current.id)"
                class="account-menu__avatar"
                :src="avatarUrl(current) ?? undefined"
                alt=""
                @error="onAvatarError(current?.id)"
            />
            <span v-else class="account-menu__initial">
                {{ avatarInitial(current?.name ?? '') }}
            </span>
        </button>
    </div>

    <Teleport to="body">
        <ul
            v-if="open"
            :ref="bindList"
            class="account-menu__list"
            :style="{
                top: anchor.top === null ? undefined : `${anchor.top}px`,
                bottom: anchor.bottom === null ? undefined : `${anchor.bottom}px`,
                left: anchor.left === null ? undefined : `${anchor.left}px`,
                right: anchor.right === null ? undefined : `${anchor.right}px`,
                maxHeight: `${anchor.maxHeight}px`,
            }"
        >
            <li v-if="accounts.length === 0" class="account-menu__empty">
                <span>无已登入账户</span>
                <span class="account-menu__empty-dir">
                    数据目录 {{ home.length > 0 ? home : 'CLI 默认目录' }}
                </span>
            </li>
            <li v-for="account in accounts" :key="account.id">
                <button
                    type="button"
                    class="account-menu__item"
                    :class="{
                        'account-menu__item--selected': account.selected,
                        'account-menu__item--switching': switching === account.id,
                    }"
                    :aria-current="account.selected ? 'true' : undefined"
                    :disabled="switching !== null"
                    @click="pick(account)"
                >
                    <span class="account-menu__row-avatar">
                        <img
                            v-if="showImage(account)"
                            class="account-menu__avatar"
                            :src="avatarUrl(account) ?? undefined"
                            alt=""
                            @error="onAvatarError(account.id)"
                        />
                        <span v-else class="account-menu__initial">
                            {{ avatarInitial(account.name) }}
                        </span>
                    </span>
                    <span class="account-menu__text">
                        <span class="account-menu__name">{{ account.name }}</span>
                        <span class="account-menu__meta">
                            {{ accountTypeLabel(account.type) }} · {{ account.status }}
                        </span>
                    </span>
                </button>
            </li>
        </ul>
    </Teleport>
</template>

<style scoped lang="scss">
.account-menu__trigger {
    display: grid;
    place-items: center;

    padding: 0;

    background-color: var(--button-bg-color);
    border: 1px solid transparent;
    border-radius: 50%;
    cursor: pointer;

    transition:
        border-color var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);

    &:hover {
        border-color: var(--text-color-dark);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }
}

.account-menu__avatar,
.account-menu__initial {
    grid-area: 1 / 1;

    width: 100%;
    height: 100%;

    border-radius: 50%;
}

.account-menu__avatar {
    object-fit: cover;
}

.account-menu__initial {
    display: grid;
    place-items: center;

    color: var(--text-color);
    font-size: var(--font-size-sm);
    font-weight: 600;

    background-color: var(--bg-color-dark);
}

.account-menu__list {
    position: fixed;
    z-index: 40;

    display: flex;
    flex-direction: column;

    min-width: 12rem;
    margin: 0;
    padding: 0.25rem;

    overflow-y: auto;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: var(--bg-color);
    border: 1px solid color-mix(in srgb, var(--text-color) 18%, transparent);
    border-radius: var(--border-radius);

    list-style: none;
}

.account-menu__empty {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;

    padding: 0.5rem;

    color: var(--text-color-dark);
}

.account-menu__empty-dir {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);

    word-break: break-all;
}

.account-menu__item {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    width: 100%;
    padding: 0.35rem 0.5rem;

    color: inherit;
    font: inherit;
    text-align: left;

    background-color: transparent;
    border: none;
    border-radius: calc(var(--border-radius) / 1.5);
    cursor: pointer;

    transition: background-color var(--transition-duration) var(--transition-ease);

    &:hover:not(:disabled) {
        background-color: var(--button-bg-color);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: -2px;
    }

    &:disabled {
        cursor: default;
    }
}

.account-menu__item--selected {
    font-weight: 600;

    background-color: var(--button-bg-color);
}

.account-menu__item--switching {
    opacity: 0.6;
}

.account-menu__row-avatar {
    display: grid;
    place-items: center;

    flex: 0 0 auto;

    width: 1.75rem;
    height: 1.75rem;
}

.account-menu__text {
    display: flex;
    min-width: 0;
    flex-direction: column;
}

.account-menu__name {
    overflow: hidden;

    white-space: nowrap;
    text-overflow: ellipsis;
}

.account-menu__meta {
    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    font-weight: 400;
}
</style>
