<script setup lang="ts">
import { PhFolderOpen } from '@phosphor-icons/vue'
import { open as openDirectory } from '@tauri-apps/plugin-dialog'
import GroupButton from '@/components/GroupButton.vue'
import GroupInput from '@/components/GroupInput.vue'
import { notifyError } from '@/utils/notify'

const props = withDefaults(
    defineProps<{
        label?: string
        placeholder?: string
        disabled?: boolean
        /** 目录选择框的标题，也用作按钮的 title / aria-label */
        title?: string
    }>(),
    {
        label: '',
        placeholder: '',
        disabled: false,
        title: '浏览文件夹',
    },
)

const model = defineModel<string>({ default: '' })

/** 弹出系统自带的目录选择框，选好就把路径写进输入框 */
async function browse(): Promise<void> {
    if (props.disabled) {
        return
    }
    try {
        const picked = await openDirectory({
            directory: true,
            multiple: false,
            title: props.title,
        })
        if (typeof picked === 'string') {
            model.value = picked
        }
    } catch (error) {
        notifyError(`打开目录选择框失败：${String(error)}`)
    }
}
</script>

<template>
    <div class="folder-picker">
        <span v-if="label" class="folder-picker__label">{{ label }}</span>
        <div class="folder-picker__row">
            <GroupInput
                v-model="model"
                class="folder-picker__field"
                :placeholder="placeholder"
                :disabled="disabled"
            />
            <GroupButton
                class="folder-picker__browse"
                :disabled="disabled"
                :title="title"
                :aria-label="title"
                @click="browse"
            >
                <PhFolderOpen :size="18" weight="regular" aria-hidden="true" />
            </GroupButton>
        </div>
    </div>
</template>

<style scoped lang="scss">
.folder-picker {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

.folder-picker__label {
    color: var(--text-color);
    font-size: var(--font-size-sm);
}

.folder-picker__row {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
}

.folder-picker__field {
    flex: 1;
    min-width: 0;
}

/* GroupButton 自带 align-self: flex-start，这里压回拉伸，好与输入框同高 */
.folder-picker__row .folder-picker__browse {
    align-self: stretch;
    width: 2.75rem;
    padding: 0;
}
</style>
