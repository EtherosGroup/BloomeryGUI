/*
 * 启动阶段回归：续期那一步是否列出、每一步的说明
 *
 * 微软凭据过期时 CLI 会先联网续期，那一步没有任何进度事件，
 * 界面靠 launchSteps 与 launchPhaseHint 说明阶段，判据错了界面会指错动作
 */
import {
    credentialsExpired,
    launchPhaseHint,
    launchSteps,
    planNeedsRefresh,
} from '../src/utils/launchPhase.ts'

const cases = [
    {
        name: '微软账户凭据过期',
        account: { type: 'microsoft', status: '凭据过期' },
        expired: true,
    },
    {
        name: '微软账户凭据可用',
        account: { type: 'microsoft', status: '可用' },
        expired: false,
    },
    {
        name: '微软账户还需要登录',
        account: { type: 'microsoft', status: '需要登录' },
        expired: false,
    },
    {
        name: '离线账户不受影响',
        account: { type: 'offline', status: '可用' },
        expired: false,
    },
    { name: '没有账户', account: null, expired: false },
]

let failed = 0
function check(name, problems) {
    if (problems.length > 0) {
        failed += 1
        console.log(`失败 ${name}：${problems.join('；')}`)
        return
    }
    console.log(`通过 ${name}`)
}

for (const item of cases) {
    const actual = credentialsExpired(item.account)
    check(
        `凭据判断 · ${item.name}`,
        actual === item.expired ? [] : [`${String(actual)} ≠ ${String(item.expired)}`],
    )
}

// 计划里的 needsRefresh 是权威判据，缺失时要给 null 让调用方退回账户状态
const planCases = [
    { name: '计划说待续期', account: { needsRefresh: true }, expect: true },
    { name: '计划说不用续期', account: { needsRefresh: false }, expect: false },
    { name: '旧引擎没有这个字段', account: { name: 'Alex' }, expect: null },
    { name: '计划里没有账户', account: null, expect: null },
]
for (const item of planCases) {
    const actual = planNeedsRefresh(item.account)
    check(
        `计划判据 · ${item.name}`,
        actual === item.expect ? [] : [`${String(actual)} ≠ ${String(item.expect)}`],
    )
}

// 步骤表：续期那一步位于检查文件与补全文件之间，顺序决定界面指哪一步
const withCredentials = launchSteps(true).map((step) => step.key)
const without = launchSteps(false).map((step) => step.key)
check(
    '凭据过期时列五步',
    withCredentials.join(',') === 'verify,credentials,repair,spawn,window'
        ? []
        : [withCredentials.join(',')],
)
check(
    '凭据可用时不列续期',
    without.join(',') === 'verify,repair,spawn,window' ? [] : [without.join(',')],
)
check(
    '步骤初始都是 pending',
    launchSteps(true).every((step) => step.state === 'pending') ? [] : ['有步骤不是 pending'],
)

const credentialsHint = launchPhaseHint('credentials')
check(
    '续期那一步要说明在等微软',
    credentialsHint.includes('微软') && credentialsHint.length > 0 ? [] : [credentialsHint],
)
check('没有当前步骤时不给提示', launchPhaseHint(null) === '' ? [] : [launchPhaseHint(null)])
check('补全文件那一步有说明', launchPhaseHint('repair').length > 0 ? [] : ['空'])
check('等待窗口那一步有说明', launchPhaseHint('window').length > 0 ? [] : ['空'])

console.log(failed === 0 ? '全部通过' : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
