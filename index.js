/**
 * chat-manager (Host half)
 *
 * 两件事：
 *  1. 每个新对话在自己的工作区目录下建一个独立文件夹（默认关闭，可在 DSH 设置里打开）。
 *  2. 提供 /chat-delete 命令，供客户端「删除对话」使用：归档会话、可选删除会话日志、
 *     可选删除该对话的文件夹。
 *
 * 客户端通过 ctx.remote.commands.execute(agent, '/chat-delete ...', [], signal) 调用，
 * 这样删除这类破坏性操作只有一份实现，UI 与命令不会各写一套。
 */

import {
  mkdir, rm, stat, readdir, readFile, writeFile, copyFile, cp, rename, unlink,
} from 'node:fs/promises'
import { join, resolve, sep, dirname, basename } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

/**
 * 尽力拿到 schemastery。
 *
 * 不用静态 `import`：那是加载期的硬失败 —— 一旦 harness 升级、profile 重建、
 * 或者这个链接被清掉，整个插件模块都会导入失败（插件虽不会拖垮 harness，
 * 但会永久不可用，而且报错发生在最早期，很难看出原因）。
 * 这里改成运行时尝试，拿不到就退化成"没有 Config 表单"，其余功能照常。
 */
const Schema = await (async () => {
  /**
   * 依次尝试各个来源，**逐个 await**。
   *
   * 不能先把两个 import() 都创建出来再 Promise.all —— 那会让 schemastery 的
   * CJS 入口（它 require 了 ESM 的 cosmokit）和另一个 import 同时进行，
   * 触发 ERR_REQUIRE_ESM_RACE_CONDITION。串行就没这个问题。
   */
  const sources = []

  // 1) 直接按包名解析（插件自己 node_modules 里有链接时走这条）
  sources.push(() => import('@deepseek-ai/schemastery'))

  // 2) 从宿主 profile 解析。resolve() 给的是 Windows 路径，
  //    ESM 的 import() 只吃 URL，直接传路径会抛 ERR_UNSUPPORTED_ESM_URL_SCHEME。
  sources.push(() => {
    const requireFromProfile = createRequire(join(process.env.DSH_PROFILE_DIR ?? '.', 'package.json'))
    return import(pathToFileURL(requireFromProfile.resolve('@deepseek-ai/schemastery')).href)
  })

  for (const load of sources) {
    try {
      const mod = await load()
      const schema = mod?.default ?? mod
      if (typeof schema?.object === 'function') return schema
    } catch {
      // 换下一个来源
    }
  }
  return undefined
})()

export const name = 'dsh-steward'

/**
 * 宿主 Context 也是受限代理：凡是要 ctx.xxx 访问的服务都得在这里声明，
 * 否则调用时直接抛 "cannot get property ... without inject"。
 *
 * 只放必需项：commands 与 workspaceRegistry（读/改目录、切工作目录都是可选的，
 * 用 ctx.get 弱取，缺失时优雅降级，不让整个插件卡在等待依赖上）。
 */
export const inject = [
  'commands',           // 注册 /chat-* 命令
  'workspaceRegistry',  // 归档会话
]

/**
 * 声明 Config，DSH 设置页才会为这个插件生成可编辑的表单。
 *
 * `.volatile()` 是关键：settings 服务只把 volatile 字段投影成表单、并允许写回，
 * 普通字段只读也不出现在表单里。改这个开关不需要重挂插件，所以正合适。
 *
 * 拿不到 schemastery 时不导出 Config（而不是导出一个坏对象）：
 * 插件会失去设置页表单，但目录开关仍然读 json 配置、命令仍然可用。
 */
export const Config = Schema === undefined
  ? undefined
  : Schema.object({
    folder: Schema.object({
      enabled: Schema.boolean().default(false)
        .description('每个新对话在工作区里自动创建一个独立文件夹'),
      trigger: Schema.union(['first-message', 'created']).default('first-message')
        .description('first-message：发出第一条消息时创建；created：会话一创建就创建'),
      template: Schema.string().default('chat-{date}-{time}')
        .description('文件夹名模板，支持 {date} {time} {datetime} {id} {title}'),
      useAsWorkingDirectory: Schema.boolean().default(false)
        .description('同时把该会话的工作目录切到新建的文件夹'),
    }).description('对话文件夹').volatile(),
    guardrails: Schema.object({
      install: Schema.boolean().default(true)
        .description('把「运行三原则」写进 /AGENTS.md（对所有工作区生效）'),
    }).description('运行守则').volatile(),
  })

const DEFAULTS = {
  guardrails: { install: true },
  folder: {
    enabled: false,
    trigger: 'first-message',
    template: 'chat-{date}-{time}',
    useAsWorkingDirectory: false,
  },
}

/** volatile 字段运行时是包装对象，取真实值要解包。 */
function unwrap(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return value
    }
  }
  return value
}

function folderConfig(config) {
  const folder = unwrap(config?.folder)
  return { ...DEFAULTS.folder, ...(folder ?? {}) }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function stamp(date) {
  const d = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  return { date: `${d}${m}${day}`, time: `${hh}${mm}${ss}`, datetime: `${d}${m}${day}-${hh}${mm}${ss}` }
}

/** 目录名里不能出现的字符统一换成 -，避免建出非法文件夹。 */
function sanitize(name) {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80)
  return cleaned || 'chat'
}

function folderName(template, sessionId, title, now) {
  const parts = stamp(now)
  const rendered = String(template ?? DEFAULTS.folder.template)
    .replace(/\{datetime\}/g, parts.datetime)
    .replace(/\{date\}/g, parts.date)
    .replace(/\{time\}/g, parts.time)
    .replace(/\{id\}/g, String(sessionId).slice(0, 8))
    .replace(/\{title\}/g, title ?? '')
  return sanitize(rendered)
}

/** 会话日志根目录：$DSH_HOME/sessions。找不到就返回 undefined，调用方跳过。 */
function sessionsRoot() {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return undefined
  return join(home, 'sessions')
}

/**
 * 精确找到某个会话的日志目录。
 *
 * 目录名形如 "$DSH_HOME/sessions/<cwd转义>/session-<uuid>"。
 * 注意 SessionId 本身**已经带 `session-` 前缀**（DSH_SESSION_ID 就是
 * "session-86b1641f-…"），所以不能再无条件拼接，否则会拼成
 * "session-session-…" 而永远找不到 —— 那会让删除静默退化成只归档。
 */
function logDirName(sessionId) {
  const id = String(sessionId)
  return id.startsWith('session-') ? id : `session-${id}`
}

async function findSessionLogDir(sessionId) {
  const root = sessionsRoot()
  if (root === undefined) return undefined
  const target = logDirName(sessionId)

  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return undefined
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const direct = join(root, entry.name)
    if (entry.name === target) return direct

    // 一级子目录（按工作区分组）里再找一次
    let children
    try {
      children = await readdir(direct, { withFileTypes: true })
    } catch {
      continue
    }
    for (const child of children) {
      if (child.isDirectory() && child.name === target) return join(direct, child.name)
    }
  }
  return undefined
}

/** 会话 id → 文件夹路径的持久登记表，重启后仍能定位到对话文件夹。 */
function registryPath() {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return undefined
  return join(home, 'chat-manager-folders.json')
}

async function loadRegistry() {
  const file = registryPath()
  if (file === undefined) return new Map()
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      return new Map(Object.entries(parsed).filter(([, value]) => typeof value === 'string'))
    }
  } catch {
    // 文件不存在或损坏，从空表开始
  }
  return new Map()
}

async function saveRegistry(map) {
  const file = registryPath()
  if (file === undefined) return
  try {
    await writeFile(file, JSON.stringify(Object.fromEntries(map), null, 2), 'utf8')
  } catch (error) {
    ctxWarn(`dsh-steward: 无法保存文件夹登记表: ${error?.message ?? error}`)
  }
}

function ctxWarn(message) {
  process.stderr.write(`${message}\n`)
}

