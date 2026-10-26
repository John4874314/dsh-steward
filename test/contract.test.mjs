/**
 * dsh-steward 的最小自检。
 *
 * 存在的理由：1.2.2 及以前的发布版有个致命回归 —— cordis.patch.yml 里的 name
 * 写的是本地开发用的 `@local/dsh-steward`，而 package.json 的 name 是 `dsh-steward`。
 * 从 tarball / npm 安装的人会直接 ERR_MODULE_NOT_FOUND，插件整块加载失败。
 *
 * 这类错误在本地开发时看不出来（本地恰好装成了 @local/ 作用域），
 * 只能靠一条断言在发布前拦住它。所以第一组测试就是"三个名字必须一致"。
 *
 * 跑法：node --test test/
 * 不依赖 DSH 运行时，纯 Node。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (name) => readFileSync(join(root, name), 'utf8')

const pkg = JSON.parse(read('package.json'))
const patch = read('cordis.patch.yml')
const client = read('client.js')

/** 从 patch 里取 insert 行的 name（单引号或裸写都接受）。只看非注释行。 */
function patchInsertName() {
  const code = patch.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  const m = /- insert:\s*\n(?:.*\n)*?\s+name:\s*'?([^'\n]+)'?/.exec(code)
  assert.ok(m !== null, 'cordis.patch.yml 里找不到 insert 的 name')
  return m[1].trim()
}

/** 从 client.js 里取 __ModuleLoader__ 的 id（允许 load({ 与 id: 之间有注释行）。 */
function clientModuleId() {
  const m = /__ModuleLoader__\.load\(\{[\s\S]{0,600}?\bid:\s*['"]([^'"]+)['"]/.exec(client)
  assert.ok(m !== null, 'client.js 里找不到 __ModuleLoader__ 的 id')
  return m[1]
}

test('三个名字必须一致：package.json / patch insert / client module id', () => {
  const a = pkg.name
  const b = patchInsertName()
  const c = clientModuleId()

  assert.equal(b, a, `cordis.patch.yml 的 name (${b}) 与 package.json 的 name (${a}) 不一致；`
    + ' 从 tarball 安装会 ERR_MODULE_NOT_FOUND')
  assert.equal(c, a, `client.js 的 module id (${c}) 与 package.json 的 name (${a}) 不一致；`
    + ' 设置页与右键菜单都不会出现')
})

test('patch 里不再出现本地开发用的 @local/ 作用域', () => {
  // 只看生效的 YAML 行；注释里提到 @local/ 是在解释这个坑，不算问题
  const code = patch.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  assert.ok(!code.includes('@local/'),
    'cordis.patch.yml 的生效行仍含 @local/：这是本地 link 安装时的名字，发布版必须用真实包名')
})

test('运行守则默认关闭：装插件不应该改写全局 AGENTS.md', () => {
  assert.match(patch, /guardrails:\s*\n\s+install:\s*false/,
    'patch 里 guardrails.install 必须是 false —— 默认往全局 AGENTS.md 写内容属于越权')

  const idx = read('index.js')
  // Schema 默认值与运行时兜底都必须是否定的，缺一个都会漏
  assert.match(idx, /install:\s*Schema\.boolean\(\)\.default\(false\)/,
    'Config schema 里 guardrails.install 的默认值必须是 false')
  assert.match(idx, /guardrails:\s*\{\s*install:\s*false\s*\}/,
    'DEFAULTS 里 guardrails.install 必须是 false')
})

test('patch 声明的每个文件都真的在包里', () => {
  const files = pkg.files ?? []
  for (const need of ['index.js', 'client.js', 'cordis.patch.yml']) {
    assert.ok(files.includes(need) || files.some((f) => f.startsWith(need)),
      `package.json 的 files 少了 ${need}`)
    assert.ok(existsSync(join(root, need)), `仓库里缺少 ${need}`)
  }
  assert.ok(existsSync(join(root, pkg.dsh.bundle.patch)),
    `dsh.bundle.patch 指向的 ${pkg.dsh.bundle.patch} 不存在`)
})

test('宿主模块能 import 出 apply / inject / name', async () => {
  const mod = await import(new URL('../index.js', import.meta.url).href)
  assert.equal(typeof mod.apply, 'function', 'index.js 必须导出 apply')
  assert.ok(Array.isArray(mod.inject), 'index.js 必须导出 inject 数组')
  assert.equal(typeof mod.name, 'string', 'index.js 必须导出 name')
})

test('client.js 包在 __ModuleLoader__ 里，且 factory 能真正执行', () => {
  let captured = null
  const sandbox = {
    __ModuleLoader__: { load(def) { captured = def } },
  }
  // 只求值到 load() 被调用为止；不真的执行 factory（它需要 React）
  const fn = new Function('window', 'require', client)
  fn(sandbox, () => { throw new Error('不该在顶层 require') })

  assert.ok(captured !== null, 'client.js 没有调用 __ModuleLoader__.load')
  assert.equal(typeof captured.factory, 'function', 'load 的 factory 必须是函数')

  // 真跑一次 factory，用最小 React 替身，确认没有语法/引用错误
  const React = {
    createElement: (...args) => ({ args }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useCallback: (f) => f,
    useRef: (v) => ({ current: v }),
    useMemo: (f) => f(),
  }
  const out = captured.factory((id) => {
    if (id === 'react') return React
    throw new Error(`意外的 require: ${id}`)
  })
  assert.equal(typeof out.apply, 'function', 'client factory 必须返回 apply')
})

/*
 * 下面三条针对的是 1.3.0 → 1.3.1 的真实故障：
 *
 * 1.3.0 把 patch 和 client 的 id 改成了 dsh-steward，但本地 package.json 的 name
 * 还是 @local/dsh-steward。DSH 的 assertPackageOwned 会从 icon 的真实路径向上找
 * 一个 name 等于包名的 package.json，先找到的那个是 @local/... → 直接抛
 *   "icon must remain inside its package directory"
 * 整个插件被标记为「已关闭」。本地能跑、发布坏，反过来发布修好了本地又坏。
 *
 * 所以：包身份只有一个，任何一处不一致都要在发布前拦住。
 */

test('exports 必须导出 ./package.json（DSH 与工具链都靠它读清单）', () => {
  assert.equal(pkg.exports?.['./package.json'], './package.json',
    'exports 缺 "./package.json"：解析 <包名>/package.json 会 ERR_PACKAGE_PATH_NOT_EXPORTED')
  assert.equal(pkg.exports?.['./icon'], './icon.svg',
    'exports 缺 "./icon"：插件图标解析不到')
  assert.equal(pkg.exports?.['./client'], './client.js',
    'exports 缺 "./client"：浏览器半侧加载不到')
})

test('包名是裸名，不带 @scope/', () => {
  assert.ok(!pkg.name.startsWith('@'),
    `package.json 的 name 是 ${pkg.name}：本地开发用 @local/ 别名会让 icon 所有权校验失败`)
})

test('icon 满足 DSH 的元信息约束（类型 / 大小 / 在包内）', () => {
  const iconPath = join(root, 'icon.svg')
  assert.ok(existsSync(iconPath), 'icon.svg 不存在')

  const media = { '.svg': true, '.png': true, '.jpg': true, '.jpeg': true, '.webp': true }
  assert.ok(media[extname(iconPath).toLowerCase()] === true,
    'icon 只支持 svg / png / jpg / jpeg / webp')

  const size = statSync(iconPath).size
  assert.ok(size <= 256 * 1024, `icon 超过 256 KiB（当前 ${size} B）`)
})

