import { createRouter, createWebHistory } from 'vue-router'
import NProgress from 'nprogress'

declare module 'vue-router' {
    interface RouteMeta {
        title?: string
    }
}

const routes = [
    {
        path: '/',
        name: 'index',
        component: () => import('@/views/IndexView.vue'),
        meta: {
            title: '首页',
        },
    },
    {
        path: '/setup',
        name: 'setup',
        component: () => import('@/views/setup/SetupView.vue'),
        meta: {
            title: '环境配置',
        },
    },
    {
        path: '/info',
        name: 'info',
        component: () => import('@/views/general/InfoView.vue'),
        meta: {
            title: '运行环境',
        },
    },
    {
        path: '/setting',
        name: 'setting',
        component: () => import('@/views/general/AppSetting.vue'),
        meta: {
            title: '设置',
        },
    },
    {
        path: '/setting/bloomery',
        name: 'bloomery-setting',
        component: () => import('@/views/general/BloomerySetting.vue'),
        meta: {
            title: '引擎设置',
        },
    },
    {
        path: '/account',
        name: 'account',
        component: () => import('@/views/account/AccountView.vue'),
        meta: {
            title: '账户管理',
        },
    },
    {
        path: '/version/list',
        name: 'version-list',
        component: () => import('@/views/game/VersionListView.vue'),
        meta: {
            title: '版本列表',
        },
    },
    {
        path: '/version/install',
        name: 'version-install',
        component: () => import('@/views/game/VersionInstallView.vue'),
        meta: {
            title: '安装新版本',
        },
    },
    {
        path: '/version/:folderId/:instanceId/console',
        name: 'version-console',
        component: () => import('@/views/game/ConsoleView.vue'),
        meta: {
            title: '游戏输出',
        },
    },
    {
        path: '/version/:folderId/:instanceId/setting',
        name: 'version-setting',
        component: () => import('@/views/game/VersionSettingView.vue'),
        meta: {
            title: '实例设置',
        },
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: () => import('@/views/error/NotFoundView.vue'),
        meta: {
            title: '页面未找到',
        },
    },
]

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: routes,
    scrollBehavior(_to, _from, savedPosition) {
        if (savedPosition) return savedPosition
        return { top: 0 }
    },
})

router.beforeEach((to) => {
    NProgress.start()
    document.title = to.meta.title ? `${to.meta.title} - Bloomery` : 'Bloomery'
})

router.afterEach(() => {
    NProgress.done()
})

export default router