/* ================================================================== */
/* 回收站：删除先进这里，可恢复                                         */
/* ================================================================== */

/**
 * 回收站根目录。
 *
 * 为什么放在 $DSH_HOME 而不是工作区：工作区里的东西属于用户任务产物，
 * 插件自己的临时数据不该混进去。$DSH_HOME/trash 和 $DSH_HOME/sessions
 * 在同一个卷上，移动会话日志目录可以用 rename（O(1)，不复制字节）。
 */
function trashRoot() {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return undefined
  return join(home, 'trash')
}

function newTrashId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

/**
 * 移动一个路径，跨卷时退化成"复制 + 删源"。
 *
 * rename 只在同一卷内成立。会话日志一定和 trash 同卷（都在 $DSH_HOME 下），
 * 但对话文件夹在用户工作区，可能是另一个盘，所以必须有兜底。
 */
async function movePath(from, to) {
  try {
    await rename(from, to)
    return 'moved'
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
    await cp(from, to, { recursive: true, force: true })
    await rm(from, { recursive: true, force: true })
    return 'copied'
  }
}

/** 递归统计一个目录的字节数与文件数；不存在返回 {bytes:0, files:0}。 */
async function measure(dir) {
  const result = { bytes: 0, files: 0 }
  async function walk(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(path)
        result.bytes += info.size
        result.files += 1
      } catch {
        // 统计不上就跳过，不让体检因为一个坏文件失败
      }
    }
  }
  await walk(dir)
  return result
}

/** 读一条回收站记录；损坏或缺失返回 undefined。 */
async function readTrashEntry(dir) {
  try {
    const raw = await readFile(join(dir, 'meta.json'), 'utf8')
    const meta = JSON.parse(raw)
    if (meta === null || typeof meta !== 'object') return undefined
    return meta
  } catch {
    return undefined
  }
}

/** 列出回收站全部条目，按删除时间倒序（最新在前）。 */
async function listTrash() {
  const root = trashRoot()
  if (root === undefined) return []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const items = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const meta = await readTrashEntry(dir)
    if (meta === undefined) continue
    const size = await measure(dir)
    items.push({ ...meta, dir, bytes: size.bytes, files: size.files })
  }
  items.sort((a, b) => Number(b.deletedAt ?? 0) - Number(a.deletedAt ?? 0))
  return items
}

/* ================================================================== */
/* 备份目录：用户自己决定留还是删                                        */
/* ================================================================== */

function backupRoot() {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return undefined
  return join(home, 'backups')
}

/** 备份目录的占用情况：条目数、总字节、最早/最新时间。 */
async function backupInfo() {
  const root = backupRoot()
  if (root === undefined) return { dir: '', exists: false, entries: 0, bytes: 0, oldest: null, newest: null }
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { dir: root, exists: false, entries: 0, bytes: 0, oldest: null, newest: null }
  }
  const size = await measure(root)
  let oldest = null
  let newest = null
  for (const entry of entries) {
    try {
      const info = await stat(join(root, entry.name))
      const time = info.mtimeMs
      if (oldest === null || time < oldest) oldest = time
      if (newest === null || time > newest) newest = time
    } catch {
      // 单个条目读不到不影响汇总
    }
  }
  return {
    dir: root,
    exists: true,
    entries: entries.length,
    bytes: size.bytes,
    files: size.files,
    oldest,
    newest,
  }
}

