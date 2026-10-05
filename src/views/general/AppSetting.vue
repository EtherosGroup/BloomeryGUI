<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupInputFile from '@/components/GroupInputFile.vue'
import GroupRadio from '@/components/GroupRadio.vue'
import GroupRange from '@/components/GroupRange.vue'
import GroupSwitch from '@/components/GroupSwitch.vue'
import {
    backgroundUrl,
    currentBackground,
    removeBackground,
    saveBackground,
} from '@/api/background'
import { useAppearanceService, type ThemeMode } from '@/stores/AppearanceService'
import { useLaunchService } from '@/stores/LaunchService'
import { prepareImage } from '@/utils/imageFile'

/** GUI 自身的设置，与引擎无关 */
const appearance = useAppearanceService()
const launch = useLaunchService()

const theme = computed<ThemeMode>({
    get: () => appearance.theme,
    set: (value) => appearance.setTheme(value),
})

const navCollapsed = computed<boolean>({
    get: () => appearance.navDefaultCollapsed,
    set: (value) => appearance.setNavDefaultCollapsed(value),
})

const navOpacityPercent = computed<number>({
    get: () => Math.round(appearance.navOpacity * 100),
    set: (value) => appearance.setNavOpacity(value / 100),
})

/** 不再询问：启动前不再弹确认 */
const skipConfirm = computed<boolean>({
    get: () => launch.skipConfirm,
    set: (value) => launch.setSkipConfirm(value),
})

const veilPercent = computed<number>({
    get: () => Math.round(appearance.backgroundVeil * 100),
    set: (value) => appearance.setBackgroundVeil(value / 100),
})

const picked = ref<File | null>(null)
const picking = ref(false)
const backgroundNote = ref('')
/** 资源地址能否加载，用于定位显示问题 */
const loadState = ref<'idle' | 'ok' | 'failed'>('idle')

const hasBackground = computed(() => appearance.backgroundPath.length > 0)

const resolvedUrl = computed(() =>
    hasBackground.value ? backgroundUrl(appearance.backgroundPath) : '',
)

/** 缩放后写入应用数据目录，本地存储只留路径 */
async function applyBackground(): Promise<void> {
    const file = picked.value
    if (file === null) {
        return
    }
    picking.value = true
    backgroundNote.value = ''
    try {
        const prepared = await prepareImage(file)
        const bytes = new Uint8Array(await prepared.blob.arrayBuffer())
        const path = await saveBackground(bytes, prepared.extension)
        appearance.setBackgroundPath(path)
        loadState.value = 'idle'
        backgroundNote.value = `${prepared.width}×${prepared.height} · ${Math.round(bytes.byteLength / 1024)} KB`
        picked.value = null
    } catch (error) {
        backgroundNote.value = error instanceof Error ? error.message : String(error)
    } finally {
        picking.value = false
    }
}

async function clearBackground(): Promise<void> {
    try {
        await removeBackground()
    } catch (error) {
        backgroundNote.value = error instanceof Error ? error.message : String(error)
    }
    appearance.setBackgroundPath('')
    picked.value = null
    backgroundNote.value = ''
    loadState.value = 'idle'
}

// 本地存储被清过时从磁盘找回
onMounted(async () => {
    if (hasBackground.value) {
        return
    }
    try {
        const path = await currentBackground()
        if (path !== null) {
            appearance.setBackgroundPath(path)
        }
    } catch {
        // 没有磁盘文件或不在 Tauri 环境下都按无背景处理
    }
})
</script>

<template>
    <main class="app-setting">
        <header class="app-setting__head">
            <h1 class="app-setting__title">设置</h1>
        </header>

        <CollapsibleGroup label="界面" default-open>
            <GroupRadio
                v-model="theme"
                label="主题"
                :options="[
                    { label: '跟随系统', value: 'system' },
                    { label: '浅色', value: 'light' },
                    { label: '深色', value: 'dark' },
                ]"
            />
            <div class="app-setting__row">
                <GroupSwitch v-model="navCollapsed" label="侧栏默认收起" />
            </div>
            <GroupRange v-model="navOpacityPercent" label="侧栏不透明度" :min="0" :max="100" />
            <div class="app-setting__row">
                <GroupSwitch v-model="skipConfirm" label="启动时不再询问" />
                <span class="app-setting__note">启动前不再弹出确认，直接启动</span>
            </div>
        </CollapsibleGroup>

        <CollapsibleGroup label="背景" default-open>
            <GroupInputFile
                v-model="picked"
                label="背景图"
                accept="image/*"
                :max-size-mb="20"
                placeholder="选择图片"
            />
            <div class="app-setting__row">
                <GroupButton :disabled="picked === null || picking" @click="applyBackground">
                    {{ picking ? '处理中' : '应用为背景' }}
                </GroupButton>
                <GroupButton variant="ghost" :disabled="!hasBackground" @click="clearBackground">
                    清除背景
                </GroupButton>
                <span class="app-setting__note">
                    <template v-if="backgroundNote">{{ backgroundNote }}</template>
                    <template v-else>最长边自动缩到 2560，图片存进应用数据目录</template>
                </span>
            </div>
            <GroupRange
                v-model="veilPercent"
                label="遮罩"
                :min="0"
                :max="80"
                :disabled="!hasBackground"
            />
            <p class="app-setting__note">遮罩跟随主题：亮色加白、暗色加黑</p>

            <template v-if="hasBackground">
                <div class="app-setting__row app-setting__row--stack">
                    <span class="app-setting__key">文件</span>
                    <span class="app-setting__path">{{ appearance.backgroundPath }}</span>
                </div>
                <div class="app-setting__row app-setting__row--stack">
                    <span class="app-setting__key">加载</span>
                    <span class="app-setting__note">
                        {{
                            loadState === 'ok'
                                ? '已加载'
                                : loadState === 'failed'
                                  ? '加载失败 · 检查 assetProtocol 是否放行该路径'
                                  : '检测中'
                        }}
                    </span>
                    <!-- 探针：只判断资源地址能不能取到图，不展示地址本身 -->
                    <img
                        class="app-setting__probe"
                        :src="resolvedUrl"
                        alt=""
                        @load="loadState = 'ok'"
                        @error="loadState = 'failed'"
                    />
                </div>
            </template>
        </CollapsibleGroup>

        <p class="app-setting__note">
            主题、侧栏与背景路径存在浏览器本地 · 引擎参数在「引擎设置」 · 数据目录在「运行环境」
        </p>
    </main>
</template>

<style scoped lang="scss">
.app-setting {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 46rem;
    padding: 1.5rem;
}

.app-setting__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}

.app-setting__title {
    margin: 0;

    font-size: var(--font-size-3xl);
}

.app-setting__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.app-setting__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.app-setting__row--stack {
    align-items: baseline;
}

.app-setting__key {
    flex: 0 0 4.5rem;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.app-setting__path {
    flex: 1;
    min-width: 0;

    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);

    word-break: break-all;
}

/* 只作加载探针，不参与布局 */
.app-setting__probe {
    width: 1px;
    height: 1px;

    opacity: 0;
}
</style>
