<script setup lang="ts">
import { computed } from 'vue'
import type { CliProgressEvent } from '@/api/types'
import { laneCountText, percentText } from '@/utils/progressText'

/**
 * 下载进度按通道分行
 *
 * 同一通道只留最新一条，行数因此固定，进度不会因为事件流而增减
 * 未知 key 归到 stage，CLI 加新通道时界面照常显示
 */
const props = withDefaults(
    defineProps<{
        events: CliProgressEvent[]
        /** 还没有任何事件时的占位文案 */
        waiting?: string
    }>(),
    {
        waiting: '',
    },
)

const lanes = computed(() => {
    const rows = new Map<string, { label: string; done: number; total: number; bytes: boolean }>()
    for (const event of props.events) {
        rows.set(event.key ?? event.stage, {
            label: event.stage,
            done: event.done,
            total: event.total,
            bytes: event.bytes,
        })
    }
    return [...rows.values()]
})
</script>

<template>
    <ul v-if="lanes.length > 0" class="lanes">
        <li v-for="lane in lanes" :key="lane.label" class="lanes__row">
            <span class="lanes__label">{{ lane.label }}</span>
            <span class="lanes__track">
                <span class="lanes__bar" :style="{ width: percentText(lane) }"></span>
            </span>
            <span class="lanes__count">{{ laneCountText(lane) }}</span>
        </li>
    </ul>
    <p v-else-if="waiting.length > 0" class="lanes__waiting">{{ waiting }}</p>
</template>

<style scoped lang="scss">
.lanes {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;

    margin: 0;
    padding: 0;

    list-style: none;
}

/* 行高固定：计数文字变化不改行高 */
.lanes__row {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    min-height: 1.1rem;

    font-size: var(--font-size-xs);
}

.lanes__label {
    flex: 0 0 5rem;

    overflow: hidden;

    text-overflow: ellipsis;
    white-space: nowrap;
}

.lanes__track {
    flex: 1;
    height: 0.4rem;

    overflow: hidden;

    background-color: color-mix(in srgb, var(--text-color) 8%, var(--group-content-bg));
    border-radius: calc(var(--border-radius) / 2);
}

.lanes__bar {
    display: block;
    height: 100%;

    background-color: var(--text-color);

    transition: width var(--transition-duration) var(--transition-ease);
}

/*
 * 计数列定最小宽度且禁止换行
 *
 * 文字随下载进度变长，若按内容撑开就会把进度槽挤窄、进度条跟着伸缩；
 * 定宽之后条长不动，80.0 MB/100.0 MB 这类文字也始终在一行内
 */
.lanes__count {
    flex: 0 0 auto;

    min-width: 9rem;

    font-family: ui-monospace, monospace;
    text-align: right;
    white-space: nowrap;
}

.lanes__waiting {
    margin: 0;

    color: var(--text-color-dark);
    font-size: var(--font-size-xs);
}
</style>
