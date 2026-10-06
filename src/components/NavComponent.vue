<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import {
    PhArrowCircleUp,
    PhCaretDown,
    PhFlame,
    PhGameController,
    PhGear,
    PhUser,
} from '@phosphor-icons/vue'
import AccountMenu from '@/components/AccountMenu.vue'
import type { CliAccount } from '@/api/account'
import { errorSummary } from '@/api/errorMessages'
import { useAccountService } from '@/stores/AccountService'
import { useAppearanceService } from '@/stores/AppearanceService'
import { useEnvironmentCheckService } from '@/stores/EnvironmentCheckService'
import { useEnvironmentService } from '@/stores/EnvironmentService'
import { accountTypeLabel } from '@/utils/accountAvatar'
import { notifyError } from '@/utils/notify'

interface NavItem {
    label: string
    to: string | (() => RouteLocationRaw)
}

interface NavGroup {
    id: string
    label: string
    icon: Component
    items: NavItem[]
}

const groups: NavGroup[] = [
    {
        id: 'game',
        label: '游戏',
        icon: PhGameController,
        items: [
            { label: '版本列表', to: '/version/list' },
            { label: '安装新版本', to: '/version/install' },
        ],
    },
    {
        id: 'account',
        label: '账户',
        icon: PhUser,
        items: [{ label: '账户管理', to: '/account' }],
    },
    {
        id: 'general',
        label: '通用',
        icon: PhGear,
        items: [
            { label: '设置', to: '/setting' },
            { label: '引擎设置', to: '/setting/bloomery' },
            { label: '运行环境', to: '/info' },
        ],
    },
]

/** 侧栏运行时状态：初值取设置里的默认状态，切换只影响本次运行 */
const appearance = useAppearanceService()
const isMenuOpen = ref(!appearance.navDefaultCollapsed)
const openGroupIds = ref<Set<string>>(new Set(['game']))
const accountService = useAccountService()
const environment = useEnvironmentService()
const envCheck = useEnvironmentCheckService()

/**
 * 侧栏更新提示：只管 Bloomery 是否有新版本
 * Node.js 低于 22 属于跑不起来，已由启动跳转强制进配置页，不在此重复提示
 */
const updateNotice = computed(() =>
    envCheck.bloomeryOutdated ? `Bloomery 可更新到 ${envCheck.latestBloomery}` : '',
)

/** 切换账户失败时给出可见反馈 */
async function selectAccount(account: CliAccount): Promise<void> {
    await accountService.select(account)
    const failure = accountService.failure
    if (failure !== null) {
        const detail = failure.detail === null ? '' : ` · ${failure.detail}`
        notifyError(`${errorSummary(failure.code, failure.message, failure.retryable)}${detail}`)
    }
}

onMounted(accountService.load)

// 可达状态：侧栏收起时分组同样按收起处理
function isGroupOpen(id: string): boolean {
    return isMenuOpen.value && openGroupIds.value.has(id)
}

function toggleMenu(): void {
    isMenuOpen.value = !isMenuOpen.value
}

function toggleGroup(id: string): void {
    const next = new Set(openGroupIds.value)
    if (!isMenuOpen.value) {
        if (!next.has(id)) {
            next.add(id)
        }
    } else {
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
    }
    isMenuOpen.value = true
    openGroupIds.value = next
}

function resolveTo(item: NavItem): RouteLocationRaw {
    return typeof item.to === 'function' ? item.to() : item.to
}
</script>

