# dsh-steward · Conversation Steward

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![CI](https://github.com/John4874314/dsh-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/John4874314/dsh-steward/actions/workflows/ci.yml)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.1%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)

> A conversation steward for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
> one folder per conversation with an automatic **handover log**, a **recoverable** delete,
> type-aware right-click file actions, a right-click menu for links, and a three-rule safety
> baseline that you opt into explicitly before it touches the global `AGENTS.md`.

> **Not published to npm.** There is no npm package, and the badges above carry no npm version —
> install with the tarball command in "Install". `dsh plugin add dsh-steward` resolves nothing.

🌏 [中文](./README.md) · **English**

---

## Platform support

Core features (conversation folders, handover log, delete, context menus, backups, checkup)
work on **Windows, macOS and Linux**. A few items are **Windows-only** and are **hidden** on other
systems rather than shown as dead menu entries:

| Feature | Windows | macOS / Linux |
| --- | --- | --- |
| Folder per conversation, handover log | ✅ | ✅ |
| Delete conversation (recoverable), batch delete | ✅ | ✅ |
| File menu: open / copy path / save as / rename / move to trash | ✅ | ✅ |
| File menu: **extract here** | ✅ via system `tar.exe` | ❌ hidden |
| Link menu: **open in another browser** | ✅ reads `StartMenuInternet` | ❌ hidden (default browser only) |
| File menu: **open in terminal** | ✅ | ❌ hidden |

If you see an item that is **shown but does nothing** on a non-Windows system, that is a bug — please open an issue.

## What it fixes

DSH keeps conversations in the sidebar, but:

- **You cannot tell which files belong to which conversation** — there is no "one folder per conversation" notion.
- **Deleting a conversation is irreversible** — one slip and the record is gone.
- **File cards in a conversation can only be clicked, not right-clicked** for "open folder / copy path / save as" —
  and there is no way to give images, code and archives different actions.
- **Links can only be clicked** — you cannot open one in a different browser, copy just the URL, or copy it as a Markdown link.
- **There is no single place to make the agent follow the same safety baseline** — you end up writing one `AGENTS.md` per workspace.

This plugin does all five, in **one bundle, one switch, one settings page**.

## Changelog

### 1.3.0

**This fixes a release-blocking bug: 1.0.0 through 1.2.2 could not load when installed from a tarball or npm.**

- **Fixed the `name` in `cordis.patch.yml`**: it said `@local/dsh-steward`, the local development
  alias, while the real package name is `dsh-steward`. The host resolves modules by that `name`,
  so installing produced `ERR_MODULE_NOT_FOUND: Cannot find package '@local/dsh-steward'` and the
  whole plugin stayed inactive (`dsh: warning: 1 entry did not activate`). It slipped through
  because locally the package happened to be installed under the `@local/` scope.
- **`client.js` module id changed to `dsh-steward`** to match the package name.
- **Guardrails now default to off.** Previously `guardrails.install: true` combined with a
  `!== false` check meant `undefined` counted as enabled — installing the plugin wrote into the
  global `AGENTS.md`. Now it only writes when you explicitly turn it on.
- **Added a minimal test suite and CI.** `npm test` runs 6 assertions; the first one is
  "package.json / patch insert / client module id must all agree". Verified that this test fails
  if you put `@local/` back.
- **Dropped the npm badge** (the package is not on npm, so the badge was false) and added the
  platform support matrix.

### 1.2.0

- **Every conversation folder now gets a `交接日志.md` handover log**: an overview
  (session id, working directory, start/end time, message counts), the files this
  conversation produced, and the conversation itself in order — what the user asked,
  what the assistant answered, which tools ran and whether they succeeded. Written so
  the next person (or you, days later) can pick the task up.
- Written when the folder is created, then at every turn end (throttled to one write
  per 4 seconds per session). The whole document is regenerated and atomically replaced,
  so a half-written file can never appear.
- Strips the `<system-reminder>` block DSH injects into every user message — measured at
  **48%** of raw event volume in a 12k-event conversation. Overlong messages keep their
  head and tail with an explicit omitted-character count; the last 400 messages are kept.
- New command `/chat-session-log --session=<id>` to export a log for an older conversation.
- New toggle in the settings page under Conversation management (on by default, shown
  only while the folder toggle is on).

### 1.1.0

- **File context menu grouped by type**: code / document / archive / image / media / executable / other,
  each with its own actions (copy code, extract here, copy file contents, file information…).
- **Link context menu**: open in default browser, open in another browser, copy URL, copy as Markdown link.
- **Links with embedded credentials are no longer silently ignored**: the menu still opens, the password is
  masked, and a confirmation dialog appears before opening.
- Right-click now also works in the **right-hand file tree**, not just deliverable cards and review rows.

### 1.0.0

First release: conversation folders, recoverable delete, batch delete, file context menu, guardrails,
backup management, checkup.

## Install

Replace `<profile>` with your profile name (usually `desktop` for the desktop app,
`web` for the browser build).

### Option 1 — tarball (recommended, no git needed)

```sh
dsh plugin --profile <profile> add https://codeload.github.com/John4874314/dsh-steward/tar.gz/refs/tags/v1.4.0
```

No local `git` required, and no direct `github.com:443` access required — it only
touches `codeload.github.com`.

### Option 2 — the `github:` shorthand

```sh
dsh plugin --profile <profile> add github:John4874314/dsh-steward
```

Requires `git` on `PATH` and reachable `github.com:443`. On mainland-China networks
`github.com` frequently times out while `api.github.com` / `codeload.github.com` work
fine; that surfaces as `ERR_PNPM_GIT_RESOLVE_FAILED`. Use Option 1 in that case.

### After installing

**Restart DSH.** The client bundle graph is built at process start, so a plain browser
hard-refresh (`Ctrl/Cmd + Shift + R`) will not pick up a new plugin.

### Requirements

- DSH **0.2.1-rc.1** or newer (verified on `0.2.1-rc.3`)
- Node ≥ 20
- Installs on Windows, macOS and Linux; extract / browser picker / terminal are Windows-only
  for now, see "Platform support" above.

### Verify it yourself before trusting it

Not trusting a third-party plugin that can delete conversations is reasonable. After installing:

```sh
git clone https://github.com/John4874314/dsh-steward && cd dsh-steward
npm test          # 6 assertions, no dependencies to install
```

Or just run the plugin's own read-only checkup: Settings → Steward → Checkup. It reads only.

## Features

### 1. Conversation management

#### One folder per new conversation (off by default)

Settings → Steward → Conversation → "Create a folder for every new conversation".

- Created on the **first message**, not on an empty session — no stray empty directories.
- Subagents do not get one (they follow the parent); path escapes are refused; illegal characters become `-`.
- The switch is instant; the config lives in `$DSH_HOME/chat-manager-config.json`.

#### An automatic `交接日志.md` handover log (on by default)

Settings → Steward → Conversation → "Write a handover log into that folder".
This toggle only appears while the folder toggle is on — without a folder there is nowhere to put it.

Each conversation's own folder gains a `交接日志.md`, meant to **hand the task to someone else
(or to yourself, days later)**:

| Section | Contents |
| --- | --- |
| Overview | session id, title, working directory, created/exported time, message counts, how much was omitted |
| Files produced | deliverables presented in this conversation, one absolute path + description per line |
| Conversation | in order: what the user said, what the assistant answered, which tools ran and whether they worked |

Deliberate choices:

- **When it writes**: once when the folder is created, then at every `turn/end` and
  `session/end-seed` — throttled to one write per 4 seconds per session, so a long
  conversation cannot flood the disk.
- **How it writes**: the whole document is regenerated and written to `.tmp` then `rename`d,
  an atomic replace — a half-written file can never be left behind.
- **Why it is not a verbatim copy**: DSH appends a `<system-reminder>` block (containing the
  full `AGENTS.md`) to every user message. Measured in a 12k-event conversation, that was
  **48%** of the raw volume, with the same rules repeated over a thousand times. The log
  strips those injected blocks and keeps only what a person actually said.
- **Overlong messages are clipped**: 4000 characters per message by default, keeping the head
  and tail and stating how many characters were dropped; at most the last 400 messages
  (earlier ones are omitted wholesale, stated at the top).
  The full original always stays in `$DSH_HOME/sessions/` — the log is a readable summary.

To export a log for an **older conversation** (predating this feature, or created while the
toggle was off):

```
/chat-session-log --session=<session id> [--force] [--folder=<path>]
```

#### Delete a conversation (recoverable)

Session row "⋯" menu → "Delete conversation".

The confirm dialog offers "also delete that conversation's folder". On confirm it:

1. archives the conversation
2. emits `api-session/removed` so the sidebar row disappears **immediately**
3. moves the session log directory **into the trash** (not deleted)
4. cleans up the archive record
5. optionally moves the folder into the trash too

> Content goes to `$DSH_HOME/trash/<id>/` with a `meta.json` recording the title, time and
> original path. The "Trash" tab can restore it or delete it for good.

#### Open that conversation's folder

Session row "⋯" menu → "Open this conversation's folder", located directly in Explorer.
Conversations with no registered folder **do not show the row at all** — no placeholder,
no dead button.

#### Batch delete

```
/chat-delete-batch --sessions=<id1,id2,...> [--with-folder]
```

Each id goes through the same delete path; everything lands in the trash, and you get
per-id success/failure detail.

#### File context menu (grouped by type)

**Right-click** a file card in a conversation, a row in the right-hand review list, or an entry in the
right-hand file tree (or `Shift+F10` / the menu key).

The menu identifies the file type first, then decides which actions to show. Common actions are always
present; type-specific ones sit in the middle.

| Type | Detected by | Type-specific actions |
| --- | --- | --- |
| **Code** | `.js .ts .py .go .rs .java .c .cpp .cs .php .sh .ps1 .sql .html .css .json .yaml …` | Copy code, copy as Markdown code block (with language tag) |
| **Document** | `.md .txt .pdf .docx .xlsx .pptx .csv .epub …` | Copy file contents |
| **Archive** | `.zip .7z .rar .tar .gz .tgz .bz2 .xz .zst …` | Extract here (refuses if the target folder exists; never overwrites) |
| **Image** | `.png .jpg .gif .webp .svg .bmp .ico .avif …` | File information |
| **Media** | `.mp4 .mkv .mov .mp3 .wav .flac .m4a …` | File information |
| **Executable** | `.exe .msi .dll .so .dylib .bin .jar .wasm …` | File information only — **no "run" entry at all** |
| **Other** | everything else | File information |

Common actions:

| Action | Notes |
| --- | --- |
| Open / Open folder / Open with… | via `remote.session.*`, **writes no session log** |
| Open in terminal | spawns a terminal at the file's directory |
| Copy path | absolute path to the clipboard |
| Copy as reference | copies `@<path>` — paste into the composer to jump there |
| Save as… | pick a directory, the host copies the file (auto-suffixes on collision) |
| Rename… | rename in place, never overwrites an existing file |
| File information | size + modified time |
| Move to trash | into `$DSH_HOME/trash/`, recoverable |

The look is liquid glass, coloured from `--dsw-alias-*` tokens, following light/dark automatically.
The type label at the top of the menu is tinted per category (code blue, archive amber, executable red),
so one glance tells you what kind of file this is.

> **Why executables get no "run" action**: the paths in this menu come from conversation content, which is
> model-influenced input. A "run" button would be a silent arbitrary-code-execution entry point, and the
> upside is far smaller than the risk.

> Open / Open folder / Open with / Copy path / Copy as reference write no log.
> Open in terminal / Save as / Rename / Move to trash / Extract / Copy contents must run on the host
> (via `/chat-file`), so they leave one command record in the conversation — the unavoidable cost of a
> browser that cannot write local files directly.

#### Link context menu

**Right-click** any `http`/`https` link in a conversation to get a link-specific set of actions:

| Action | Notes |
| --- | --- |
| Open in default browser | hands off to the OS default browser |
| Open in another browser | lists browsers registered on this machine (`StartMenuInternet`), pick one |
| Copy URL | copies the full original URL |
| Copy as Markdown link | copies `[link text](URL)` |

Only `http` and `https` are intercepted. `javascript:`, `data:` and `file:` fall through to the native
menu and never reach the open path.

**Links with embedded credentials** (`https://user:pass@host/`) are not silently ignored — that would make
right-click do nothing at all, which looks broken. Instead the menu opens normally, but:

- the URL at the top is masked: `https://user:***@host/`, so the password is never on screen
- an amber warning line appears: `⚠ This link contains credentials`
- clicking "Open in browser" shows **a confirmation dialog** explaining that the credentials will be sent
  to the destination site
- the copy actions still work, and they copy the **full original URL** (real password included) — copying
  to the clipboard is your deliberate action and should not be rewritten

Safety comes from "confirm before opening", not from "give you nothing". A silent failure teaches people
to ignore anomalies; an explicit warning makes them actually read the address.

#### Image context menu

Right-click an image in a conversation (`.png` / `.jpg` / `.jpeg` / `.webp` / `.gif` / `.svg` /
`.bmp` / `.avif`):

| Action | What it does |
| --- | --- |
| Open image | Opens it in the system default viewer |
| Show in folder | Selects the file in Explorer / Finder |
| Save as… | Copies it to a folder you pick (name collisions get a number) |
| Copy image | Puts the image on the clipboard, ready to paste |
| Copy file name | Copies the original name, e.g. `image.png` |

> Why the indirection: the image on screen is a `blob:` URL, and the browser will not hand you its
> disk path. The plugin hashes the bytes to sha256 and the host looks the original up by content
> address under `$DSH_HOME/attachments/v1/`. DSH already stores attachments by sha256, so the hash
> is the natural primary key — which avoids pushing 80KB of base64 through a command (that would
> flood the conversation log with garbage).

#### Paths in a message are right-clickable too

Right-click a path in the message body and get "open / show in folder / save as / copy path":

```
E:\islet\docs\handover.md
@docs/PRD.md
./notes.md
~/Documents/a.pdf
```

- Relative paths (`@docs/PRD.md`, `./notes.md`) resolve against **this conversation's working
  directory**, so references you pasted straight in still open.
- It only triggers when the pointer is genuinely on that piece of text and the text looks like a
  complete path. A bare `docs/PRD.md`, `https://…`, or ordinary prose never triggers — fewer menus
  is better than a menu on every sentence.
- Selecting a path and then right-clicking works as well (the selection wins).

### 2. The guardrails (three rules) — **off by default, you turn it on**

> **Off by default.** Installing this plugin does **not** touch your `$DSH_HOME/AGENTS.md`.
> To use the three rules, go to Settings → Steward → Guardrails → "Enable the three-rule baseline".
> Only then does it write into the global file. Turning it off stops injecting; the block already
> written stays in the file until you remove it.

Once on, it writes three rules into **`$DSH_HOME/AGENTS.md`** (DSH's global instruction file), so
**every workspace and every new session** carries them, and a harness upgrade does not lose them:

1. **Do not break DSH or the machine** — never touch the install directory, profile config,
   session credentials or system settings; never weaken security to get a task done.
2. **Verify before anything risky** — state "what changes / worst case / how to undo" first;
   prefer a small trial over a full run.
3. **Keep backups so you can roll back** — back up before editing, confirm the rollback path
   exists, verify after, and roll back if verification fails.

The text is in [`AGENTS.guardrails.md`](./AGENTS.guardrails.md).

> This bundle's patch **re-enables** `agent-instructions` (the web-app bundle disables it),
> otherwise the rules would reach `AGENTS.md` but never the context. Side effect: a project's
> own `AGENTS.md` / `CLAUDE.md` also enters the context. This part is independent of the toggle
> above — it is bundle-level, active as soon as you install. If you want only the folder and
> context-menu features and do not want the agent reading project `AGENTS.md` files at all,
> delete the `agent-instructions` section from `cordis.patch.yml` before installing.

### 3. Five settings tabs

| Tab | Contents |
| --- | --- |
| Conversation | the one-folder-per-conversation switch and the handover-log switch |
| Trash | list / restore / delete for good / empty, with each entry's size |
| Backups | backup directory location and size, **empty it** or **open the folder** — your call |
| Guardrails | the switch, full text, a preview of the write result, restore from the built-in copy |
| Checkup | a read-only self-check: guardrail block / form / config / registry / trash / backups |

#### Backups are yours to keep or delete

Writing `AGENTS.md` backs up first to `$DSH_HOME/backups/`, and those backups stay on disk.
The "Backups" tab therefore offers **Empty** or **Open folder** and lets you decide.
The plugin never deletes them for you — that is irreversible, and the call should be yours.

#### What the checkup reports

| Check | Meaning |
| --- | --- |
| `guardrails` | is the block present, are the markers paired, are old markers left over |
| `config-schema` | is schemastery available (no schema means no settings form) |
| `config-file` | can the config file be read, what are the current switches |
| `folder-registry` | how many registry entries point at directories that no longer exist |
| `trash` | trash entry count and size |
| `backups` | backup entry count and size |

Everything is read-only; no file is modified.

## Why it cannot take the harness down

This is the design goal the plugin cares most about — **any failure shows up as "one feature
missing", never as a broken DSH**:

- **The host half degrades without Config**: schemastery is resolved at runtime (local first,
  then the profile); if it cannot be found the plugin exports `Config = undefined` and still
  loads, just without a settings form.
- **The guardrail write is wrapped in try/catch**, and `apply` ends in `catch(() => {})` —
  any failure is merely "it did not get written".
- **`AGENTS.md` is backed up** to `$DSH_HOME/backups/` before writing; if the backup fails,
  the write is abandoned.
- **Idempotent**: located by `<!-- dsh-steward:begin/end -->`, only its own block is replaced;
  it also cleans up the `guardrails:begin/end` block left by the older guardrails plugin.
- **Client integrations are weak references**: any other plugin (e.g. `dsh-better-sidebar`) is
  probed with `ctx.get(...)` inside try/catch, and skipped when absent.

Fault injection has been exercised: a missing `DSH_HOME`, a null `config`, missing
dependencies, and a repeated `apply` all raise nothing.

## On trust: what this plugin touches, and what it does not

A third-party plugin that can delete conversations and write files should be questioned before
it is trusted. Here is exactly what it does.

**Files it writes** (all only after you enable the relevant toggle):

| Path | When | Reversible |
| --- | --- | --- |
| `$DSH_HOME/chat-manager-config.json` | you flip a switch in settings | yes, it is just JSON |
| conversation folder + its `交接日志.md` | after you enable "folder per conversation" | yes, delete them |
| between `<!-- dsh-steward:begin/end -->` in `$DSH_HOME/AGENTS.md` | after you turn on "three rules" | yes, turn it off and remove that block |
| `$DSH_HOME/backups/` | automatic backup before each `AGENTS.md` write | yes, one-click clear in settings |
| `$DSH_HOME/trash/` | delete conversation / file **moves** content here | yes, restore from settings |

**What it deliberately does not do**:

- No network access. The plugin contains no `fetch` / `http` / `net` call and uploads nothing.
- Does not read data outside `$DSH_HOME/sessions/`; it reads sessions only to build the handover
  log, through DSH's official `sessionController.inspect()` channel, not by parsing disk.
- Does not modify the DSH install directory, `cordis.yml` / `cordis.patch.yml`, or system settings.
- Deletion always goes through the trash, never a direct `rm`; emptying the trash needs a second
  confirmation.

**Known rough edges** (stated here rather than hidden):

- Single-file plugin: `index.js` ~2,600 lines, `client.js` ~2,400 lines, not split into modules.
- Only 6 contract assertions, covering name consistency / defaults / module loading —
  **UI interaction is not covered**.
- Windows-first: three features are hidden on other platforms rather than reimplemented.
- Not on npm; install from git or a tarball.

## Configuration

The config file is `$DSH_HOME/chat-manager-config.json`:

```json
{
  "folder": {
    "enabled": false,
    "trigger": "first-message",
    "template": "chat-{date}-{time}",
    "useAsWorkingDirectory": false
  },
  "guardrails": {
    "install": false
  },
  "sessionLog": {
    "enabled": true,
    "maxMessages": 400,
    "includeTools": true
  }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `folder.enabled` | `false` | create a folder for every new conversation |
| `folder.trigger` | `first-message` | `first-message` or `session-start` |
| `folder.template` | `chat-{date}-{time}` | supports `{date}` `{time}` `{title}` `{id}` |
| `folder.useAsWorkingDirectory` | `false` | switch the conversation's cwd to the new folder |
| `guardrails.install` | **`false`** | write the three rules into the global `AGENTS.md` |
| `sessionLog.enabled` | `true` | write `交接日志.md` into the conversation folder |
| `sessionLog.maxMessages` | `400` | how many messages to export (0 = unlimited, keeps the latest) |
| `sessionLog.includeTools` | `true` | include tool calls and results in the log |

> The settings page exposes `folder.enabled`, `sessionLog.enabled` and `guardrails.install`;
> the rest needs a hand edit of this JSON. Restart DSH afterwards.

## Uninstall

Settings → Plugins → Installed → Remove.

The guardrail block in `$DSH_HOME/AGENTS.md` is **not** removed automatically (it is your
file). Delete the content between `<!-- dsh-steward:begin -->` and `<!-- dsh-steward:end -->`
if you want it gone.

> The schemastery link under `node_modules/` only powers the settings form;
> removing it degrades the settings page, it does not crash the plugin.

## License

[MIT](./LICENSE)
