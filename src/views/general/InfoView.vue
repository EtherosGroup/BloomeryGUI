<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import CollapsibleGroup from '@/components/CollapsibleGroup.vue'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import { BloomeryError } from '@/api/bloomery'
import { useCli } from '@/composables/useCli'
import { openPath } from '@/api/system'
import type { CliStatus, CliVersionInfo } from '@/api/types'

interface Failure {
    code: string
    message: string
    detail: string | null
}

const { environment, client } = useCli()

const info = ref<CliVersionInfo | null>(null)
const status = ref<CliStatus | null>(null)
const failure = ref<Failure | null>(null)
const busy = ref(false)

const platform = computed(() => status.value?.host.platform.toLowerCase() ?? '')
const javaDefault = computed(() => status.value?.javaDefault ?? null)
const features = computed(() => status.value?.features ?? [])

async function refresh(): Promise<void> {
    busy.value = true
    failure.value = null
    try {
        const bloomery = await client()
        info.value = await bloomery.probe()
        status.value = await bloomery.run<CliStatus>(['status'], { progress: false })
    } catch (error) {
        info.value = null
        status.value = null
        failure.value =
            error instanceof BloomeryError
                ? { code: error.code, message: error.message, detail: error.detail }
                : { code: 'Unknown', message: String(error), detail: null }
    } finally {
        busy.value = false
    }
}

async function openDirectory(path: string): Promise<void> {
    try {
        await openPath(path)
    } catch (error) {
        failure.value = { code: 'OpenFailed', message: '无法打开路径', detail: String(error) }
    }
}

onMounted(refresh)
</script>

<template>
    <main class="setup">
        <header class="setup__head">
            <h1 class="setup__title">运行环境</h1>
            <GroupButton variant="ghost" :disabled="busy" @click="refresh">
                {{ busy ? '检测中' : '重新检测' }}
            </GroupButton>
        </header>

        <CollapsibleGroup label="CLI 定位">
            <GroupInput
                v-model="environment.cliPath"
                label="CLI 路径"
                placeholder="留空：开发期用仓库构建产物，运行时 PATH"
            />
            <GroupInput v-model="environment.home" label="数据目录 --home" />
        </CollapsibleGroup>

        <p v-if="failure" class="setup__failure">
            <span class="setup__failure-code">{{ failure.code }}</span>
            <span>{{ failure.message }}</span>
            <span v-if="failure.detail" class="setup__failure-detail">{{ failure.detail }}</span>
        </p>

        <template v-if="info && status">
            <CollapsibleGroup label="CLI" default-open>
                <div class="setup__rows">
                    <div class="setup__row">
                        <span class="setup__key">版本</span>
                        <span class="setup__value">{{ info.version }}</span>
                    </div>
                    <div class="setup__row">
                        <span class="setup__key">接口</span>
                        <span class="setup__value">{{
                            info.api === undefined ? '未知' : `api ${info.api}`
                        }}</span>
                    </div>
                    <div class="setup__row">
                        <span class="setup__key">Node</span>
                        <span class="setup__value">{{ status.node }}</span>
                    </div>
                    <div class="setup__row">
                        <span class="setup__key">主机</span>
                        <span class="setup__value">
                            {{ platform }} · {{ status.host.arch }} ·
                            {{ Math.round(status.host.memoryMb / 1024) }} GB
                        </span>
                    </div>
                </div>
            </CollapsibleGroup>

            <CollapsibleGroup label="数据目录">
                <div class="setup__rows">
                    <div class="setup__row">
                        <span class="setup__key">配置</span>
                        <span class="setup__value setup__value--path">{{ status.home }}</span>
                    </div>
                    <div class="setup__row">
                        <span class="setup__key">日志</span>
                        <span class="setup__value setup__value--path">{{ status.logs }}</span>
                    </div>
                </div>
                <div class="setup__actions">
                    <GroupButton variant="ghost" @click="openDirectory(status.home)">
                        打开配置目录
                    </GroupButton>
                    <GroupButton variant="ghost" @click="openDirectory(status.logs)">
                        打开日志目录
                    </GroupButton>
                </div>
            </CollapsibleGroup>

            <CollapsibleGroup :label="`Java ${status.java.length}`">
                <p v-if="status.java.length === 0" class="setup__note">未探测到 Java</p>
                <p v-else-if="javaDefault === null" class="setup__note">Java 选取 跟随自动选取</p>
                <ul v-if="status.java.length > 0" class="setup__list">
                    <li
                        v-for="item in status.java"
                        :key="item.path"
                        class="setup__item"
                        :class="{ 'setup__item--off': !item.usable }"
                    >
                        <span class="setup__item-main">
                            {{ item.vendor }} {{ item.major }} · {{ item.kind }} · {{ item.arch }}
                        </span>
                        <span class="setup__item-sub">{{ item.version }}</span>
                        <span v-if="item.path === javaDefault" class="setup__tag">默认</span>
                        <span v-if="!item.usable" class="setup__tag">不可用</span>
                    </li>
                </ul>
            </CollapsibleGroup>

            <CollapsibleGroup label="文件夹">
                <p v-if="status.folder === null" class="setup__note">未配置文件夹</p>
                <div v-else class="setup__rows">
                    <div class="setup__row">
                        <span class="setup__key">名称</span>
                        <span class="setup__value">{{ status.folder.name }}</span>
                    </div>
                    <div class="setup__row">
                        <span class="setup__key">路径</span>
                        <span class="setup__value setup__value--path">{{
                            status.folder.path
                        }}</span>
                    </div>
                    <div class="setup__row">
                        <span class="setup__key">实例</span>
                        <span class="setup__value">
                            {{ status.folder.instanceCount }}
                            <template v-if="status.folder.selectedInstance">
                                · 选中 {{ status.folder.selectedInstance }}
                            </template>
                        </span>
                    </div>
                    <div class="setup__row">
                        <span class="setup__key">状态</span>
                        <span class="setup__value">
                            {{ status.folder.exists ? '存在' : '不存在' }} ·
                            {{ status.folder.writable ? '可写' : '只读' }}
                        </span>
                    </div>
                </div>
            </CollapsibleGroup>

            <CollapsibleGroup label="下载源">
                <div class="setup__rows">
                    <div class="setup__row">
                        <span class="setup__key">当前</span>
                        <span class="setup__value">{{ status.mirror.source ?? '未设置' }}</span>
                    </div>
                </div>
                <ul class="setup__list">
                    <li
                        v-for="preset in status.mirror.presets"
                        :key="preset.id"
                        class="setup__item"
                    >
                        <span class="setup__item-main">{{ preset.name }}</span>
                        <span class="setup__item-sub">
                            {{ preset.id }}
                            <template v-if="preset.url"> · {{ preset.url }}</template>
                        </span>
                    </li>
                </ul>
            </CollapsibleGroup>

            <CollapsibleGroup label="CLI 能力">
                <p class="setup__note">能力键决定界面元素显隐</p>
                <div class="setup__chips">
                    <span v-for="key in features" :key="key" class="setup__chip">{{ key }}</span>
                </div>
            </CollapsibleGroup>
        </template>
    </main>
