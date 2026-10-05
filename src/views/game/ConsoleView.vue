<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import BackButton from '@/components/BackButton.vue'
import GroupButton from '@/components/GroupButton.vue'
import { readTextFile } from '@/api/files'
import { useLaunchService } from '@/stores/LaunchService'

const route = useRoute()
const launch = useLaunchService()
const instanceId = computed(() => decodeURIComponent(String(route.params.instanceId ?? '')))
/** 旧链接可能没有文件夹段，回退到启动时记录的实例 */
const folderFromRoute = computed(() => decodeURIComponent(String(route.params.folderId ?? '')))

const text = ref('')
const offset = ref(0)
const size = ref(0)
const failure = ref('')
const following = ref(true)
const viewport = ref<HTMLElement | null>(null)

const sameInstance = computed(
    () =>
        launch.instance === instanceId.value &&
        (folderFromRoute.value.length === 0 || launch.folder === folderFromRoute.value),
)
const logPath = computed(() => (sameInstance.value ? launch.logPath : ''))

/** 单次拉取到 0 字节且没有更多内容，就当作追平 */
async function pull(): Promise<void> {
    const path = logPath.value
    if (path.length === 0 || !following.value) {
        return
    }
    try {
        const chunk = await readTextFile(path, offset.value)
        if (chunk.text.length > 0) {
            text.value += chunk.text
            offset.value = chunk.offset + chunk.text.length
            void scrollToEnd()
        }
        size.value = chunk.size
        failure.value = ''
    } catch (error) {
        failure.value = error instanceof Error ? error.message : String(error)
    }
}

async function scrollToEnd(): Promise<void> {
    await Promise.resolve()
    const element = viewport.value
    if (element !== null) {
        element.scrollTop = element.scrollHeight
    }
}

function clear(): void {
    text.value = ''
    offset.value = 0
    void pull()
}

let timer: number | undefined

onMounted(() => {
    void pull()
    timer = window.setInterval(() => void pull(), 1000)
})

watch(logPath, () => {
    text.value = ''
    offset.value = 0
    void pull()
})

onBeforeUnmount(() => {
    if (timer !== undefined) {
        window.clearInterval(timer)
    }
})
</script>

<template>
    <main class="console">
        <header class="console__head">
            <BackButton fallback="/version/list" />
            <h1 class="console__title">{{ instanceId }}</h1>
            <GroupButton variant="ghost" @click="following = !following">
                {{ following ? '停止跟随' : '继续跟随' }}
            </GroupButton>
            <GroupButton variant="ghost" @click="clear">清屏</GroupButton>
        </header>

        <p v-if="logPath.length === 0" class="console__note">该实例本次会话无启动记录</p>

        <template v-else>
            <p class="console__meta">
                <span class="console__path">{{ logPath }}</span>
                <span>· {{ size }} 字节</span>
                <span v-if="!following">· 已暂停跟随</span>
            </p>
            <p v-if="failure" class="console__failure">{{ failure }}</p>
            <pre ref="viewport" class="console__output">{{
                text.length > 0 ? text : '暂无输出'
            }}</pre>
        </template>
    </main>
</template>

<style scoped lang="scss">
.console {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    height: 100%;
    padding: 1.5rem;
}

.console__head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.console__title {
    flex: 1;
    margin: 0;

    font-size: var(--font-size-lg);
    word-break: break-all;
}

.console__note,
.console__meta {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}

.console__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}

.console__path {
    font-family: ui-monospace, monospace;
    word-break: break-all;
}

.console__failure {
    margin: 0;

    font-size: var(--font-size-xs);
}

.console__output {
    flex: 1;
    min-height: 12rem;
    margin: 0;
    padding: 0.75rem;

    overflow: auto;

    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    word-break: break-all;

    background-color: var(--bg-color-dark);
    border: 1px solid var(--text-color-dark);
    border-radius: var(--border-radius);
}
</style>