/** 打开一个目录（资源管理器）。宿主侧用 explorer，其它平台用系统默认打开器。 */
function openDirectory(path) {
  const platform = process.platform
  const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
  try {
    const child = spawn(command, [path], { detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

/** 插件自己的配置持久化文件（放在 $DSH_HOME，和会话记录分开）。 */
function configPath() {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return undefined
  return join(home, 'chat-manager-config.json')
}

async function readConfigFile() {
  const file = configPath()
  if (file === undefined) return {}
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeConfigFile(next) {
  const file = configPath()
  if (file === undefined) return
  try {
    await writeFile(file, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    ctxWarn(`dsh-steward: 无法保存配置: ${error?.message ?? error}`)
  }
}

export function apply(ctx, config) {
  // 运行守则：无论后面发生什么，先尝试把三原则写进全局 AGENTS.md。
  // 内部全部 try/catch，失败只会让守则不生效，不会影响插件其余功能。
  try {
    void (async () => {
      // 等用户设置加载完再决定，避免和文件里的开关打架
      const saved = await readConfigFile().catch(() => ({}))
      const flag = (saved.guardrails ?? {}).install
      const enabled = flag === undefined ? (config?.guardrails?.install !== false) : flag === true
      await installGuardrails(enabled)
    })().catch(() => {})
  } catch {
    // 忽略
  }

  const folder = folderConfig(config)
  const created = new Set()
  /** 会话 id → 本插件为它建好的绝对路径，删除对话时据此定位，避免猜测。 */
  const createdFolders = new Map()
  /** 设置页写入的覆盖值（文件里的），异步载入。 */
  let savedFolder = undefined
  let savedGuardrails = undefined

  // 异步载入持久登记表与用户设置；载入完成前的删除请求会走显式路径
  /**
   * 登记表就绪信号。
   *
   * 必须在 ensureFolder 里 await 它：loadRegistry 是异步的，而 session/created
   * 和第一条 user/message 可能早于它完成。不等待的话，ensureFolder 看到空表
   * 就会为已有会话再建一个目录 —— 又是一次重复。
   */
  const registryReady = loadRegistry().then((saved) => {
    for (const [id, path] of saved) {
      if (!createdFolders.has(id)) createdFolders.set(id, path)
    }
  }).catch(() => {})
  void registryReady
  void readConfigFile().then((saved) => {
    if (saved !== null && typeof saved === 'object') {
      if (saved.folder !== undefined) savedFolder = saved.folder
      if (saved.guardrails !== undefined) savedGuardrails = saved.guardrails
    }
  })

  /** 每次现读：设置页改了开关，这里要立刻看到新值，不能用启动时的快照。 */
  function currentFolder() {
    const fromConfig = folderConfig(config)
    // 配置文件优先（用户在设置页打开/关闭过），没有就用 patch/schema 的声明值
    return { ...fromConfig, ...(savedFolder ?? {}) }
  }

  /** 弱取一个宿主服务：未注入时 ctx.xxx 会直接抛错，ctx.get 才是安全的探测方式。 */
  function service(name) {
    try {
      return ctx.get?.(name) ?? undefined
    } catch {
      return undefined
    }
  }

  function baseDirectory(session) {
    try {
      const directory = service('workingDirectory')?.get?.(session)
      if (typeof directory === 'string' && directory.length > 0) return directory
    } catch {
      // 落到持久化 header 上
    }
    return session?.header?.cwd
  }

  /**
   * 为一个**新会话**建它自己的工作文件夹。
   *
   * 语义边界（用户明确要求）：
   *   - 一个「对话」= 侧边栏里的一行 = 一个 Session。
   *   - 同一个 Session 里的多轮消息**不**再建目录。
   *   - 目录建在**该会话自己的工作区目录**下，不是插件安装目录、也不是别的会话的目录。
   *
   * 去重必须跨进程重启有效：早先只用内存 Set 判断「建过了」，插件一重挂
   * （改代码后 disable/enable）Set 就空了，于是同一个会话又建一个新目录 ——
   * 这就是工作区里堆了十几个空 chat-* 目录的原因。
   * 现在以**持久登记表**为准：登记表里有这个 session id，就直接复用那条路径。
   */
  async function ensureFolder(session) {
    const id = session?.id
    if (id === undefined) return
    if (created.has(id)) return

    // 开关关着就什么都不做；监听常驻，打开开关后无需重挂插件即可生效
    const folder = currentFolder()
    if (folder.enabled !== true) return

    const header = session?.header
    // 子代理跟随父会话目录，不单独建
    if (header?.origin === 'subagent' || header?.parentSession !== undefined) return

    // 先查持久登记表：这个会话已经有自己的目录了，就不再建第二个
    await registryReady
    const known = createdFolders.get(id)
    if (known !== undefined && known.length > 0) {
      created.add(id)
      // 目录被人手动删掉时补建回同一路径，而不是另起一个新名字
      try {
        await mkdir(known, { recursive: true })
      } catch (error) {
        ctxWarn(`dsh-steward: 无法补建 ${known}: ${error?.message ?? error}`)
      }
      return
    }

    const base = baseDirectory(session)
    if (typeof base !== 'string' || base.length === 0) return

    let title
    try {
      title = service('sessionTitle')?.get?.(session)?.title
    } catch {
      title = undefined
    }

    const baseResolved = resolve(base)
    const target = resolve(join(baseResolved, folderName(folder.template, id, title, new Date())))
    // 解析后必须仍在工作区内，否则拒绝
    if (target !== baseResolved && !target.startsWith(baseResolved + sep)) return

    // 先占位再 await，避免同一会话的并发事件（created + 第一条消息）各建一个
    created.add(id)

    try {
      await mkdir(target, { recursive: true })
      createdFolders.set(id, target)
      await saveRegistry(createdFolders)
    } catch (error) {
      ctxWarn(`dsh-steward: 无法创建 ${target}: ${error?.message ?? error}`)
      created.delete(id)
      return
    }

    if (folder.useAsWorkingDirectory === true) {
      const agents = service('agents')
      const workingDirectory = service('workingDirectory')
      const agent = agents?.get?.(id)
      if (agent !== undefined && typeof workingDirectory?.set === 'function') {
        try {
          await workingDirectory.set(agent, target)
        } catch (error) {
          ctxWarn(`dsh-steward: 无法切换工作目录: ${error?.message ?? error}`)
        }
      }
    }
  }

  // 两个监听都常驻注册，是否建目录由 ensureFolder 每次现读开关决定，
  // 这样在设置页打开/关闭后立刻生效，不需要重新挂载插件。
  ctx.on('session/created', (session) => {
    if (currentFolder().trigger !== 'created') return
    void ensureFolder(session)
  })

  ctx.on('session/event', (session, event) => {
    if (currentFolder().trigger === 'created') return
    if (event?.type !== 'user/message') return
    void ensureFolder(session)
  })

  /* ------------------------------------------------------------------ */
  /* 二、/chat-delete：删除对话                                          */
  /* ------------------------------------------------------------------ */

  function parseArgs(rawInput) {
    const tokens = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
    const options = { sessionId: undefined, folderPath: undefined, deleteFolder: false, title: undefined }
    for (const token of tokens) {
      if (token === '--with-folder') options.deleteFolder = true
      else if (token.startsWith('--session=')) options.sessionId = token.slice('--session='.length)
      else if (token.startsWith('--folder=')) options.folderPath = token.slice('--folder='.length)
      else if (token.startsWith('--title64=')) {
        try {
          options.title = Buffer.from(token.slice('--title64='.length), 'base64').toString('utf8')
        } catch {
          options.title = undefined
        }
      }
    }
    return options
  }

  /**
   * 确定要删除的对话文件夹。
   *
   * 只接受两个可信来源，绝不猜测：
   *  1. 调用方显式传入的路径（客户端会先给用户看清楚）；
   *  2. 本插件建过的目录 —— 建目录时把 “会话 id → 绝对路径” 记在这张表里。
   *
   * 两者都没有就返回 undefined：宁可不删，也不误删别人的文件夹。
   */
  function resolveChatFolder(sessionId, explicitPath) {
    if (typeof explicitPath === 'string' && explicitPath.length > 0) return resolve(explicitPath)
    const known = createdFolders.get(sessionId)
    return known === undefined ? undefined : resolve(known)
  }

  /**
   * 删除一个对话 —— 进回收站，不直接抹掉。
   *
   * 顺序刻意固定：归档 → 通知界面移除 → **移动**日志目录进回收站
   * → 可选移动对话文件夹进回收站 → 写一条 meta.json。
   *
   * 为什么先移动再写 meta：移动是可能失败的那一步。先写 meta 而移动失败，
   * 回收站里就会留下一条指向不存在内容的记录，恢复时才发现是空的。
   */
  async function deleteConversation({ sessionId, deleteFolder, folderPath, title }) {
    const notes = []
    const root = trashRoot()
    if (root === undefined) {
      return { ok: false, text: '无法确定回收站位置：DSH_HOME 未设置' }
    }

    // 1) 归档：让它从侧边栏消失，并停掉正在跑的工作
    try {
      const registry = service('workspaceRegistry')
      if (registry === undefined || typeof registry.archiveSession !== 'function') {
        return { ok: false, text: '归档失败：归档服务不可用（workspaceRegistry）' }
      }
      await registry.archiveSession(sessionId, { stopActivity: true })
    } catch (error) {
      return { ok: false, text: `归档失败：${error?.message ?? error}` }
    }

    // 2) 先通知客户端移除这一行。
    //    侧边栏的行来自客户端缓存；sessions.refresh() 走 mergeOrderedBaseline，
    //    会把旧条目合并回来，光刷新移不掉。所以发官方移除事件：
    //    宿主 emit → 客户端 handleSessionRemoved → 该行立即消失（不必重启）。
    //    必须在移动文件之前发：事件按 session 资源做访问控制，记录还在时才送得出去。
    try {
      ctx.emit?.('api-session/removed', sessionId)
    } catch {
      // 发不出去时，下次启动仍会重建列表
    }

    // 3) 把会话日志目录移进回收站 —— 这是"删除"，但可恢复。
    const logDir = await findSessionLogDir(sessionId)
    if (logDir === undefined) {
      return {
        ok: false,
        text: `未找到该对话的记录目录（${logDirName(sessionId)}），已归档但记录仍在。`
          + `请确认 DSH_HOME 是否正确：${sessionsRoot() ?? '(未设置)'}`,
      }
    }

    const trashId = newTrashId()
    const entryDir = join(root, trashId)
    try {
      await mkdir(entryDir, { recursive: true })
      await movePath(logDir, join(entryDir, 'session'))
      notes.push('会话记录已移入回收站')
    } catch (error) {
      // 移动失败就清掉半成品目录，别留垃圾
      await rm(entryDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, text: `会话记录移入回收站失败：${error?.message ?? error}` }
    }

    // 记录已经不在原位了，归档集合里那条就是悬空 id：清掉它，
    // 否则每次启动都会带着一个指向空目录的归档记录。
    try {
      const registry = service('workspaceRegistry')
      if (typeof registry?.unarchiveSession === 'function') {
        await registry.unarchiveSession(sessionId)
      }
    } catch {
      // 清不掉也不影响删除结果
    }

    // 4) 可选：把该对话的文件夹也移进回收站（不是删除）
    let folderTrashed = false
    let folderOrigin
    if (deleteFolder === true) {
      const resolved = resolveChatFolder(sessionId, folderPath)
      if (resolved === undefined) {
        notes.push('不知道该对话的文件夹，未处理文件夹')
      } else {
        try {
          const info = await stat(resolved)
          if (!info.isDirectory()) {
            notes.push('目标不是文件夹，已跳过')
          } else {
            // 安全闸：拒绝盘符根、$DSH_HOME 本身、工作区目录本身这类目标
            const home = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : undefined
            const session = service('sessions')?.get?.(sessionId)
            const base = session !== undefined ? baseDirectory(session) : undefined
            const workspaceDir = typeof base === 'string' && base.length > 0 ? resolve(base) : undefined
            const tooShallow = dirname(resolved) === resolved
            const isWorkspaceRoot = workspaceDir !== undefined && resolved === workspaceDir
            if (tooShallow || isWorkspaceRoot || (home !== undefined && resolved === home)) {
              notes.push('目标路径过于宽泛，已拒绝处理')
            } else {
              await movePath(resolved, join(entryDir, 'folder'))
              createdFolders.delete(sessionId)
              void saveRegistry(createdFolders)
              folderTrashed = true
              folderOrigin = resolved
              notes.push('对话文件夹已移入回收站')
            }
          }
        } catch (error) {
          if (error?.code === 'ENOENT') notes.push('对话文件夹不存在，已跳过')
          else notes.push(`文件夹移入回收站失败：${error?.message ?? error}`)
        }
      }
    }

    // 5) 写元数据。这是回收站条目的唯一身份来源，写不进去就把内容退回去。
    const meta = {
      id: trashId,
      sessionId,
      title: typeof title === 'string' ? title : '',
      deletedAt: Date.now(),
      cwd: (() => {
        try {
          const session = service('sessions')?.get?.(sessionId)
          return session !== undefined ? baseDirectory(session) : undefined
        } catch {
          return undefined
        }
      })(),
      hasSession: true,
      hasFolder: folderTrashed,
      folderOrigin,
      logDirName: logDirName(sessionId),
      // 记下它原来所在的父目录：恢复时按原样放回，不靠猜工作区目录的转义规则
      logParent: dirname(logDir),
    }
    try {
      await writeFile(join(entryDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
    } catch (error) {
      // 元数据写不进去，这条记录就永远无法恢复 —— 退回原位比留一条坏记录好
      try {
        await movePath(join(entryDir, 'session'), logDir)
        if (folderTrashed && folderOrigin !== undefined) {
          await movePath(join(entryDir, 'folder'), folderOrigin)
        }
        await rm(entryDir, { recursive: true, force: true })
      } catch {
        // 退不回去也没别的办法了，至少把原因报出来
      }
      return { ok: false, text: `回收站记录写入失败，已尽量退回：${error?.message ?? error}` }
    }

    return {
      ok: true,
      text: `对话已移入回收站（可恢复）：${notes.join('；')}`,
      trashId,
    }
  }

  /** 恢复一条回收站记录：会话日志回原位，文件夹回原路径。 */
  async function restoreTrash(trashId) {
    const root = trashRoot()
    if (root === undefined) return { ok: false, text: '无法确定回收站位置：DSH_HOME 未设置' }
    const entryDir = join(root, String(trashId))
    const meta = await readTrashEntry(entryDir)
    if (meta === undefined) return { ok: false, text: '回收站里没有这条记录' }

    const notes = []
    const sessionPart = join(entryDir, 'session')
    if (await exists(sessionPart)) {
      const target = await originalSessionDir(meta)
      if (target === undefined) return { ok: false, text: '无法确定会话记录的原位置' }
      try {
        await mkdir(dirname(target), { recursive: true })
        await movePath(sessionPart, target)
        notes.push('会话记录已恢复')
      } catch (error) {
        return { ok: false, text: `会话记录恢复失败：${error?.message ?? error}` }
      }
    }

    const folderPart = join(entryDir, 'folder')
    if (await exists(folderPart)) {
      const target = typeof meta.folderOrigin === 'string' && meta.folderOrigin.length > 0
        ? meta.folderOrigin
        : undefined
      if (target === undefined) {
        notes.push('文件夹原路径未知，内容留在回收站')
      } else {
        try {
          await mkdir(dirname(target), { recursive: true })
          await movePath(folderPart, target)
          notes.push('对话文件夹已恢复')
          if (typeof meta.sessionId === 'string') {
            createdFolders.set(meta.sessionId, resolve(target))
            void saveRegistry(createdFolders)
          }
        } catch (error) {
          notes.push(`文件夹恢复失败：${error?.message ?? error}`)
        }
      }
    }

    // 文件类条目：回收站里放的就是那个文件本身，直接搬回原路径
    if (meta.kind === 'file') {
      let names = []
      try {
        names = await readdir(entryDir)
      } catch {
        names = []
      }
      const payload = names.find((name) => name !== 'meta.json')
      const target = typeof meta.folderOrigin === 'string' ? meta.folderOrigin : undefined
      if (payload !== undefined && target !== undefined) {
        try {
          await mkdir(dirname(target), { recursive: true })
          await movePath(join(entryDir, payload), target)
          notes.push('文件已恢复')
        } catch (error) {
          return { ok: false, text: `文件恢复失败：${error?.message ?? error}` }
        }
      }
    }

    // 会话回来了，就别再归档它
    try {
      const registry = service('workspaceRegistry')
      if (typeof registry?.unarchiveSession === 'function' && typeof meta.sessionId === 'string') {
        await registry.unarchiveSession(meta.sessionId)
      }
    } catch {
      // 恢复本身已经成功，归档状态清不掉不影响
    }

    // 内容都搬走了，记录本身没用了
    await rm(entryDir, { recursive: true, force: true }).catch(() => {})
    return { ok: true, text: `已恢复：${notes.join('；') || '（记录为空）'}` }
  }

  /** 会话日志的"原位"：优先用删除时记下的工作区路径重建目录名。 */
  async function originalSessionDir(meta) {
    const root = sessionsRoot()
    if (root === undefined) return undefined
    const target = logDirName(meta.sessionId ?? '')
    // 删除时记录过它所在的父目录，直接用最准
    if (typeof meta.logParent === 'string' && meta.logParent.length > 0) {
      return join(meta.logParent, target)
    }
    // 没有父目录记录时，按工作区重建一次（和 DSH 自己的目录规则一致）
    const cwd = typeof meta.cwd === 'string' && meta.cwd.length > 0 ? resolve(meta.cwd) : undefined
    if (cwd !== undefined) {
      const escaped = cwd.replace(/[:\\/]+/g, (match) => (match.includes(':') ? match.replace(':', '') : '-'))
      return join(root, escaped, target)
    }
    return join(root, target)
  }

  /** 彻底删除一条回收站记录（不可恢复）。 */
  async function purgeTrash(trashId) {
    const root = trashRoot()
    if (root === undefined) return { ok: false, text: '无法确定回收站位置：DSH_HOME 未设置' }
    const entryDir = join(root, String(trashId))
    if (!(await exists(entryDir))) return { ok: false, text: '回收站里没有这条记录' }
    try {
      await rm(entryDir, { recursive: true, force: true })
      return { ok: true, text: '已彻底删除' }
    } catch (error) {
      return { ok: false, text: `彻底删除失败：${error?.message ?? error}` }
    }
  }

  /** 清空整个回收站。 */
  async function emptyTrash() {
    const root = trashRoot()
    if (root === undefined) return { ok: false, text: '无法确定回收站位置：DSH_HOME 未设置' }
    const items = await listTrash()
    let removed = 0
    for (const item of items) {
      try {
        await rm(item.dir, { recursive: true, force: true })
        removed += 1
      } catch {
        // 单个删不掉就继续，最后报总数
      }
    }
    return { ok: true, text: `已清空 ${removed} 条记录`, removed }
  }

  /** 清空备份目录（用户要求：不让备份长期占空间，但由用户自己按按钮）。 */
  async function clearBackups() {
    const root = backupRoot()
    if (root === undefined) return { ok: false, text: '无法确定备份目录：DSH_HOME 未设置' }
    const info = await backupInfo()
    try {
      await rm(root, { recursive: true, force: true })
      return { ok: true, text: `已清空备份目录（${info.entries} 项，${formatBytes(info.bytes)}）`, ...info }
    } catch (error) {
      return { ok: false, text: `清空备份失败：${error?.message ?? error}` }
    }
  }

  function formatBytes(bytes) {
    const n = Number(bytes ?? 0)
    if (!Number.isFinite(n) || n <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = n
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit += 1
    }
    return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
  }

  async function exists(path) {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  /* ------------------------------------------------------------------ */
  /* 三、命令：删除对话 / 查询对话文件夹                                  */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-delete',
      description: '删除一个对话：归档它，删除会话记录，并可同步删除对话文件夹。',
      handler: async (invocation) => {
        const options = parseArgs(invocation.rawInput)
        if (options.sessionId === undefined || options.sessionId.length === 0) {
          return { kind: 'error', text: '缺少 --session=<会话 id>' }
        }
        const result = await deleteConversation(options)
        return result.ok ? { kind: 'success', text: result.text } : { kind: 'error', text: result.text }
      },
    })
  }, 'dsh-steward: /chat-delete')

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-folder',
      description: '查询一个对话自己的文件夹路径（用于删除前确认）。',
      handler: (invocation) => {
        const options = parseArgs(invocation.rawInput)
        if (options.sessionId === undefined || options.sessionId.length === 0) {
          return { kind: 'error', text: '缺少 --session=<会话 id>' }
        }
        const folderPath = resolveChatFolder(options.sessionId, options.folderPath)
        return { kind: 'success', text: folderPath ?? '' }
      },
    })
  }, 'dsh-steward: /chat-folder')

  /* ------------------------------------------------------------------ */
  /* 四、/chat-config：设置页读写                                        */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
﻿      name: 'chat-config',
      description: '读取或修改设置（对话文件夹、运行守则）。',
      handler: async (invocation) => {
        const raw = String(invocation.rawInput ?? '').trim()
        const saved = await readConfigFile()

        // getall：给设置页一次拿走两项状态
        if (raw === 'getall') {
          const folder = { ...folderConfig(config), ...(saved.folder ?? {}) }
          const guard = (saved.guardrails ?? {}).install
          return {
            kind: 'success',
            text: JSON.stringify({
              folder: folder.enabled === true,
              guardrails: guard === undefined ? true : guard === true,
            }),
          }
        }

        if (raw === '' || raw === 'get') {
          const folder = { ...folderConfig(config), ...(saved.folder ?? {}) }
          return { kind: 'success', text: String(folder.enabled === true) }
        }

        // folder.enabled=true|false  或  guardrails.enabled=true|false
        const match = /^(folder|guardrails)\.enabled\s*=\s*(true|false)$/i.exec(raw)
        if (match === null) {
          return {
            kind: 'error',
            text: '用法：/chat-config get | getall | folder.enabled=true|false | guardrails.enabled=true|false',
          }
        }

        const which = match[1].toLowerCase()
        const value = match[2].toLowerCase() === 'true'
        const next = which === 'folder'
          ? { ...saved, folder: { ...(saved.folder ?? {}), enabled: value } }
          : { ...saved, guardrails: { ...(saved.guardrails ?? {}), install: value } }

        await writeConfigFile(next)
        if (which === 'folder') savedFolder = next.folder
        else savedGuardrails = next.guardrails

        // 打开守则时立刻写一遍，不必等下次启动
        if (which === 'guardrails' && value === true) {
          try {
            await installGuardrails(true)
          } catch {
            // 写不进去不影响设置保存
          }
        }

        return { kind: 'success', text: String(value) }
      },
    })
  }, 'dsh-steward: /chat-config')

  /* ------------------------------------------------------------------ */
  /* 五、/chat-file：把交付物坐标解析成真实路径，并执行文件动作          */
  /* ------------------------------------------------------------------ */

  /**
   * 从会话事件里找出某个交付物文件。
   *
   * 界面上的文件行只有 (sessionId, seq, index) 这组授权坐标，没有路径；
   * 「复制路径」「另存为」都需要真实路径，所以按坐标回到事件里取。
   */
  async function resolvePresentedFile(sessionId, seq, index) {
    const controller = service('sessionController')
    if (controller === undefined || typeof controller.inspect !== 'function') return undefined
    const inspection = await controller.inspect(sessionId)
    const events = Array.isArray(inspection?.events) ? inspection.events : []

    const session = service('sessions')?.get?.(sessionId)
    const base = session !== undefined ? baseDirectory(session) : inspection?.meta?.cwd

    for (const event of events) {
      if (event?.seq !== seq) continue
      const data = event.data
      if (data === null || typeof data !== 'object') continue

      const files = Array.isArray(data.files)
        ? data.files
        : Array.isArray(data.presented) ? data.presented : undefined
      if (files === undefined) continue
      const picked = files[index]
      if (picked === undefined || typeof picked.path !== 'string') continue
      return { path: absolutePath(base, picked.path), description: picked.description }
    }
    return undefined
  }

  /** 把相对路径按工作目录补成绝对路径；已经是绝对路径就原样返回。 */
  function absolutePath(base, target) {
    if (typeof target !== 'string' || target.length === 0) return target
    if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith('\\\\') || target.startsWith('/')) return target
    return typeof base === 'string' && base.length > 0 ? resolve(base, target) : target
  }

  function parseFileArgs(rawInput) {
    const tokens = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
    const options = {
      action: 'path', sessionId: undefined, seq: undefined, index: undefined,
      application: undefined, targetDir: undefined, path: undefined, newName: undefined,
    }
    for (const token of tokens) {
      if (token.startsWith('--session=')) options.sessionId = token.slice('--session='.length)
      else if (token.startsWith('--seq=')) options.seq = Number(token.slice('--seq='.length))
      else if (token.startsWith('--index=')) options.index = Number(token.slice('--index='.length))
      else if (token.startsWith('--application=')) options.application = token.slice('--application='.length)
      else if (token.startsWith('--target=')) options.targetDir = token.slice('--target='.length)
      else if (token.startsWith('--name64=')) {
        try {
          options.newName = Buffer.from(token.slice('--name64='.length), 'base64').toString('utf8')
        } catch {
          options.newName = undefined
        }
      }
      else if (token.startsWith('--target64=')) {
        try {
          options.targetDir = Buffer.from(token.slice('--target64='.length), 'base64').toString('utf8')
        } catch {
          options.targetDir = undefined
        }
      }
      else if (token.startsWith('--path64=')) {
        // 路径用 base64 传：Windows 路径常含空格，直接拼进命令行会被拆断。
        try {
          options.path = Buffer.from(token.slice('--path64='.length), 'base64').toString('utf8')
        } catch {
          options.path = undefined
        }
      }
      else if (token.startsWith('--path=')) options.path = token.slice('--path='.length)
      else if (token.startsWith('--action=')) options.action = token.slice('--action='.length)
    }
    return options
  }

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-file',
      description: '解析对话里交付物文件的真实路径，或对它执行打开 / 显示位置 / 查询可用应用。',
      handler: async (invocation) => {
        const options = parseFileArgs(invocation.rawInput)

        let found
        if (typeof options.path === 'string' && options.path.length > 0) {
          // 直接给了路径（右键菜单走这条）：不必再回查事件
          found = { path: options.path }
        } else {
          if (options.sessionId === undefined) return { kind: 'error', text: '缺少 --session=<会话 id>' }
          if (!Number.isFinite(options.seq) || !Number.isFinite(options.index)) {
            return { kind: 'error', text: '缺少 --seq=<序号> 或 --index=<索引>' }
          }
          try {
            found = await resolvePresentedFile(options.sessionId, options.seq, options.index)
          } catch (error) {
            return { kind: 'error', text: `读取交付物失败：${error?.message ?? error}` }
          }
        }
        if (found === undefined) return { kind: 'error', text: '没找到这个文件（可能已被移动或删除）' }

        if (options.action === 'path') return { kind: 'success', text: found.path }

        // 在终端中打开：在该文件所在目录起一个终端窗口。
        // 用系统自带的终端，不自建 PTY —— 那会把插件和终端生命周期绑在一起。
        if (options.action === 'terminal') {
          const dir = dirname(found.path)
          const platform = process.platform
          const argv = platform === 'win32'
            ? ['cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', `cd /d "${dir}"`]]
            : platform === 'darwin'
              ? ['open', ['-a', 'Terminal', dir]]
              : ['x-terminal-emulator', ['--working-directory', dir]]
          try {
            const child = spawn(argv[0], argv[1], { detached: true, stdio: 'ignore', windowsHide: false })
            child.on('error', () => {})
            child.unref()
            return { kind: 'success', text: dir }
          } catch (error) {
            return { kind: 'error', text: `打开终端失败：${error?.message ?? error}` }
          }
        }

        // 重命名：同目录内改文件名，不覆盖已有文件。
        if (options.action === 'rename') {
          if (typeof options.newName !== 'string' || options.newName.trim().length === 0) {
            return { kind: 'error', text: '缺少新文件名' }
          }
          const dir = dirname(found.path)
          const cleaned = sanitize(options.newName.trim())
          const target = resolve(dir, cleaned)
          // 只允许改同一目录里的名字，不允许借重命名把文件挪到别处
          if (dirname(target) !== resolve(dir)) {
            return { kind: 'error', text: '新名字不能包含路径分隔符' }
          }
          if (target === resolve(found.path)) return { kind: 'success', text: target }
          if (await exists(target)) {
            return { kind: 'error', text: `同名文件已存在：${cleaned}` }
          }
          try {
            await rename(found.path, target)
            return { kind: 'success', text: target }
          } catch (error) {
            return { kind: 'error', text: `重命名失败：${error?.message ?? error}` }
          }
        }

        // 移到回收站：文件进 $DSH_HOME/trash/files/<id>/，可恢复。
        if (options.action === 'trash') {
          const root = trashRoot()
          if (root === undefined) return { kind: 'error', text: '无法确定回收站位置：DSH_HOME 未设置' }
          const id = `file-${newTrashId()}`
          const entryDir = join(root, id)
          try {
            await mkdir(entryDir, { recursive: true })
            const name = basename(found.path)
            await movePath(found.path, join(entryDir, name))
            const info = await stat(join(entryDir, name)).catch(() => undefined)
            await writeFile(join(entryDir, 'meta.json'), JSON.stringify({
              id,
              kind: 'file',
              sessionId: options.sessionId,
              title: name,
              deletedAt: Date.now(),
              folderOrigin: found.path,
              hasSession: false,
              hasFolder: true,
              bytes: info?.size ?? 0,
            }, null, 2), 'utf8')
            return { kind: 'success', text: join(entryDir, name) }
          } catch (error) {
            await rm(entryDir, { recursive: true, force: true }).catch(() => {})
            return { kind: 'error', text: `移到回收站失败：${error?.message ?? error}` }
          }
        }

        // 另存为：把文件复制到调用方已经选好的目录，保持原文件名。
        if (options.action === 'saveas') {
          if (typeof options.targetDir !== 'string' || options.targetDir.length === 0) {
            return { kind: 'error', text: '缺少 --target=<目标目录>' }
          }
          try {
            const info = await stat(found.path)
            if (!info.isFile()) return { kind: 'error', text: '这个条目不是文件，无法另存' }
            const name = found.path.split(/[\\/]/).pop() ?? 'file'
            let target = resolve(options.targetDir, name)
            // 目标已存在就加序号，不覆盖用户已有文件
            let counter = 1
            while (true) {
              try {
                await stat(target)
                const dot = name.lastIndexOf('.')
                const base = dot > 0 ? name.slice(0, dot) : name
                const ext = dot > 0 ? name.slice(dot) : ''
                target = resolve(options.targetDir, `${base} (${counter})${ext}`)
                counter += 1
              } catch {
                break
              }
            }
            await copyFile(found.path, target)
            return { kind: 'success', text: target }
          } catch (error) {
            return { kind: 'error', text: `另存为失败：${error?.message ?? error}` }
          }
        }

        const controller = service('sessionController')

        if (options.action === 'applications') {
          if (controller === undefined || typeof controller.workspacePathApplications !== 'function') {
            return { kind: 'error', text: '当前环境无法查询打开方式' }
          }
          try {
            const apps = await controller.workspacePathApplications(
              { path: found.path }, new AbortController().signal,
            )
            const list = (Array.isArray(apps) ? apps : []).map((app) => ({
              id: String(app.id),
              name: String(app.name),
              isDefault: app.default === true,
            }))
            return { kind: 'success', text: JSON.stringify({ path: found.path, applications: list }) }
          } catch (error) {
            return { kind: 'error', text: `查询打开方式失败：${error?.message ?? error}` }
          }
        }

        if (controller === undefined || typeof controller.openWorkspacePath !== 'function') {
          return { kind: 'error', text: '当前环境不支持打开文件（openWorkspacePath 不可用）' }
        }
        try {
          await controller.openWorkspacePath({
            path: found.path,
            ...(options.action === 'reveal' ? { action: 'reveal' } : {}),
            ...(options.application !== undefined ? { application: options.application } : {}),
          }, new AbortController().signal)
          return { kind: 'success', text: found.path }
        } catch (error) {
          return { kind: 'error', text: `打开失败：${error?.message ?? error}` }
        }
      },
    })
  }, 'dsh-steward: /chat-file')

  /* ------------------------------------------------------------------ */
  /* 六、/chat-delete-batch：批量删除（同样进回收站）                     */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-delete-batch',
      description: '批量删除对话：逐个归档并移入回收站，可一并处理各自的文件夹。',
      handler: async (invocation) => {
        const tokens = String(invocation.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
        const options = { sessionIds: [], deleteFolder: false }
        for (const token of tokens) {
          if (token === '--with-folder') options.deleteFolder = true
          else if (token.startsWith('--sessions=')) {
            // 逗号分隔；会话 id 里不会有逗号，所以不需要转义
            options.sessionIds = token.slice('--sessions='.length).split(',').filter(Boolean)
          }
        }
        if (options.sessionIds.length === 0) {
          return { kind: 'error', text: '缺少 --sessions=<id1,id2,...>' }
        }

        const results = []
        for (const sessionId of options.sessionIds) {
          try {
            const result = await deleteConversation({
              sessionId,
              deleteFolder: options.deleteFolder,
              folderPath: undefined,
            })
            results.push({ sessionId, ok: result.ok === true, text: result.text })
          } catch (error) {
            results.push({ sessionId, ok: false, text: String(error?.message ?? error) })
          }
        }

        const ok = results.filter((item) => item.ok).length
        return {
          kind: ok > 0 ? 'success' : 'error',
          text: JSON.stringify({ total: results.length, ok, failed: results.length - ok, results }),
        }
      },
    })
  }, 'dsh-steward: /chat-delete-batch')

  /* ------------------------------------------------------------------ */
  /* 七、/chat-trash：回收站（列表 / 恢复 / 彻底删除 / 清空）             */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-trash',
      description: '回收站：list 列出、restore 恢复、purge 彻底删除一条、empty 清空。',
      handler: async (invocation) => {
        const tokens = String(invocation.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
        const action = (tokens[0] ?? 'list').toLowerCase()
        const arg = tokens[1]

        if (action === 'list') {
          const items = await listTrash()
          return {
            kind: 'success',
            text: JSON.stringify({
              total: items.length,
              bytes: items.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
              items: items.map((item) => ({
                id: item.id,
                kind: item.kind === 'file' ? 'file' : 'conversation',
                sessionId: item.sessionId,
                title: item.title ?? '',
                deletedAt: item.deletedAt ?? 0,
                bytes: item.bytes ?? 0,
                hasFolder: item.hasFolder === true,
                folderOrigin: item.folderOrigin ?? '',
              })),
            }),
          }
        }

        if (action === 'restore') {
          if (arg === undefined) return { kind: 'error', text: '缺少回收站条目 id' }
          const result = await restoreTrash(arg)
          return result.ok ? { kind: 'success', text: result.text } : { kind: 'error', text: result.text }
        }

        if (action === 'purge') {
          if (arg === undefined) return { kind: 'error', text: '缺少回收站条目 id' }
          const result = await purgeTrash(arg)
          return result.ok ? { kind: 'success', text: result.text } : { kind: 'error', text: result.text }
        }

        if (action === 'empty') {
          const result = await emptyTrash()
          return result.ok ? { kind: 'success', text: result.text } : { kind: 'error', text: result.text }
        }

        return { kind: 'error', text: '用法：/chat-trash list | restore <id> | purge <id> | empty' }
      },
    })
  }, 'dsh-steward: /chat-trash')

  /* ------------------------------------------------------------------ */
  /* 七、/chat-backup：备份目录（查看占用 / 清空 / 打开文件夹）            */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-backup',
      description: '备份目录：info 查看占用、clear 一键清空、open 打开文件夹让用户自己取舍。',
      handler: async (invocation) => {
        const action = String(invocation.rawInput ?? '').trim().toLowerCase() || 'info'

        if (action === 'info') {
          const info = await backupInfo()
          return {
            kind: 'success',
            text: JSON.stringify({
              dir: info.dir,
              exists: info.exists === true,
              entries: info.entries ?? 0,
              bytes: info.bytes ?? 0,
              human: formatBytes(info.bytes ?? 0),
              oldest: info.oldest,
              newest: info.newest,
            }),
          }
        }

        if (action === 'clear') {
          const result = await clearBackups()
          return result.ok ? { kind: 'success', text: result.text } : { kind: 'error', text: result.text }
        }

        if (action === 'open') {
          const info = await backupInfo()
          if (info.exists !== true) return { kind: 'success', text: `备份目录还不存在：${info.dir}` }
          const opened = openDirectory(info.dir)
          return opened
            ? { kind: 'success', text: info.dir }
            : { kind: 'error', text: '无法打开文件夹（当前环境不支持）' }
        }

        return { kind: 'error', text: '用法：/chat-backup info | clear | open' }
      },
    })
  }, 'dsh-steward: /chat-backup')

  /* ------------------------------------------------------------------ */
  /* 八、/chat-doctor：体检（全部只读）                                   */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-doctor',
      description: '自检：守则块、配置、孤儿文件夹、回收站与备份占用，一次报清楚。',
      handler: async () => {
        const report = await runDoctor()
        return { kind: 'success', text: JSON.stringify(report) }
      },
    })
  }, 'dsh-steward: /chat-doctor')

  async function runDoctor() {
    const checks = []
    const home = process.env.DSH_HOME

    // 1) 守则块
    try {
      const target = home === undefined ? undefined : join(home, 'AGENTS.md')
      let text
      if (target === undefined) throw new Error('DSH_HOME 未设置')
      text = await readFile(target, 'utf8')
      const begin = (text.match(/dsh-steward:begin/g) ?? []).length
      const end = (text.match(/dsh-steward:end/g) ?? []).length
      const legacy = (text.match(/guardrails:begin/g) ?? []).length
      checks.push({
        id: 'guardrails',
        status: begin === 1 && end === 1 && legacy === 0 ? 'ok' : 'warn',
        detail: begin === 1 && end === 1
          ? `守则块完整（${Buffer.byteLength(text, 'utf8')} 字节）`
          : `标记不配对：begin=${begin} end=${end}${legacy > 0 ? `，还残留 ${legacy} 段旧标记` : ''}`,
      })
    } catch (error) {
      checks.push({ id: 'guardrails', status: 'warn', detail: `读不到 AGENTS.md：${error?.message ?? error}` })
    }

    // 2) 设置表单（Config 是否投影出来）
    checks.push({
      id: 'config-schema',
      status: Config === undefined ? 'warn' : 'ok',
      detail: Config === undefined
        ? '拿不到 schemastery，设置页表单缺失（功能仍可用）'
        : '设置表单可用',
    })

    // 3) 配置文件
    try {
      const saved = await readConfigFile()
      checks.push({
        id: 'config-file',
        status: 'ok',
        detail: `配置文件可读：folder.enabled=${(saved.folder ?? {}).enabled === true}，`
          + `guardrails.install=${(saved.guardrails ?? {}).install !== false}`,
      })
    } catch (error) {
      checks.push({ id: 'config-file', status: 'warn', detail: `配置文件读取失败：${error?.message ?? error}` })
    }

    // 4) 孤儿文件夹：登记表里指向的目录还在不在、以及工作区里 chat-* 有没有对应会话
    try {
      const registry = await loadRegistry()
      const missing = []
      for (const [id, path] of registry) {
        if (!(await exists(path))) missing.push({ id, path })
      }
      checks.push({
        id: 'folder-registry',
        status: missing.length === 0 ? 'ok' : 'warn',
        detail: missing.length === 0
          ? `登记表 ${registry.size} 条，全部存在`
          : `${missing.length}/${registry.size} 条登记指向的目录已不存在`,
        missing: missing.slice(0, 20),
      })
    } catch (error) {
      checks.push({ id: 'folder-registry', status: 'warn', detail: `登记表检查失败：${error?.message ?? error}` })
    }

    // 5) 回收站
    try {
      const items = await listTrash()
      const bytes = items.reduce((sum, item) => sum + (item.bytes ?? 0), 0)
      checks.push({
        id: 'trash',
        status: 'ok',
        detail: items.length === 0 ? '回收站为空' : `回收站 ${items.length} 条，占 ${formatBytes(bytes)}`,
        entries: items.length,
        bytes,
      })
    } catch (error) {
      checks.push({ id: 'trash', status: 'warn', detail: `回收站检查失败：${error?.message ?? error}` })
    }

    // 6) 备份占用
    try {
      const info = await backupInfo()
      checks.push({
        id: 'backups',
        status: info.exists !== true || (info.bytes ?? 0) === 0 ? 'ok' : 'info',
        detail: info.exists !== true
          ? '备份目录还不存在'
          : `备份 ${info.entries} 项，占 ${formatBytes(info.bytes ?? 0)}`,
        dir: info.dir,
        entries: info.entries ?? 0,
        bytes: info.bytes ?? 0,
      })
    } catch (error) {
      checks.push({ id: 'backups', status: 'warn', detail: `备份目录检查失败：${error?.message ?? error}` })
    }

    return {
      at: Date.now(),
      home: home ?? '',
      checks,
      problems: checks.filter((item) => item.status === 'warn').length,
    }
  }

  /* ------------------------------------------------------------------ */
  /* 九、/chat-guardrails：守则全文 / 预览 / 恢复默认                     */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-guardrails',
      description: '守则：get 返回全文与写入状态，preview 返回将会写入的内容，restore 用内置版本覆盖。',
      handler: async (invocation) => {
        const action = String(invocation.rawInput ?? '').trim().toLowerCase() || 'get'

        let rules
        try {
          const source = guardrailsSource()
          if (source === undefined) throw new Error('内置守则文件不可用')
          rules = await readFile(source, 'utf8')
        } catch (error) {
          return { kind: 'error', text: `读取内置守则失败：${error?.message ?? error}` }
        }

        if (action === 'get' || action === 'preview') {
          const home = process.env.DSH_HOME
          const target = home === undefined ? undefined : join(home, 'AGENTS.md')
          let current
          try {
            current = target === undefined ? undefined : await readFile(target, 'utf8')
          } catch {
            current = undefined
          }
          const installed = typeof current === 'string'
            && current.includes(GUARDRAIL_BEGIN)
            && current.includes(GUARDRAIL_END)
          return {
            kind: 'success',
            text: JSON.stringify({
              path: target ?? '',
              installed,
              rules: rules.trim(),
              // preview：把"写入后会变成什么样"整段给出来，让用户先看再决定
              next: action === 'preview' ? composeGuardrails(current, rules) : undefined,
            }),
          }
        }

        if (action === 'restore') {
          const home = process.env.DSH_HOME
          if (home === undefined) return { kind: 'error', text: 'DSH_HOME 未设置' }
          const target = join(home, 'AGENTS.md')
          let current
          try {
            current = await readFile(target, 'utf8')
          } catch {
            current = undefined
          }
          // 覆盖前先备份，符合守则自己的原则三
          if (current !== undefined) {
            try {
              const dir = join(home, 'backups')
              await mkdir(dir, { recursive: true })
              const stamp = new Date().toISOString().replace(/[:.]/g, '-')
              await copyFile(target, join(dir, `AGENTS.md.${stamp}.bak`))
            } catch (error) {
              return { kind: 'error', text: `备份失败，已放弃写入：${error?.message ?? error}` }
            }
          }
          try {
            await writeFile(target, composeGuardrails(current, rules), 'utf8')
            return { kind: 'success', text: '已用内置版本恢复守则段' }
          } catch (error) {
            return { kind: 'error', text: `写入失败：${error?.message ?? error}` }
          }
        }

        return { kind: 'error', text: '用法：/chat-guardrails get | preview | restore' }
      },
    })
  }, 'dsh-steward: /chat-guardrails')

  /* ------------------------------------------------------------------ */
  /* 十、/chat-open-folder：打开某个对话自己的文件夹                      */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-open-folder',
      description: '打开某个对话自己的文件夹（在资源管理器里）。',
      handler: async (invocation) => {
        const options = parseArgs(invocation.rawInput)
        if (options.sessionId === undefined || options.sessionId.length === 0) {
          return { kind: 'error', text: '缺少 --session=<会话 id>' }
        }
        const folderPath = resolveChatFolder(options.sessionId, options.folderPath)
        if (folderPath === undefined) {
          return { kind: 'error', text: '这个对话没有登记过的文件夹' }
        }
        if (!(await exists(folderPath))) {
          return { kind: 'error', text: `文件夹已不存在：${folderPath}` }
        }
        const opened = openDirectory(folderPath)
        return opened
          ? { kind: 'success', text: folderPath }
          : { kind: 'error', text: '无法打开文件夹（当前环境不支持）' }
      },
    })
  }, 'dsh-steward: /chat-open-folder')

  /* ------------------------------------------------------------------ */
  /* 十一、/chat-folder-audit：找出并清理多建出来的空对话文件夹           */
  /* ------------------------------------------------------------------ */

  ctx.effect(() => {
    return ctx.commands.register({
      name: 'chat-folder-audit',
      description: '检查对话文件夹：找出空目录与孤儿登记；可把多余的空目录移进回收站。',
      handler: async (invocation) => {
        const mode = String(invocation.rawInput ?? '').trim().toLowerCase() || 'list'
        const registry = await loadRegistry()

        // 登记表里指向的目录，是"有主"的
        const owned = new Set([...registry.values()].map((p) => resolve(p).toLowerCase()))

        // 扫所有工作区根目录下的 chat-*（模板前缀可配，这里按登记表反推前缀更稳）
        const template = currentFolder().template ?? DEFAULTS.folder.template
        const prefix = String(template).split('{')[0] || 'chat-'

        const roots = new Set()
        for (const path of registry.values()) roots.add(dirname(resolve(path)))
        // 再加上所有已知工作区目录
        try {
          const registrySvc = service('workspaceRegistry')
          for (const workspace of registrySvc?.list?.() ?? []) {
            if (typeof workspace?.path === 'string') roots.add(resolve(workspace.path))
          }
        } catch {
          // 拿不到工作区列表就只扫登记表所在的目录
        }

        const empty = []
        const unowned = []
        for (const root of roots) {
          let entries
          try {
            entries = await readdir(root, { withFileTypes: true })
          } catch {
            continue
          }
          for (const entry of entries) {
            if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
            const full = resolve(join(root, entry.name))
            const isOwned = owned.has(full.toLowerCase())
            let count = 0
            try {
              count = (await readdir(full)).length
            } catch {
              continue
            }
            if (!isOwned) {
              unowned.push({ path: full, empty: count === 0, entries: count })
            } else if (count === 0) {
              empty.push({ path: full })
            }
          }
        }

        const missing = []
        for (const [id, path] of registry) {
          if (!(await exists(path))) missing.push({ sessionId: id, path })
        }

        if (mode === 'list') {
          return {
            kind: 'success',
            text: JSON.stringify({
              registered: registry.size,
              unowned: unowned.length,
              emptyOwned: empty.length,
              missing: missing.length,
              unownedList: unowned.slice(0, 50),
              emptyList: empty.slice(0, 50),
              missingList: missing.slice(0, 50),
            }),
          }
        }

        // clean：把**未被登记**的空目录移进回收站（不是直接删）
        if (mode === 'clean') {
          const root = trashRoot()
          if (root === undefined) return { kind: 'error', text: '无法确定回收站位置：DSH_HOME 未设置' }
          const moved = []
          const skipped = []
          for (const item of unowned) {
            if (!item.empty) {
              skipped.push({ path: item.path, reason: 'not-empty' })
              continue
            }
            const id = `folder-${newTrashId()}`
            const entryDir = join(root, id)
            try {
              await mkdir(entryDir, { recursive: true })
              await movePath(item.path, join(entryDir, 'folder'))
              await writeFile(join(entryDir, 'meta.json'), JSON.stringify({
                id,
                kind: 'folder',
                title: basename(item.path),
                deletedAt: Date.now(),
                folderOrigin: item.path,
                hasSession: false,
                hasFolder: true,
              }, null, 2), 'utf8')
              moved.push(item.path)
            } catch (error) {
              await rm(entryDir, { recursive: true, force: true }).catch(() => {})
              skipped.push({ path: item.path, reason: String(error?.message ?? error) })
            }
          }
          return {
            kind: 'success',
            text: JSON.stringify({ moved: moved.length, skipped: skipped.length, movedList: moved.slice(0, 50), skipped }),
          }
        }

        return { kind: 'error', text: '用法：/chat-folder-audit list | clean' }
      },
    })
  }, 'dsh-steward: /chat-folder-audit')
}

