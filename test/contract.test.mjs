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

/*
 * 仓库 README 与「插件目录里的 README」是两份不同用途的文档：
 *   - 仓库那份是 GitHub 落地页：平台矩阵、信任说明、更新日志、安装命令
 *   - 插件目录那份是"装好之后怎么用"的简版
 * 我曾经两次把后者整个复制到前者上，把落地页冲掉了。这条断言就是防这个。
 */
test('手动重启：命令与菜单都在，且重载不阻塞在 handler 里', () => {
  const host = read('index.js')

  // 宿主：命令注册与三个分支
  assert.ok(host.includes("name: 'chat-restart'"), 'index.js 没有注册 /chat-restart')
  for (const branch of ["action === 'reload'", "action === 'quit'", "action === 'last'"]) {
    assert.ok(host.includes(branch), `index.js 缺少 ${branch} 分支`)
  }

  // 关键回归点：reconcileProfile 会把本插件模块逐出，
  // 所以它**不能**被 await 在命令 handler 里 —— 那样命令永远不回话。
  // 断言真正的调用（`hmr.reconcileProfile()`，注释里提到的裸 `reconcileProfile()` 不算）
  // 出现在 setTimeout 之后，即被甩出了 handler。
  const reloadBlock = host.slice(host.indexOf("action === 'reload'"))
  const setTimeoutAt = reloadBlock.indexOf('setTimeout(')
  const reconcileAt = reloadBlock.indexOf('hmr.reconcileProfile()')
  assert.ok(setTimeoutAt > 0, 'reload 分支里找不到 setTimeout：重载没有被甩出 handler')
  assert.ok(reconcileAt > 0, 'reload 分支里找不到 hmr.reconcileProfile() 调用')
  assert.ok(reconcileAt > setTimeoutAt,
    'hmr.reconcileProfile() 出现在 setTimeout 之前：会在 handler 里 await，导致命令不回话')

  // 必须包在 runExclusive 里，否则 reconcileProfile 直接抛
  assert.ok(host.includes('runExclusive('), 'index.js 没有用 hmr.runExclusive 包住 reconcileProfile')

  // 客户端：菜单与二次确认
  assert.ok(client.includes("id: 'dsh-steward-restart'"), 'client.js 没有注册重启菜单')
  assert.ok(client.includes("'/chat-restart reload'"), 'client.js 没有调用 reload')
  assert.ok(client.includes("'/chat-restart quit'"), 'client.js 没有调用 quit')
  assert.ok(client.includes('restartQuitConfirm'), 'client.js 缺少完全重启的二次确认文案')

  // 原有的五个注册一个都不能少（这条防的是"加功能时把别的挤掉"）
  for (const id of [
    'dsh-steward-settings',
    'dsh-steward-delete',
    'dsh-steward-open-folder',
    'dsh-steward-dialog',
    'dsh-steward-file-menu',
  ]) {
    assert.ok(client.includes(`id: '${id}'`), `client.js 原有的 ${id} 不见了`)
  }
})

/*
 * 这一条记录的是「完全重启」这条路的完整失败史，防止以后有人再走回去：
 *
 * ① process.kill(SIGTERM) —— Windows 上是强杀，退出码 1，
 *    主进程 `child.once("close")` 看到非 0 立刻 fail()，弹「应用意外停止」。
 * ② process.exit(0) —— 一样弹：压住弹窗的 stopping 标志只有主进程自己能改。
 * ③ 起游离 powershell「杀进程 + 重新拉起」—— **做不到**。
 *    宿主活在 DSH 的 Windows Job Object 里（asar 有
 *    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE），detached 也逃不出 Job：
 *    父进程一死脚本被一起回收，于是「还没杀进程就已经死了」。
 *    实测现象就是：界面显示「正在重启」，DSH 纹丝不动。
 *
 * 结论：插件层面做不成真重启，所以现在只做**诚实的关闭窗口**
 * （window.close() → 主进程隐藏到托盘），文案也如实说明。
 */