</template>

<style scoped lang="scss">
.setup {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;

    max-width: 46rem;
    padding: 1.5rem;
}

.setup__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
}

.setup__title {
    margin: 0;

    font-size: var(--font-size-3xl);
}

.setup__failure {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;

    margin: 0;
    padding: 0.6rem 0.75rem;

    color: var(--text-color);
    font-size: var(--font-size-sm);

    background-color: color-mix(in srgb, #c62828 18%, transparent);
    border: 1px solid color-mix(in srgb, #c62828 45%, transparent);
    border-radius: var(--border-radius);
}

.setup__failure-code {
    font-weight: 600;
}

.setup__failure-detail {
    color: var(--text-color-dark);
    word-break: break-all;
}

.setup__rows {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.setup__row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;

    font-size: var(--font-size-sm);
}

.setup__key {
    flex: 0 0 5rem;

    color: var(--text-color-dark);
}

.setup__value {
    flex: 1;

    word-break: break-all;
}

.setup__value--path {
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);
}

.setup__note {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-sm);
}

.setup__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.setup__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

.setup__item {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;

    padding: 0.35rem 0.5rem;

    font-size: var(--font-size-sm);

    background-color: color-mix(in srgb, var(--text-color) 5%, transparent);
    border-radius: var(--border-radius);
}

.setup__item--off {
    opacity: 0.55;
}

.setup__item-main {
    font-weight: 500;
}

.setup__item-sub {
    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
    word-break: break-all;
}

.setup__tag {
    padding: 0 0.4rem;

    font-size: var(--font-size-xs);

    background-color: var(--button-bg-color);
    border-radius: calc(var(--border-radius) / 2);
}

.setup__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
}

.setup__chip {
    padding: 0.15rem 0.5rem;

    font-family: ui-monospace, monospace;
    font-size: var(--font-size-xs);

    background-color: var(--button-bg-color);
    border-radius: calc(var(--border-radius) / 2);
}
</style>
