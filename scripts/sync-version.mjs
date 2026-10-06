// 由 npm 的 version 生命周期调用，把新版本号同步到另外两处
// 发版入口：pnpm version <版本> --no-git-tag-version
import { readFileSync, writeFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version

const confPath = 'src-tauri/tauri.conf.json'
const conf = readFileSync(confPath, 'utf8')
// 只认顶层键（4 空格缩进），嵌套的 version 不动
const topLevelVersion = /^(\s{4}"version"\s*:\s*")[^"]*(")/m
writeFileSync(confPath, conf.replace(topLevelVersion, `$1${version}$2`))

// Cargo.toml 只改 [package] 段那一行，[dependencies] 里的同名键不动
const cargoPath = 'src-tauri/Cargo.toml'
const cargo = readFileSync(cargoPath, 'utf8')
const head = cargo.indexOf('[package]')
const end = cargo.indexOf('\n[', head + 1)
const scope = end === -1 ? cargo.length : end
const packageSection = cargo.slice(0, scope)
writeFileSync(
    cargoPath,
    packageSection.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`) +
        cargo.slice(scope),
)

console.log(`版本同步：package.json / tauri.conf.json / Cargo.toml → ${version}`)