test('关闭窗口：插件不自杀、不假装能自动重启，文案必须诚实', () => {
  const host = read('index.js')

  // 去掉注释行后再检查，避免注释里提到这些名字就误报
  const codeOnly = host
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n')
  assert.ok(!/process\.kill\s*\(/.test(codeOnly),
    'index.js 里出现了 process.kill：Windows 上是强杀，会触发桌面版崩溃弹窗')
  assert.ok(!/process\.exit\s*\(/.test(codeOnly),
    'index.js 里出现了 process.exit：主进程会当成异常退出并弹崩溃框')

  // 不许再假装能自动重启
  assert.ok(!host.includes("method: 'relaunch'"),
    'index.js 又出现了 relaunch：Job Object 会带走子进程，这条路走不通')
  assert.ok(!/spawn\('powershell\.exe'/.test(host),
    'index.js 又起了 powershell 重启脚本：它活不过宿主')

  // 宿主只回报，动作在客户端
  assert.ok(host.includes("method: 'manual'"), 'quit 分支应回报 manual（交给用户决定何时重开）')

  // 客户端走 window.close()（= 隐藏到托盘，不弹崩溃框）
  const clientCode = client
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join('\n')
  assert.ok(/window\.close\s*\(/.test(clientCode),
    'client.js 没有 window.close()：这是唯一不弹崩溃框的关闭路径')
  assert.ok(client.includes('/chat-restart quit'), 'client.js 没有调用 quit')

  // 文案不能承诺「自动重新打开」
  assert.ok(!client.includes('自动重新打开'),
    '文案承诺了自动重新打开：做不到就别这么写')
  assert.ok(!/reopen it automatically/i.test(client),
    'the copy promises an automatic reopen that does not happen')

  /*
   * 按钮名不许再叫「重启」。
   *
   * 1.7.4 把「完全重启」降级成「关闭窗口…」之后，按钮仍写着「重启」，
   * 那是在承诺一件插件做不到的事（见上一条测试记录的失败史）。
   * 现在菜单里既有「重载」也有「关闭窗口」，所以用一个中性名「操作」。
   */
  const menuLabels = [...client.matchAll(/restartMenu: '([^']*)'/g)].map((m) => m[1])
  assert.strictEqual(menuLabels.length, 2, 'restartMenu 应只有中英两份')
  assert.ok(!/重启/.test(menuLabels[0]),
    `菜单按钮仍叫「${menuLabels[0]}」：里面已没有重启功能，名字必须中性`)
  assert.ok(!/restart/i.test(menuLabels[1]),
    `the menu button is still called "${menuLabels[1]}" after the restart feature was removed`)
})

/*
 * 这一条拦的是另一次事故：按钮只在挂载时量了一次位置，
 * 那时原生菜单栏往往还没挂上，于是退回固定值，正好压在「应用」上；
 * 等菜单栏出现时没有 resize，错位一直留着 —— 表现为「有时候重合，放大窗口才好」。
 */
test('重启按钮的定位必须持续重测，量不到就不渲染', () => {
  assert.ok(client.includes('MutationObserver'),
    '缺少 MutationObserver：菜单栏稍后挂上时不会重量')
  assert.ok(/for \(let i = 0; i < 8; i \+= 1\)/.test(client),
    '缺少挂载后的连续重量：菜单栏比本组件晚出现时会错位')
  assert.ok(client.includes('if (anchor.visible !== true) return null'),
    '量不到菜单栏时仍在渲染：会猜一个位置压在原生菜单上')
  assert.ok(client.includes('visible: false'), '初始状态应不可见')
})

test('仓库 README 仍是 GitHub 落地页，没被插件内部的简版覆盖', () => {
  const zh = read('README.md')
  const en = read('README.en.md')

  for (const [name, text, markers] of [
    ['README.md', zh, ['## 平台支持', '## 更新日志', 'refs/tags/v', '顺便说一句', '## 关于信任']],
    ['README.en.md', en, ['## Platform support', '## Changelog', 'refs/tags/v', '## On trust']],
  ]) {
    for (const m of markers) {
      if (m === '顺便说一句') continue
      assert.ok(text.includes(m), `${name} 缺少「${m}」：可能被插件目录里的简版 README 覆盖了`)
    }
  }

  // 更新日志的第一条必须是最新版本，否则发版时忘了写
  const firstHeading = /^### (\d+\.\d+\.\d+)/m.exec(zh)
  assert.ok(firstHeading !== null, 'README.md 的更新日志里找不到版本标题')
  assert.equal(firstHeading[1], pkg.version,
    `README.md 更新日志首条是 ${firstHeading[1]}，但 package.json 是 ${pkg.version}`)

  // 安装命令必须指向当前版本
  assert.ok(!zh.includes('refs/tags/v1.2.0') && !en.includes('refs/tags/v1.2.0'),
    'README 的安装命令还指向旧 tag v1.2.0')
  assert.ok(zh.includes(`refs/tags/v${pkg.version}`),
    `README.md 的安装命令没有指向 v${pkg.version}`)
  assert.ok(en.includes(`refs/tags/v${pkg.version}`),
    `README.en.md 的安装命令没有指向 v${pkg.version}`)
})


