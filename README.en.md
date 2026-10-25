# dsh-steward · Conversation Steward

[![npm](https://img.shields.io/npm/v/dsh-steward)](https://www.npmjs.com/package/dsh-steward)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.1%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)

> A conversation steward for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
> one folder per conversation, a **recoverable** delete, type-aware right-click file actions,
> a right-click menu for links, and a three-rule safety baseline written into the global `AGENTS.md`.

🌏 [中文](./README.md) · **English**

---

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
dsh plugin --profile <profile> add https://codeload.github.com/John4874314/dsh-steward/tar.gz/refs/tags/v1.0.0
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

> Not published to npm yet. `dsh plugin add dsh-steward` will not resolve — use one of
> the two options above.

## Features

### 1. Conversation management

#### One folder per new conversation (off by default)

Settings → Steward → Conversation → "Create a folder for every new conversation".

- Created on the **first message**, not on an empty session — no stray empty directories.
- Subagents do not get one (they follow the parent); path escapes are refused; illegal characters become `-`.
- The switch is instant; the config lives in `$DSH_HOME/chat-manager-config.json`.

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

### 2. The guardrails (three rules)

Settings → Steward → Guardrails → "Enable the three-rule baseline".

It writes three rules into **`$DSH_HOME/AGENTS.md`** (DSH's global instruction file), so
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
> own `AGENTS.md` / `CLAUDE.md` also enters the context.

### 3. Five settings tabs

| Tab | Contents |
| --- | --- |
| Conversation | the one-folder-per-conversation switch |
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
    "install": true
  }
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `folder.enabled` | `false` | create a folder for every new conversation |
| `folder.trigger` | `first-message` | `first-message` or `session-start` |
| `folder.template` | `chat-{date}-{time}` | supports `{date}` `{time}` `{title}` `{id}` |
| `folder.useAsWorkingDirectory` | `false` | switch the conversation's cwd to the new folder |
| `guardrails.install` | `true` | write the three rules into the global `AGENTS.md` |

> The settings page exposes only `folder.enabled` and `guardrails.install`;
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