﻿/* ================================================================== */
/* 运行守则：把三原则写进 $DSH_HOME/AGENTS.md                          */
/* ================================================================== */
/*
 * 这段来自原来的 guardrails 插件，合并进来后仍保持它最重要的性质：
 * 任何一步失败都只是"守则没写入"，绝不抛错到 harness。
 */

const GUARDRAIL_BEGIN = '<!-- dsh-steward:begin 由 dsh-steward 维护，请勿手改本段 -->'
const GUARDRAIL_END = '<!-- dsh-steward:end -->'
/* 兼容旧标记：早期单独安装 guardrails 时写的是 guardrails:begin/end */
const LEGACY_BEGIN = '<!-- guardrails:begin'
const LEGACY_END = '<!-- guardrails:end -->'

function guardrailsSource() {
  try {
    return fileURLToPath(new URL('./AGENTS.guardrails.md', import.meta.url))
  } catch {
    return undefined
  }
}

/** 用新标记段替换旧内容；同时清理旧插件留下的 guardrails 段，避免重复。 */
function composeGuardrails(existing, rules) {
  const block = `${GUARDRAIL_BEGIN}\n${rules.trim()}\n${GUARDRAIL_END}`
  let text = typeof existing === 'string' ? existing : ''

  // 先摘掉旧插件的段落
  const lb = text.indexOf(LEGACY_BEGIN)
  const le = text.indexOf(LEGACY_END)
  if (lb >= 0 && le > lb) {
    text = `${text.slice(0, lb)}${text.slice(le + LEGACY_END.length)}`
  }

  const begin = text.indexOf(GUARDRAIL_BEGIN)
  const end = text.indexOf(GUARDRAIL_END)
  if (begin >= 0 && end > begin) {
    return `${text.slice(0, begin)}${block}${text.slice(end + GUARDRAIL_END.length)}`
      .replace(/\n{3,}/g, '\n\n')
  }
  if (text.trim().length === 0) return `${block}\n`
  return `${text.trimEnd()}\n\n${block}\n`
}

async function installGuardrails(settings) {
  if (settings !== true) return
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || home.length === 0) return

  const source = guardrailsSource()
  if (source === undefined) return

  let rules
  try {
    rules = await readFile(source, 'utf8')
  } catch {
    return
  }
  if (typeof rules !== 'string' || rules.trim().length === 0) return

  const target = join(home, 'AGENTS.md')
  let current
  try {
    current = await readFile(target, 'utf8')
  } catch {
    current = undefined
  }

  const next = composeGuardrails(current, rules)
  if (current === next) return

  // 覆盖前先备份，符合它自己的原则三
  if (current !== undefined) {
    try {
      const backupDir = join(home, 'backups')
      await mkdir(backupDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await copyFile(target, join(backupDir, `AGENTS.md.${stamp}.bak`))
    } catch {
      return
    }
  }

  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, next, 'utf8')
  } catch {
    // 写不进去也只是守则没生效
  }
}