<template>
    <nav class="nav" :class="{ 'nav--collapsed': !isMenuOpen }" aria-label="主导航">
        <button
            type="button"
            class="nav__toggle"
            :aria-label="isMenuOpen ? '收起导航' : '展开导航'"
            :aria-expanded="isMenuOpen"
            aria-controls="nav-menu"
            @click="toggleMenu"
        >
            <span class="nav__bar" aria-hidden="true"></span>
            <span class="nav__bar" aria-hidden="true"></span>
            <span class="nav__bar" aria-hidden="true"></span>
        </button>

        <div id="nav-menu" class="nav__menu">
            <RouterLink class="nav__brand" to="/">
                <PhFlame class="nav__brand-mark" :size="20" weight="regular" aria-hidden="true" />
                <span class="nav__brand-text">Bloomery</span>
            </RouterLink>

            <ul class="nav__list">
                <li v-for="group in groups" :key="group.id" class="nav__item">
                    <button
                        :id="`nav-group-${group.id}`"
                        type="button"
                        class="nav__group-toggle"
                        :aria-expanded="isGroupOpen(group.id)"
                        :aria-controls="`nav-group-${group.id}-content`"
                        :title="isMenuOpen ? undefined : group.label"
                        @click="toggleGroup(group.id)"
                    >
                        <component
                            :is="group.icon"
                            class="nav__icon"
                            :size="20"
                            weight="regular"
                            aria-hidden="true"
                        />
                        <span class="nav__label">{{ group.label }}</span>
                        <PhCaretDown
                            class="nav__caret"
                            :size="16"
                            weight="regular"
                            aria-hidden="true"
                        />
                    </button>

                    <div
                        :id="`nav-group-${group.id}-content`"
                        class="nav__group-content"
                        role="group"
                        :aria-labelledby="`nav-group-${group.id}`"
                    >
                        <div class="nav__group-inner">
                            <RouterLink
                                v-for="item in group.items"
                                :key="item.label"
                                class="nav__link"
                                :to="resolveTo(item)"
                            >
                                <span class="nav__link-text">{{ item.label }}</span>
                            </RouterLink>
                        </div>
                    </div>
                </li>
            </ul>
        </div>

        <div class="nav__user">
            <AccountMenu
                :accounts="accountService.accounts"
                :size="32"
                :switching="accountService.switching"
                :home="environment.home"
                @select="selectAccount"
            />
            <div class="nav__user-text">
                <span class="nav__user-name">{{ accountService.selected?.name ?? '未登录' }}</span>
                <span class="nav__user-meta">
                    {{
                        accountService.selected
                            ? `${accountTypeLabel(accountService.selected.type)} · ${accountService.selected.status}`
                            : 'auth login 添加账户'
                    }}
                </span>
            </div>
        </div>

        <RouterLink
            v-if="updateNotice.length > 0"
            class="nav__update"
            to="/setup"
            :title="updateNotice"
            :aria-label="updateNotice"
        >
            <PhArrowCircleUp :size="18" weight="regular" aria-hidden="true" />
            <span class="nav__update-text">{{ updateNotice }}</span>
        </RouterLink>
    </nav>
</template>

<style scoped lang="scss">
.nav {
    user-select: none;
    --nav-toggle-size: 3rem;
    --nav-width-expanded: 15rem;
    --nav-collapsed-width: 3.5rem;
    --nav-inline-padding: 0.875rem;

    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 0.5rem;

    position: relative;

    width: var(--nav-width-expanded);
    height: 100%;
    /* 底部留出余量：账户区与提示不贴窗口下沿 */
    padding: 0.25rem 0.25rem 1.5rem;

    overflow: hidden;
    contain: layout;

    color: var(--text-color);
    border-right: 1px solid color-mix(in srgb, var(--text-color) 14%, transparent);

    transition: width var(--transition-duration) var(--transition-ease);

    // 背景交给独立图层，透明度可配，内容不受影响
    &::before {
        content: '';

        position: absolute;
        inset: 0;
        z-index: 0;

        pointer-events: none;

        background-color: var(--bg-color-dark);
        opacity: var(--nav-opacity, 0.8);

        transition: opacity var(--transition-duration) var(--transition-ease);
    }

    > * {
        position: relative;
        z-index: 1;
    }

    // 4px 内边距 + 48px 按钮 -> 收起态两侧各 4px
    &--collapsed {
        width: var(--nav-collapsed-width);
    }
}

