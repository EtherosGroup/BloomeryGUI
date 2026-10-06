/*
 * 错误信封回归：真字节 → 解析 → 文案 → 是否带「可重试」
 *
 * 夹具来源（scripts/fixtures/）
 *   error-envelope-download-failed.json  真实 CLI 产出：mirror use custom --url http://127.0.0.1:1
 *                                        然后 install 1.20.6 --loader fabric，抓 stdout
 *   error-envelope-usage-error.json      真实 CLI 产出：version show，抓 stdout
 *   error-envelope-unknown-code.json     手工构造，形状同真实信封，用于验证未知码回落
 *
 * 夹具目录可用 FX_DIR 覆盖，便于做反向验证
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { errorSummary } from '../src/api/errorMessages.ts'

const dir = process.env.FX_DIR ?? join(import.meta.dirname, 'fixtures')

/** 从多行 stdout 里取第一个 JSON 文档 */
function envelopeOf(name) {
    const raw = readFileSync(join(dir, name), 'utf8')
    const start = raw.indexOf('{')
    return JSON.parse(raw.slice(start, raw.lastIndexOf('}') + 1))
}

const cases = [
    {
        file: 'error-envelope-download-failed.json',
        code: 'DownloadFailed',
        retryable: true,
        expect: '下载失败 · 可重试',
    },
    {
        file: 'error-envelope-usage-error.json',
        code: 'UsageError',
        retryable: false,
        expect: '参数不合法',
    },
    {
        file: 'error-envelope-unknown-code.json',
        code: 'SomethingNew',
        retryable: true,
        expect: '新的错误 · 可重试',
    },
]

let failed = 0
for (const item of cases) {
    const envelope = envelopeOf(item.file)
    const error = envelope.error ?? {}
    const text = errorSummary(error.code, error.message, error.retryable)
    const problems = []
    if (error.code !== item.code) {
        problems.push(`code ${error.code} ≠ ${item.code}`)
    }
    if (error.retryable !== item.retryable) {
        problems.push(`retryable ${error.retryable} ≠ ${item.retryable}`)
    }
    if (text !== item.expect) {
        problems.push(`文案「${text}」≠「${item.expect}」`)
    }
    if (problems.length > 0) {
        failed += 1
        console.log(`失败 ${item.file}：${problems.join('；')}`)
    } else {
        console.log(`通过 ${item.file} → ${text}`)
    }
}

console.log(failed === 0 ? `${cases.length} 项通过` : `${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
