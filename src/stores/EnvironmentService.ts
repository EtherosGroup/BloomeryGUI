import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 旧版自动生成的数据目录后缀 */
const LEGACY_HOME_SUFFIX = 'cli-home'

/** CLI 定位与数据目录设置 */
export const useEnvironmentService = defineStore(
    'EnvironmentService',
    () => {
        /** 手填 CLI 路径，空串走默认解析 */
        const cliPath = ref('')
        /** CLI 数据目录，空串时用 CLI 默认目录 */
        const home = ref('')

        /**
         * 清理旧版写入的默认目录：早期版本把应用数据目录下的 cli-home 存进了持久化设置，
         * 它指向一个 CLI 从未使用过的目录，会让账户与文件夹全部读成空
         */
        function dropLegacyHome(): void {
            if (home.value.endsWith(LEGACY_HOME_SUFFIX)) {
                home.value = ''
            }
        }

        return {
            cliPath,
            home,
            dropLegacyHome,
        }
    },
    {
        persist: true,
    },
)