.nav__toggle {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    justify-content: center;
    gap: 0.375rem;
    align-self: flex-start;

    width: var(--nav-toggle-size);
    height: var(--nav-toggle-size);
    padding: 0.75rem;

    color: inherit;
    background-color: transparent;
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;

    transition: background-color var(--transition-duration) var(--transition-ease);

    /* 三条杠不参与命中判定，整块都算按钮 */
    .nav__bar {
        pointer-events: none;
    }

    &:hover {
        background-color: var(--button-bg-color);
    }

    &:active {
        background-color: var(--button-bg-color-dark);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }

    &[aria-expanded='true'] {
        .nav__bar:nth-child(1) {
            transform: translateY(0.5rem) rotate(45deg);
        }

        .nav__bar:nth-child(2) {
            opacity: 0;
        }

        .nav__bar:nth-child(3) {
            transform: translateY(-0.5rem) rotate(-45deg);
        }
    }
}

// 条高 2px + 间隙 6px -> 位移 0.5rem 时两线交于中线
.nav__bar {
    display: block;
    width: 100%;
    height: 0.125rem;

    background-color: currentColor;
    border-radius: 1px;

    transition:
        transform var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);
}

.nav__menu {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.5rem;

    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    // 滚动条槽位常驻
    scrollbar-gutter: stable;
}

.nav__brand {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    column-gap: 0.5rem;

    min-height: 2.75rem;
    padding: 0 var(--nav-inline-padding);

    color: inherit;
    font-size: var(--font-size-lg);
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;

    border-radius: var(--border-radius);

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        column-gap var(--transition-duration) var(--transition-ease);

    &:hover {
        background-color: var(--button-bg-color);
    }

    &.router-link-active {
        background-color: var(--button-bg-color);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }
}

.nav__brand-mark {
    flex: 0 0 auto;
}

.nav__brand-text {
    flex: 0 1 auto;
    max-width: 9rem;

    overflow: hidden;
    text-overflow: ellipsis;

    transition:
        max-width var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);
}

.nav__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

.nav__group-toggle {
    display: flex;
    align-items: center;
    column-gap: 0.75rem;

    width: 100%;
    min-height: 2.75rem;
    padding: 0.25rem var(--nav-inline-padding);

    color: inherit;
    font-size: var(--font-size-sm);
    text-align: left;

    background-color: transparent;
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;

    transition:
        background-color var(--transition-duration) var(--transition-ease),
        column-gap var(--transition-duration) var(--transition-ease);

    &:hover {
        background-color: var(--button-bg-color);
    }

    &:active {
        background-color: var(--button-bg-color-dark);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }
}

.nav__icon {
    flex: 0 0 auto;
}

// max-width：width 的 auto 无法插值
.nav__label {
    flex: 0 1 auto;
    max-width: 9rem;
    margin-right: auto;

    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;

    transition:
        max-width var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);
}

.nav__caret {
    flex: 0 0 auto;
    width: 1rem;
    opacity: 0.7;

    transition:
        width var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease),
        transform var(--transition-duration) var(--transition-ease);
}

.nav__group-toggle[aria-expanded='true'] .nav__caret {
    transform: rotate(180deg);
}

/*
 * 折叠态为默认值，展开态按 aria-expanded 由相邻兄弟选择器覆盖
 * grid-template-rows 管高度，visibility 管可达性：显现立即可见，隐藏留到动画结束
 * 高度收起延迟 60ms，内容展开延迟 90ms
 */
.nav__group-content {
    display: grid;
    grid-template-rows: 0fr;

    visibility: hidden;

    transition:
        grid-template-rows var(--transition-duration) var(--transition-ease) 60ms,
        visibility var(--transition-duration) var(--transition-ease);
}

.nav__group-toggle[aria-expanded='true'] + .nav__group-content {
    grid-template-rows: 1fr;

    visibility: visible;

    transition:
        grid-template-rows var(--transition-duration) var(--transition-ease),
        visibility 0s;
}

