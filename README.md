# dsh-steward · 对话管家

[![npm](https://img.shields.io/npm/v/dsh-steward)](https://www.npmjs.com/package/dsh-steward)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.1%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的对话管家：
> 每个对话一个文件夹、可恢复的删除、文件右键菜单，外加一套写进全局 `AGENTS.md` 的运行守则。

🌏 **中文** · [English](./README.en.md)

---

## 它解决什么问题

DSH 原生把「对话」放在侧边栏，但：

- 对话一多，**找不到某个对话对应的文件** —— 它没有「每个对话一个目录」的概念。
- 删对话是**不可逆**的 —— 手滑一次，记录就没了。
- 对话里的文件卡片只能点开，**不能右键**做「打开文件夹 / 复制路径 / 另存为」。
- 想让 agent 每次都遵守同一套安全基线，**没有统一入口** —— 只能每个工作区各写一份 `AGENTS.md`。

这个插件把这四件事一次做完，并且只有**一个 bundle、一个开关、一个设置页**。

## 安装

把 `<profile>` 换成你的 profile 名（桌面端通常是 `desktop`，Web 端通常是 `web`）。

### 方式一：tarball（推荐，不依赖 git）

```sh
dsh plugin --profile <profile> add https://codeload.github.com/John4874314/dsh-steward/tar.gz/refs/tags/v1.0.0
```

不要求本机装 git，也不要求 `github.com:443` 可直连 —— 只走 `codeload.github.com`。

### 方式二：`github:` 简写

```sh
dsh plugin --profile <profile> add github:John4874314/dsh-steward
```

需要本机 `PATH` 里有 `git`，且能连上 `github.com:443`。在国内网络下
`github.com` 常常超时（`api.github.com` / `codeload.github.com` 却正常），
这时会报 `ERR_PNPM_GIT_RESOLVE_FAILED`，换方式一即可。

### 装完之后

**重启 DSH**。客户端 bundle 图在进程启动时构建，只按 `Ctrl/Cmd + Shift + R` 刷新页面
不会重新扫描新插件。

### 环境要求

- DSH **0.2.1-rc.1** 或更新（在 `0.2.1-rc.3` 上实测通过）
- Node ≥ 20

> 尚未发布到 npm。`dsh plugin add dsh-steward` 现在装不到东西，请用上面两种方式。

## 功能

### 一、对话管理

#### 每个新对话一个文件夹（默认关闭）

设置 → 对话管家 → 对话管理 → 「每个新对话创建一个文件夹」。

- 默认在**发出第一条消息时**才建，空会话不留目录。
- 子代理不建（跟随父会话）；路径越界拒绝；非法字符替换成 `-`。
- 开关即时生效，配置存 `$DSH_HOME/chat-manager-config.json`。

#### 删除对话（可恢复）

对话行「⋯」菜单 → 「删除对话」。

确认框里可勾选「同时删除该对话的文件夹」。确认后：

1. 归档该对话
2. 发 `api-session/removed`，让侧边栏**立即**移除该行
3. 把会话记录目录**移进回收站**（不是删除）
4. 清理归档记录
5. 可选：把文件夹也移进回收站

> 内容进 `$DSH_HOME/trash/<id>/`，并写一条 `meta.json` 记下标题、时间、原路径。
> 设置页「回收站」里可以恢复或彻底删除。

#### 打开该对话的文件夹

对话行「⋯」菜单 → 「打开该对话的文件夹」，直接在资源管理器里定位。
没有登记过文件夹的对话**不显示这一行** —— 不占位，也不会出现点了没反应的按钮。

#### 批量删除

```
/chat-delete-batch --sessions=<id1,id2,...> [--with-folder]
```

逐个走同一条删除路径，全部进回收站，返回每个的成功/失败明细。

#### 文件右键菜单

对话里的文件卡片上**点右键**（或用键盘 `Shift+F10` / 菜单键）：

| 动作 | 说明 |
| --- | --- |
| 打开 / 打开文件夹 / 选择打开方式 | 走 `remote.session.*`，**不写会话日志** |
| 在终端中打开 | 在该文件所在目录起一个终端窗口 |
| 复制路径 | 复制绝对路径 |
| 复制为引用 | 复制成 `@<路径>`，粘贴到输入框即可定位 |
| 另存为… | 选目录后由宿主复制一份（同名自动加序号） |
| 重命名… | 同目录内改名，不覆盖已有文件 |
| 移到回收站 | 文件进 `$DSH_HOME/trash/`，可恢复 |

外观是液态玻璃，颜色取 `--dsw-alias-*` 令牌，随深浅主题自动切换。

> 「打开 / 打开文件夹 / 打开方式 / 复制路径 / 复制为引用」不写日志；
> 「在终端中打开 / 另存为 / 重命名 / 移到回收站」必须由宿主执行，走 `/chat-file`，
> 会在对话里留一条命令记录 —— 这是浏览器无法直接写本地文件的必然代价。

### 二、运行守则（三原则）

设置 → 对话管家 → 运行守则 → 「启用运行三原则」。

打开后把三原则写进 **`$DSH_HOME/AGENTS.md`**（DSH 的全局指令文件），
**每个工作区、每个新会话**都会带上，harness 升级也不丢：

1. **不破坏 DSH 与系统** —— 不碰安装目录 / profile 配置 / 会话凭据 / 系统设置；不为完成任务降级安全。
2. **有风险的操作先验证** —— 说清「改什么 / 最坏怎样 / 怎么撤回」再执行；能小步试就不全量。
3. **留好备份、保证可回退** —— 改前备份、确认回退路径存在、改完验证、验证不过就回退。

正文见 [`AGENTS.guardrails.md`](./AGENTS.guardrails.md)。

> 本 bundle 的 patch 会**重新启用** `agent-instructions`（web-app bundle 默认禁用了它），
> 否则守则写进 `AGENTS.md` 也进不了上下文。副作用：项目里的 `AGENTS.md` / `CLAUDE.md`
> 也会被读进上下文。

### 三、设置页的五个分页

| 分页 | 内容 |
| --- | --- |
| 对话 | 每个新对话一个文件夹的开关 |
| 回收站 | 列表 / 恢复 / 彻底删除 / 清空，显示每条占用 |
| 备份 | 备份目录位置与占用，**一键清空** 或 **打开文件夹** 自行取舍 |
| 运行守则 | 三原则开关、全文展开、写入结果预览、用内置版本恢复 |
| 体检 | 一次只读自检，报告守则块 / 表单 / 配置 / 登记表 / 回收站 / 备份 |

#### 备份由你自己决定留还是删

写 `AGENTS.md` 等文件前会自动备份到 `$DSH_HOME/backups/`，备份会一直留着占磁盘。
「备份」分页因此给了两个按钮：**一键清空** 或 **打开备份文件夹** 自己挑。
插件不会替你自动删 —— 那是不可逆操作，该由你决定。

#### 体检报告什么

| 检查项 | 说明 |
| --- | --- |
| `guardrails` | 守则块在不在、标记是否配对、有没有残留旧标记 |
| `config-schema` | schemastery 是否可用（拿不到就没设置表单） |
| `config-file` | 配置文件能否读取、当前开关值 |
| `folder-registry` | 登记表里有多少条指向已不存在的目录 |
| `trash` | 回收站条目数与占用 |
| `backups` | 备份条目数与占用 |

全部只读，不改任何文件。

## 为什么不会拖垮 harness

这是本插件最看重的设计目标 —— **任何失败都只表现为「少一个功能」，绝不连累 DSH 本身**：

- **宿主半侧没有 Config 就降级**：schemastery 用运行时尝试获取（先本地、再 profile），
  拿不到就导出 `Config = undefined`，插件照常加载，只是没有设置表单。
- **守则写入整段包在 try/catch**，`apply` 结尾 `catch(() => {})`，任何失败都只是「没写进去」。
- **写 `AGENTS.md` 前先备份**到 `$DSH_HOME/backups/`，备份失败就放弃写入。
- **幂等**：靠 `<!-- dsh-steward:begin/end -->` 定位，只替换自己那段；
  还会顺手清理旧 guardrails 插件留下的 `guardrails:begin/end` 段。
- **客户端适配是弱引用**：对其它插件（如 `dsh-better-sidebar`）的集成一律用
  `ctx.get(...)` 探测 + try/catch，目标不存在就跳过，不影响本体。

已做故障注入：`DSH_HOME` 不存在、`config` 为 null、依赖缺失、重复 `apply` 均不抛错。

## 配置

配置文件在 `$DSH_HOME/chat-manager-config.json`：

```json
{
  "folder": {
    "enabled": false,
    "trigger": "first-message",
    "template": "chat-{date}-{time}",
    "useAsWorkingDirectory": false
  },
  "guardrails": {
    "install": true
  }
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `folder.enabled` | `false` | 是否每个新对话建一个文件夹 |
| `folder.trigger` | `first-message` | `first-message` 或 `session-start` |
| `folder.template` | `chat-{date}-{time}` | 支持 `{date}` `{time}` `{title}` `{id}` |
| `folder.useAsWorkingDirectory` | `false` | 建好后是否把该对话的工作目录切过去 |
| `guardrails.install` | `true` | 是否把三原则写进全局 `AGENTS.md` |

> 设置页只暴露 `folder.enabled` 和 `guardrails.install` 两个开关；
> 其余字段需要手改这个 JSON。改完重启 DSH 生效。

## 卸载

设置 → 插件 → 已安装 → 移除。

`$DSH_HOME/AGENTS.md` 里的守则段**不会自动删除**（那是你的文件），
需要的话手删 `<!-- dsh-steward:begin -->` 与 `<!-- dsh-steward:end -->` 之间的内容。

> `node_modules/` 里指向 schemastery 的链接是设置表单用的，
> 删掉只会让设置页退化，不会让插件崩。

## 许可证

[MIT](./LICENSE)