.nav__group-inner {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    min-height: 0;
    padding: 0.25rem 0 0.25rem 1.25rem;
    overflow: hidden;

    opacity: 0;
    transform: translateY(-0.25rem);

    transition:
        opacity 140ms var(--transition-ease),
        transform 140ms var(--transition-ease);
}

.nav__group-toggle[aria-expanded='true'] + .nav__group-content .nav__group-inner {
    opacity: 1;
    transform: none;

    // 容器先展开，子项后淡入
    transition-delay: 90ms;
}

.nav__link {
    display: flex;
    align-items: center;

    min-height: 2.25rem;
    padding: 0.25rem 0.75rem;

    font-size: var(--font-size-sm);
    text-decoration: none;

    border-radius: var(--border-radius);

    // 文字颜色取自全局 a 规则
    transition: background-color var(--transition-duration) var(--transition-ease);

    &:hover {
        background-color: var(--button-bg-color);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 2px;
    }

    // aria-current="page" 由 vue-router 自动加上
    &.router-link-active {
        font-weight: 600;
        background-color: var(--button-bg-color);
    }
}

// 省略号挂在裁剪文本的元素上，overflow:hidden 使 flex 项可收缩
.nav__link-text {
    overflow: hidden;

    text-overflow: ellipsis;
    white-space: nowrap;
}

/*
 * 账户区：justify-content 恒为居中，头像位置由文本的 flex-grow 决定
 * 展开时文本 flex-grow 1 撑满剩余宽度，居中不产生位移；收起时降到 0，头像自然落到容器中心
 * 参与动画的都是可插值属性：column-gap / flex-grow / padding
 */
.nav__update {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    column-gap: 0.5rem;

    margin: 0 0.25rem;
    padding: 0.4rem 0.5rem;

    color: var(--text-color);
    font-size: var(--font-size-xs);

    background-color: var(--button-bg-color);
    border-radius: var(--border-radius);

    transition:
        column-gap var(--transition-duration) var(--transition-ease),
        background-color var(--transition-duration) var(--transition-ease);

    &:hover {
        background-color: var(--button-bg-color-dark);
    }

    &:focus-visible {
        outline: 2px solid var(--text-color);
        outline-offset: 1px;
    }
}

.nav__update-text {
    overflow: hidden;

    max-width: 10rem;

    white-space: nowrap;
    text-overflow: ellipsis;

    transition:
        max-width var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);
}

.nav__user {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    column-gap: 0.5rem;

    padding: 1rem;

    transition:
        column-gap var(--transition-duration) var(--transition-ease),
        padding var(--transition-duration) var(--transition-ease);
}

.nav__user-text {
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    flex-direction: column;

    overflow: hidden;

    transition:
        flex-grow var(--transition-duration) var(--transition-ease),
        opacity var(--transition-duration) var(--transition-ease);
}

.nav__user-name {
    overflow: hidden;

    font-size: var(--font-size-sm);
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.nav__user-meta {
    overflow: hidden;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.nav--collapsed {
    .nav__brand,
    .nav__group-toggle {
        column-gap: 0;
    }

    .nav__brand-text,
    .nav__label {
        max-width: 0;
        opacity: 0;
    }

    .nav__caret {
        width: 0;
        opacity: 0;
    }

    // 收起时只留图标
    .nav__update {
        justify-content: center;

        margin: 0;
        padding-inline: 0;
        column-gap: 0;
    }

    .nav__update-text {
        max-width: 0;
        opacity: 0;
    }

    .nav__user {
        column-gap: 0;
        padding: 0.25rem;
    }

    .nav__user-text {
        flex-grow: 0;
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .nav,
    .nav__bar,
    .nav__brand,
    .nav__brand-text,
    .nav__toggle,
    .nav__group-toggle,
    .nav__label,
    .nav__caret,
    .nav__group-content,
    .nav__group-inner,
    .nav__user-text,
    .nav__update-text {
        transition: none;
    }
}
</style>
