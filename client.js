/**
 * dsh-steward (Client half)
 *
 * 1. 设置页（设置 → 对话管理）：开关「每个新对话创建一个文件夹」。
 * 2. 每个对话「⋯」菜单里增加一行「删除对话」（原有「归档」行不动）。
 * 3. 点「删除对话」→ 屏幕正中弹出确认框，可勾选「同时删除该对话的文件夹」。
 *    关闭按钮 / 取消 / Esc / 点遮罩 = 取消本次操作。
 *
 * 与宿主的所有交互都走「会话命令」这一条已验证可用的通道：
 *   sessions.using(sessionId, ...).command('/chat-delete ...')
 * 它自己负责把冷会话打开，不依赖 scope()（未打开的会话会返回 undefined）。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-steward',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    /**
     * 订阅外部 store 的 hook。
     * 不用 React.useSyncExternalStore：浏览器侧的 React 子集未必暴露它，
     * 缺失时组件渲染会直接抛错，表现为槽位整块空白。
     */
    function useExternalStore(store) {
      const [value, setValue] = useState(() => store.get())
      useEffect(() => {
        const sync = () => setValue(store.get())
        sync()
        return store.subscribe(sync)
      }, [store])
      return value
    }

    /* ---------------- 文案 ---------------- */

    const TEXT = {
      zh: {
        nav: '对话管家',
        title: '对话管家',
        hint: '控制每个新对话是否在工作区里自动创建一个独立文件夹。',
        groupConversation: '对话管理',
        groupGuardrails: '运行守则',
        toggleFolder: '每个新对话创建一个文件夹',
        toggleFolderHint: '在新对话的工作区目录下自动建一个独立文件夹',
        toggleSessionLog: '在文件夹里写「交接日志.md」',
        toggleSessionLogHint: '把当前对话的来龙去脉导出成一份文档，方便交接给下一个接手的人',
        toggleGuardrails: '启用运行三原则',
        toggleGuardrailsHint: '写进 AGENTS.md，对所有工作区生效；关掉后不再注入',
        on: '已开启',
        off: '已关闭',
        saveFailed: '保存失败，请重试。',
        readFailed: '读取设置失败。',
        menu: '删除对话',
        menuOpenFolder: '打开该对话的文件夹',
        dialogTitle: '删除对话',
        dialogLine1: '该对话会从侧边栏移除，对话记录将被永久删除，此操作无法撤销。',
        dialogLine2: '是否同时删除该对话的文件夹？',
        withFolder: '同时删除该对话的文件夹',
        withFolderHint: '文件夹及其中的全部内容都会被删除。',
        folderUnknown: '（该对话没有可识别的文件夹）',
        querying: '正在查询该对话的文件夹…',
        confirm: '删除',
        cancel: '取消',
        working: '正在删除…',
        close: '关闭',
        failed: '删除失败',
        done: '已删除',

        fileMenu: '文件操作',
        openFile: '打开',
        openFolder: '打开文件夹',
        copyPath: '复制路径',
        saveAs: '另存为…',
        chooseApp: '选择打开方式',
        chooseAppHint: '列出这台电脑上可以打开该文件的应用',
        defaultApp: '默认',
        noApps: '没有找到可用的打开方式',
        copied: '路径已复制',
        noPath: '取不到这个文件的路径',
        noPicker: '当前环境无法选择保存目录',
        savedTo: '已保存到',
        noDesktop: '当前环境不支持在桌面打开文件',
        openFailed: '打开失败',
        openTerminal: '在终端中打开',
        copyRef: '复制为引用',
        copyRefDone: '引用已复制',
        rename: '重命名…',
        renameTitle: '重命名',
        renameHint: '输入新的文件名（含扩展名）',
        renameDone: '已重命名',
        moveToTrash: '移到回收站',
        moveToTrashDone: '已移到回收站',
        renameFailed: '重命名失败',
        trashFailed: '移到回收站失败',

        /* ---- 文件类型分组 ---- */
        kindImage: '图片',
        kindCode: '代码',
        kindDoc: '文档',
        kindArchive: '压缩包',
        kindMedia: '音视频',
        kindBinary: '可执行文件',
        kindOther: '文件',

        /* ---- 类型专属动作 ---- */
        openInEditor: '用编辑器打开',
        openWithOffice: '用 Office 打开',
        copyContent: '复制文件内容',
        copyContentDone: '内容已复制',
        copyCode: '复制代码',
        copyCodeDone: '代码已复制',
        copyAsMarkdown: '复制为 Markdown 代码块',
        copyAsMarkdownDone: '已复制为 Markdown',
        extractHere: '解压到此处',
        extractDone: '已解压到',
        extractFailed: '解压失败',
        extractExists: '同名目录已存在，先处理它再解压',
        showInfo: '文件信息',
        fileSize: '大小',
        modifiedAt: '修改时间',
        tooLargeToCopy: '文件太大，无法复制内容',
        noContent: '读不到文件内容',

        /* ---- 网址菜单 ---- */
        urlMenu: '网址',
        openInBrowser: '在默认浏览器打开',
        openInBrowserNamed: '用 {name} 打开',
        copyUrl: '复制网址',
        copyUrlDone: '网址已复制',
        copyUrlMarkdown: '复制为 Markdown 链接',
        copyUrlMarkdownDone: '已复制为 Markdown 链接',
        chooseBrowser: '用其它浏览器打开',
        noBrowsers: '没有找到其它浏览器',
        urlFailed: '打开网址失败',
        urlNotAllowed: '只支持 http/https 网址',
        credUrlBadge: '⚠ 这个网址包含账号密码',
        credUrlWarning: '这个网址把账号密码直接写在地址里（密码已用 *** 隐藏）。\n打开它会把凭据发送给目标站点，请确认来源可信。\n\n确定要在浏览器中打开吗？',

        /* ---- 文件树 ---- */
        treeMenu: '文件树',
        refreshTree: '刷新文件列表',

        tabs: { conversation: '对话', trash: '回收站', backup: '备份', guardrails: '运行守则', doctor: '体检' },
        sidebarTabDesc: '对话管家：回收站、备份、运行守则与体检',
        refresh: '刷新',
        loading: '正在读取…',
        emptyTrash: '回收站是空的',
        trashHint: '删除的对话会先放在这里，可以恢复。清空后不可恢复。',
        trashCount: '{n} 条，占 {size}',
        restore: '恢复',
        purge: '彻底删除',
        emptyAll: '清空回收站',
        purgeConfirm: '彻底删除后无法恢复，确定吗？',
        emptyConfirm: '将清空回收站里的全部条目，无法恢复。确定吗？',
        restored: '已恢复',
        purged: '已彻底删除',
        emptied: '已清空',
        withFolderTag: '含文件夹',
        noFolderTag: '仅记录',
        kindFile: '文件',

        backupHint: '写入 AGENTS.md 等操作前会自动备份到这里。备份会一直留着，占你的磁盘，所以由你自己决定清不清。',
        backupDir: '位置',
        backupUsage: '占用',
        backupEmpty: '还没有备份文件',
        clearBackups: '一键清空备份',
        openBackupDir: '打开备份文件夹',
        clearBackupConfirm: '将删除备份目录下的全部文件，无法恢复。确定吗？',
        backupCleared: '备份已清空',
        openDirFailed: '打不开文件夹',

        guardHint: '下面是写进全局 AGENTS.md 的三原则。',
        guardInstalled: '已写入 AGENTS.md',
        guardNotInstalled: '尚未写入',
        guardPreview: '预览写入结果',
        guardRestore: '用内置版本恢复',
        guardRestoreConfirm: '将用插件内置的版本覆盖 AGENTS.md 里的守则段（覆盖前自动备份）。确定吗？',
        guardRestored: '已恢复默认守则',
        guardShowFull: '展开全文',
        guardHideFull: '收起',

        doctorRun: '开始体检',
        doctorRunning: '正在检查…',
        doctorOk: '没有发现问题',
        doctorProblems: '{n} 项需要注意',
        doctorHint: '全部只读，不会改动任何文件。',
        doctorAt: '检查时间',
        statusOk: '正常',
        statusWarn: '注意',
        statusInfo: '信息',
      },
      en: {
        nav: 'Steward',
        title: 'Steward',
        hint: 'Choose whether every new conversation gets its own folder in the workspace.',
        groupConversation: 'Conversations',
        groupGuardrails: 'Safety guardrails',
        toggleFolder: 'Create a folder for each new conversation',
        toggleFolderHint: 'Give each new conversation its own folder inside the workspace',
        toggleSessionLog: 'Write a handover log into that folder',
        toggleSessionLogHint: 'Export what this conversation did into one document the next person can pick up',
        toggleGuardrails: 'Enable the three-rule safety baseline',
        toggleGuardrailsHint: 'Written into AGENTS.md for every workspace; turning it off stops injecting it',
        on: 'On',
        off: 'Off',
        saveFailed: 'Could not save. Please retry.',
        readFailed: 'Could not read settings.',
        menu: 'Delete conversation',
        menuOpenFolder: 'Open this conversation\u2019s folder',
        dialogTitle: 'Delete conversation',
        dialogLine1: 'The row leaves the sidebar and the conversation record is removed permanently. This cannot be undone.',
        dialogLine2: 'Delete this conversation\u2019s folder as well?',
        withFolder: 'Also delete this conversation\u2019s folder',
        withFolderHint: 'The folder and everything inside it will be deleted.',
        folderUnknown: '(no folder is known for this conversation)',
        querying: 'Looking up this conversation\u2019s folder…',
        confirm: 'Delete',
        cancel: 'Cancel',
        working: 'Deleting…',
        close: 'Close',
        failed: 'Delete failed',
        done: 'Deleted',

        fileMenu: 'File actions',
        openFile: 'Open',
        openFolder: 'Open containing folder',
        copyPath: 'Copy path',
        saveAs: 'Save as…',
        chooseApp: 'Open with…',
        chooseAppHint: 'List the applications on this computer that can open the file',
        defaultApp: 'default',
        noApps: 'No application is available for this file',
        copied: 'Path copied',
        noPath: 'This file has no resolvable path',
        noPicker: 'This environment cannot choose a save folder',
        savedTo: 'Saved to',
        noDesktop: 'This environment cannot open files on the desktop',
        openFailed: 'Open failed',
        openTerminal: 'Open in terminal',
        copyRef: 'Copy as reference',
        copyRefDone: 'Reference copied',
        rename: 'Rename…',
        renameTitle: 'Rename',
        renameHint: 'Enter the new file name, including its extension',
        renameDone: 'Renamed',
        moveToTrash: 'Move to trash',
        moveToTrashDone: 'Moved to trash',
        renameFailed: 'Rename failed',
        trashFailed: 'Could not move to trash',

        kindImage: 'Image',
        kindCode: 'Code',
        kindDoc: 'Document',
        kindArchive: 'Archive',
        kindMedia: 'Media',
        kindBinary: 'Executable',
        kindOther: 'File',

        openInEditor: 'Open in editor',
        openWithOffice: 'Open with Office',
        copyContent: 'Copy file contents',
        copyContentDone: 'Contents copied',
        copyCode: 'Copy code',
        copyCodeDone: 'Code copied',
        copyAsMarkdown: 'Copy as Markdown code block',
        copyAsMarkdownDone: 'Copied as Markdown',
        extractHere: 'Extract here',
        extractDone: 'Extracted to',
        extractFailed: 'Extraction failed',
        extractExists: 'A folder with that name already exists',
        showInfo: 'File information',
        fileSize: 'Size',
        modifiedAt: 'Modified',
        tooLargeToCopy: 'File is too large to copy',
        noContent: 'Could not read the file',

        urlMenu: 'Link',
        openInBrowser: 'Open in default browser',
        openInBrowserNamed: 'Open in {name}',
        copyUrl: 'Copy link',
        copyUrlDone: 'Link copied',
        copyUrlMarkdown: 'Copy as Markdown link',
        copyUrlMarkdownDone: 'Copied as Markdown link',
        chooseBrowser: 'Open in another browser',
        noBrowsers: 'No other browser found',
        urlFailed: 'Could not open the link',
        urlNotAllowed: 'Only http/https links are supported',
        credUrlBadge: '⚠ This link contains credentials',
        credUrlWarning: 'This link puts a username and password directly in the address (the password is masked as ***).\nOpening it sends those credentials to the destination site. Make sure you trust it.\n\nOpen it in the browser?',

        treeMenu: 'Files',
        refreshTree: 'Refresh file list',

        tabs: { conversation: 'Conversation', trash: 'Trash', backup: 'Backups', guardrails: 'Guardrails', doctor: 'Checkup' },
        sidebarTabDesc: 'Steward: trash, backups, guardrails and checkup',
        refresh: 'Refresh',
        loading: 'Loading…',
        emptyTrash: 'The trash is empty',
        trashHint: 'Deleted conversations land here first and can be restored. Emptying it is permanent.',
        trashCount: '{n} items, {size}',
        restore: 'Restore',
        purge: 'Delete permanently',
        emptyAll: 'Empty trash',
        purgeConfirm: 'Permanent deletion cannot be undone. Continue?',
        emptyConfirm: 'This empties every item in the trash permanently. Continue?',
        restored: 'Restored',
        purged: 'Permanently deleted',
        emptied: 'Emptied',
        withFolderTag: 'with folder',
        noFolderTag: 'record only',
        kindFile: 'file',

        backupHint: 'Writes to AGENTS.md and similar files are backed up here first. Backups stay on disk and take space, so clearing them is your call.',
        backupDir: 'Location',
        backupUsage: 'Usage',
        backupEmpty: 'No backups yet',
        clearBackups: 'Clear all backups',
        openBackupDir: 'Open backup folder',
        clearBackupConfirm: 'This deletes every file under the backup folder permanently. Continue?',
        backupCleared: 'Backups cleared',
        openDirFailed: 'Could not open the folder',

        guardHint: 'The three rules written into the global AGENTS.md.',
        guardInstalled: 'Written into AGENTS.md',
        guardNotInstalled: 'Not written yet',
        guardPreview: 'Preview the result',
        guardRestore: 'Restore the built-in version',
        guardRestoreConfirm: 'This overwrites the guardrail block in AGENTS.md with the built-in version (a backup is taken first). Continue?',
        guardRestored: 'Built-in guardrails restored',
        guardShowFull: 'Show full text',
        guardHideFull: 'Collapse',

        doctorRun: 'Run checkup',
        doctorRunning: 'Checking…',
        doctorOk: 'No problems found',
        doctorProblems: '{n} items need attention',
        doctorHint: 'Read-only: it changes nothing.',
        doctorAt: 'Checked at',
        statusOk: 'OK',
        statusWarn: 'Attention',
        statusInfo: 'Info',
      },
    }

    /* ---------------- 样式 ---------------- */

    const S = {
      page: { maxWidth: '620px', font: 'inherit' },
      title: { margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      hint: { margin: '0 0 16px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
      row: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
        padding: '12px 14px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
      },
      rowText: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
      rowHint: { fontSize: '11.5px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
      groupTitle: {
        margin: '18px 0 8px', fontSize: '12px', fontWeight: 600,
        letterSpacing: '0.03em', color: 'var(--dsw-alias-label-secondary)',
      },
      sw: (on, busy) => ({
        position: 'relative', flex: '0 0 auto', width: '38px', height: '22px',
        borderRadius: '11px', border: 'none', padding: 0,
        cursor: busy ? 'progress' : 'pointer',
        background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
        opacity: busy ? 0.7 : 1, transition: 'background 120ms ease',
      }),
      knob: (on) => ({
        position: 'absolute', top: '2px', left: on ? '18px' : '2px',
        width: '18px', height: '18px', borderRadius: '50%',
        background: 'var(--dsw-alias-bg-base)', transition: 'left 120ms ease',
      }),
      err: { marginTop: '8px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' },
      // 遮罩：深色下沉、浅色轻压。真实取值在样式表里按 scheme 切换，
      // 这里只放一个 rgba 兜底（老内核没有 color-mix 时也能用）。
      scrim: {
        position: 'fixed', inset: 0, zIndex: 400,
        display: 'grid', placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.42)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        pointerEvents: 'auto',
      },
      card: {
        width: 'min(420px, calc(100vw - 48px))', boxSizing: 'border-box',
        borderRadius: '14px', padding: '20px 22px 18px',
        border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 75%, transparent)',
        // 与右键菜单同一套玻璃配方，视觉上保持一致
        background: 'color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent)',
        boxShadow:
          'inset 0 1px 0 0 rgba(255, 255, 255, 0.18),'
          + ' inset 0 -1px 0 0 rgba(0, 0, 0, 0.22),'
          + ' 0 1px 2px rgba(0, 0, 0, 0.06),'
          + ' 0 16px 34px -10px rgba(0, 0, 0, 0.28),'
          + ' 0 40px 72px -28px rgba(0, 0, 0, 0.34)',
        backdropFilter: 'blur(22px) saturate(180%)', WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        font: 'inherit', color: 'var(--dsw-alias-label-primary)',
      },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' },
      h3: { margin: 0, fontSize: '14px', fontWeight: 600 },
      x: {
        flex: '0 0 auto', width: '24px', height: '24px', borderRadius: '6px',
        border: 'none', background: 'transparent', cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary)', fontSize: '14px', lineHeight: '24px', padding: 0,
      },
      body: { margin: '0 0 8px', fontSize: '12.5px', lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' },
      check: (disabled) => ({
        display: 'flex', alignItems: 'flex-start', gap: '8px',
        padding: '10px 12px', marginTop: '4px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }),
      checkLabel: { display: 'block', fontSize: '12.5px', color: 'var(--dsw-alias-label-primary)' },
      checkHint: { display: 'block', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' },
      foot: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' },
      ghost: (disabled) => ({
        padding: '6px 14px', borderRadius: '8px', font: 'inherit', fontSize: '12.5px',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
        color: 'var(--dsw-alias-label-primary)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }),
      danger: (disabled) => ({
        padding: '6px 14px', borderRadius: '8px', font: 'inherit', fontSize: '12.5px',
        border: '1px solid transparent',
        background: disabled ? 'var(--dsw-alias-border-l2)' : 'var(--dsw-alias-state-error-primary)',
        color: disabled ? 'var(--dsw-alias-state-idle-primary)' : 'var(--dsw-alias-bg-base)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }),
      menuRow: {
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '7px 10px', borderRadius: '6px', border: 'none',
        background: 'transparent', font: 'inherit', fontSize: '12.5px',
        color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', textAlign: 'left',
      },
      menuItem: {
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '7px 10px', borderRadius: '6px', border: 'none',
        background: 'transparent', font: 'inherit', fontSize: '12.5px',
        color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', textAlign: 'left',
      },

      /* 标签页导航 */
      tabs: { display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '0 0 16px', padding: '3px', borderRadius: '10px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)' },
      tab: (active) => ({
        padding: '5px 11px', borderRadius: '7px', border: 'none', font: 'inherit', fontSize: '12.5px',
        background: active ? 'var(--dsw-alias-bg-overlay)' : 'transparent',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        fontWeight: active ? 600 : 450, cursor: 'pointer',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.10)' : 'none',
      }),

      /* 列表项（回收站条目等） */
      item: {
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
        padding: '10px 12px', borderRadius: '8px', marginBottom: '6px',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
      },
      itemMain: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: '1 1 auto' },
      itemTitle: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      itemMeta: { fontSize: '11.5px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
      itemActions: { display: 'flex', gap: '6px', flex: '0 0 auto' },

      /* 小按钮 */
      small: (danger) => ({
        padding: '4px 10px', borderRadius: '7px', font: 'inherit', fontSize: '12px',
        border: `1px solid ${danger ? 'transparent' : 'var(--dsw-alias-border-l1)'}`,
        background: danger ? 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent)' : 'transparent',
        color: danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
        cursor: 'pointer', whiteSpace: 'nowrap',
      }),

      /* 只读代码块（守则全文 / 预览） */
      pre: {
        margin: '8px 0 0', padding: '12px 14px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '11.5px', lineHeight: '17px', color: 'var(--dsw-alias-label-primary)',
        maxHeight: '360px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },

      /* 体检结果行 */
      checkRow: (status) => ({
        display: 'flex', gap: '10px', alignItems: 'flex-start',
        padding: '9px 12px', borderRadius: '8px', marginBottom: '6px',
        border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
        borderLeft: `3px solid ${
          status === 'ok' ? 'var(--dsw-alias-state-success-primary)'
            : status === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
              : 'var(--dsw-alias-border-l2)'}`,
      }),
      checkText: { fontSize: '12.5px', lineHeight: '18px', color: 'var(--dsw-alias-label-primary)' },
      checkSub: { fontSize: '11.5px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)', marginTop: '2px' },
      badge: (status) => ({
        flex: '0 0 auto', padding: '1px 7px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 600,
        color: status === 'ok' ? 'var(--dsw-alias-state-success-primary)'
          : status === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
            : 'var(--dsw-alias-label-secondary)',
        background: 'color-mix(in srgb, currentColor 14%, transparent)',
        marginTop: '1px', whiteSpace: 'nowrap',
      }),
      kv: { display: 'flex', gap: '8px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' },
      kvKey: { flex: '0 0 auto', minWidth: '52px', color: 'var(--dsw-alias-label-secondary)' },
      kvVal: { color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '11.5px' },
      rowActions: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' },
      toolBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', margin: '0 0 10px' },

      /* 文件右键菜单的样式在注入的样式表里（见 STYLE_ID），
         这里只保留尺寸计算需要的常量。 */
    }

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
        get() { return state },
        set(next) { state = next; for (const listener of [...listeners]) listener() },
      }
    }

    return {
      // remote.commands 必须声明：客户端 Context 是受限代理，未注入的服务访问会直接
      // 抛 "cannot get property ... without inject"，用 ctx.get 也绕不过去。
      // 客户端 Context 是受限代理：凡是要通过 ctx.remote 访问的命名空间，
      // 都必须在这里逐个声明，否则运行到那一行才抛
      // "cannot get property ... without inject"。用 ctx.get 也绕不过去。
      inject: [
        'slots',
        'sessions',
        'locale',
        'theme',                // 读当前明暗，决定玻璃高光/阴影强度
        'remote',
        'remote.commands',      // /chat-config、/chat-folder、/chat-delete、/chat-file
        'remote.session',       // openWorkspacePath / workspacePathApplications
        'remote.directoryPicker', // 另存为时选目录
      ],

      apply(ctx) {
        const dialogStore = createStore(null)

        const t = (key) => {
          let table = TEXT.zh
          try {
            const snapshot = ctx.locale?.getLocale?.() ?? ctx.locale?.getSnapshot?.()
            const id = String(snapshot?.id ?? snapshot?.locale ?? '').toLowerCase()
            if (id.length > 0 && !id.startsWith('zh')) table = TEXT.en
          } catch {
            // 读不到语言就用中文
          }
          return table[key] ?? TEXT.zh[key] ?? key
        }

        const useDialog = () => useExternalStore(dialogStore)

        /**
         * 注入样式表。
         *
         * 右键菜单需要 :hover、滚动条、动效这些内联样式表达不了的规则，
         * 所以用一张 <style> 承载；颜色全部取 --dsw-alias-* 令牌，
         * 深浅色切换时随主题自动变化，不需要额外监听。
         */
        const STYLE_ID = 'dsh-steward-style'
        if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin="${STYLE_ID}"]`) === null) {
          const style = document.createElement('style')
          style.dataset.plugin = STYLE_ID
          style.textContent = `
/* 文件右键菜单：液态玻璃质感
 *
 * 设计要点：
 *  1. 颜色都从主题令牌里取，并做成半透明 —— 背景透出下层内容，
 *     自然就和周围融为一体（浅色主题下是浅玻璃，深色下是深玻璃）。
 *  2. 玻璃感靠三件事：背景模糊 + 饱和提升、顶部高光内描边、底部柔和压暗。
 *     高光/压暗的强弱按 colorScheme 切换（见 [data-cm-scheme]），
 *     否则浅色主题上白光会糊成一片、深色主题上黑边会显脏。
 *  3. 文字统一用 label-primary / label-secondary 的最高对比档，
 *     不额外加 opacity，保证玻璃底上依然清楚。
 */
.cm-ctxmenu {
  /* 玻璃配方：这两个变量按主题覆盖 */
  --cm-glass-tint: var(--dsw-alias-bg-overlay);
  --cm-glass-alpha: 74%;
  --cm-hi: rgba(255, 255, 255, 0.20);
  --cm-lo: rgba(0, 0, 0, 0.26);

  position: fixed;
  z-index: 500;
  min-width: 216px;
  max-width: 348px;
  max-height: min(70vh, 470px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  pointer-events: auto;
  border-radius: 12px;

  /* 一层极细的主题色描边 + 一层高光描边，模拟玻璃边缘 */
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 75%, transparent);

  /* 底色半透明 + 斜向高光，叠出"一块玻璃"而不是一块色块 */
  background-color: color-mix(in srgb, var(--cm-glass-tint) var(--cm-glass-alpha), transparent);
  background-image: linear-gradient(
    155deg,
    color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent) 0%,
    transparent 38%
  );

  box-shadow:
    inset 0 1px 0 0 var(--cm-hi),                 /* 顶部玻璃高光 */
    inset 0 -1px 0 0 var(--cm-lo),                /* 底部轻微压暗 */
    0 1px 1px rgba(0, 0, 0, 0.05),
    0 10px 24px -8px rgba(0, 0, 0, 0.22),
    0 28px 56px -20px rgba(0, 0, 0, 0.28);

  backdrop-filter: blur(22px) saturate(180%);
  -webkit-backdrop-filter: blur(22px) saturate(180%);

  font: inherit;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  animation: cm-menu-in 130ms cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: top left;
}

/* 浅色主题：白光更强、黑影更轻，才有玻璃的清透感 */
.cm-ctxmenu[data-cm-scheme="light"] {
  --cm-glass-alpha: 78%;
  --cm-hi: rgba(255, 255, 255, 0.85);
  --cm-lo: rgba(15, 23, 42, 0.08);
  box-shadow:
    inset 0 1px 0 0 var(--cm-hi),
    inset 0 -1px 0 0 var(--cm-lo),
    0 1px 1px rgba(15, 23, 42, 0.04),
    0 10px 24px -8px rgba(15, 23, 42, 0.14),
    0 28px 56px -20px rgba(15, 23, 42, 0.18);
}

/* 不支持 backdrop-filter 的老内核：退回不透明底色，保证可读 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .cm-ctxmenu {
    background-color: var(--dsw-alias-bg-overlay);
    background-image: none;
  }
}

@keyframes cm-menu-in {
  from { opacity: 0; transform: scale(0.96) translateY(-3px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .cm-ctxmenu { animation: none; }
}

.cm-ctxmenu::-webkit-scrollbar { width: 9px; }
.cm-ctxmenu::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 45%, transparent);
  border-radius: 5px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.cm-ctxmenu::-webkit-scrollbar-track { background: transparent; }

/* 顶部路径：等宽小字，作为"这是哪个文件"的锚点 */
.cm-path {
  margin: 0 0 5px;
  padding: 5px 10px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 80%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  font-weight: 450;
  line-height: 16px;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 菜单项：字号提到 13px、行高 20，玻璃底上更好读 */
.cm-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 450;
  line-height: 20px;
  letter-spacing: 0.01em;
  text-align: left;
  cursor: pointer;
  transition: background-color 100ms ease, box-shadow 100ms ease;
}
.cm-item:hover:not(:disabled),
.cm-item:focus-visible:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-border-l1) 60%, transparent);
  outline: none;
}
.cm-item:active:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
}
.cm-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.cm-item[data-danger="true"] { color: var(--dsw-alias-state-error-primary); }

/* 分组小标题 */
.cm-group {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}

/* 菜单里作为第一行的类型标签：紧跟在路径下面，所以上间距收一点 */
.cm-path + .cm-group { padding-top: 2px; }

/* 带账号密码的网址：整块用警示色，提醒用户这条链接会把凭据发出去 */
.cm-ctxmenu[data-cm-credential="true"] .cm-path {
  color: var(--dsw-alias-state-warn-primary);
}
.cm-group.cm-cred {
  padding-top: 2px;
  padding-bottom: 6px;
  color: var(--dsw-alias-state-warn-primary);
  text-transform: none;
  letter-spacing: 0.01em;
  font-size: 11.5px;
}

/* 不同类型给一个极轻的色相提示，扫一眼就知道这是哪类文件 */
.cm-ctxmenu[data-cm-kind="image"] .cm-path + .cm-group { color: var(--dsw-alias-state-success-primary); }
.cm-ctxmenu[data-cm-kind="code"] .cm-path + .cm-group { color: var(--dsw-alias-brand-primary); }
.cm-ctxmenu[data-cm-kind="archive"] .cm-path + .cm-group { color: var(--dsw-alias-state-warn-primary); }
.cm-ctxmenu[data-cm-kind="binary"] .cm-path + .cm-group { color: var(--dsw-alias-state-error-primary); }

/* 提示 / 空态 / 结果 */
.cm-note {
  margin: 3px 0 0;
  padding: 7px 10px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent);
  font-size: 12px;
  line-height: 17px;
  font-weight: 450;
  color: var(--dsw-alias-state-warn-primary);
  word-break: break-all;
}
.cm-empty {
  padding: 5px 10px 7px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

/* 应用列表滚动区 */
.cm-apps {
  max-height: 208px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* ---- 删除确认弹窗：与右键菜单同一套玻璃语言 ---- */
.cm-scrim[data-cm-scheme="light"] {
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 42%, transparent);
}
.cm-scrim[data-cm-scheme="dark"] {
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent);
}
.cm-card[data-cm-scheme="light"] {
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.85),
    inset 0 -1px 0 0 rgba(15, 23, 42, 0.06),
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 16px 34px -10px rgba(15, 23, 42, 0.16),
    0 40px 72px -28px rgba(15, 23, 42, 0.2);
}
          `
          document.head.appendChild(style)
          // 插件卸载时把样式表一起带走，避免残留规则影响后续版本
          ctx.effect(() => () => { style.remove?.() }, 'dsh-steward: file menu styles')
        }

        /**
         * 在目标会话上执行一条命令，返回命令结果文本。
         *
         * 签名要点：remote.commands.execute 的第一个参数是 **sessionId**
         * （RPC 侧 wire 名 agentId，类型却是 SessionId）。传 agent 对象命令不会命中，
         * 这正是早先「删除一直失败」的原因。
         *
         * 注意：这里不能用 useCallback —— apply 不是 React 组件，
         * 在渲染期之外调用 hooks 会让 apply 直接抛错，整个插件静默消失。
         */
        async function runCommand(sessionId, line) {
          const commands = ctx.remote?.commands
          if (commands === undefined || typeof commands.execute !== 'function') {
            throw new Error('commands-unavailable')
          }
          const result = await commands.execute(sessionId, line, [])
          if (result?.ok !== true) {
            throw new Error(result?.error?.message ?? 'command-failed')
          }
          // 命令未注册时 execute 返回 undefined（表示“没有命中任何命令”）
          if (result.value === undefined) throw new Error('command-not-registered')
          const outcome = result.value.result
          if (outcome?.kind === 'error') throw new Error(outcome.text ?? 'command-failed')
          return typeof outcome?.text === 'string' ? outcome.text : ''
        }

        /* ---------------- 设置页 ---------------- */

        /**
         * better-sidebar 的标签页会把它自己那个会话写进 sessionOverride。
         *
         * 为什么需要它：侧边栏标签是「某个会话的」页面，命令必须落在那个会话上；
         * 而 sessionIdOf() 原来取的是会话列表里的第一个，在多标签/多面板下会打错目标。
         * 没装 better-sidebar 时这个变量永远是 null，行为与以前逐字节一致。
         */
        let sessionOverride = null

        /** 当前会话 id：命令通道需要一个会话作为入口。 */
        function sessionIdOf() {
          if (typeof sessionOverride === 'string' && sessionOverride.length > 0) return sessionOverride
          return ctx.sessions?.list?.getSnapshot?.()?.ids?.[0]
        }

        function formatBytes(bytes) {
          const n = Number(bytes ?? 0)
          if (!Number.isFinite(n) || n <= 0) return '0 B'
          const units = ['B', 'KB', 'MB', 'GB', 'TB']
          let value = n
          let unit = 0
          while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
          return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
        }

        function formatTime(ms) {
          const n = Number(ms)
          if (!Number.isFinite(n) || n <= 0) return ''
          try {
            return new Date(n).toLocaleString()
          } catch {
            return ''
          }
        }

        /** 调宿主命令并解析 JSON 返回值。 */
        async function callJson(line) {
          const sessionId = sessionIdOf()
          if (sessionId === undefined) throw new Error('no-session')
          const text = await runCommand(sessionId, line)
          return JSON.parse(String(text ?? '{}'))
        }

        /* ---------- 分页：对话设置 ---------- */

        function ConversationPanel() {
          const [folderOn, setFolderOn] = useState(false)
          const [sessionLogOn, setSessionLogOn] = useState(false)
          const [busy, setBusy] = useState('')
          const [error, setError] = useState('')
          const [loaded, setLoaded] = useState(false)
          const alive = useRef(true)

          useEffect(() => {
            alive.current = true
            void (async () => {
              try {
                const parsed = await callJson('/chat-config getall')
                if (alive.current) {
                  setFolderOn(parsed.folder === true)
                  setSessionLogOn(parsed.sessionLog === true)
                  setError('')
                }
              } catch {
                if (alive.current) setError(t('readFailed'))
              } finally {
                if (alive.current) setLoaded(true)
              }
            })()
            return () => { alive.current = false }
          }, [])

          /**
           * 两个开关共用一套乐观更新：先翻界面，失败再翻回来。
           *
           * 为什么要共用：写配置的命令只有一条，失败时的处理（回滚 + 报错）
           * 完全一样；拆成两份容易改了一处漏一处。
           */
          const flip = async (which, previous, apply) => {
            if (busy !== '' || !loaded) return
            setBusy(which)
            setError('')
            apply(!previous)
            try {
              await callJson(`/chat-config ${which}.enabled=${!previous ? 'true' : 'false'}`)
            } catch {
              if (alive.current) { apply(previous); setError(t('saveFailed')) }
            } finally {
              if (alive.current) setBusy('')
            }
          }

          const toggleFolder = () => flip('folder', folderOn, setFolderOn)
          const toggleSessionLog = () => flip('sessionLog', sessionLogOn, setSessionLogOn)

          const switchOf = (label, value, onClick) => h('button', {
            type: 'button', role: 'switch',
            'aria-checked': value, 'aria-label': label,
            disabled: busy !== '' || !loaded,
            onClick,
            style: S.sw(value, busy !== '' || !loaded),
          }, h('span', { style: S.knob(value) }))

          return h('div', null,
            h('p', { style: S.hint }, t('hint')),
            h('div', { style: S.row },
              h('span', { style: S.rowText },
                t('toggleFolder'),
                h('span', { style: S.rowHint }, t('toggleFolderHint'))),
              switchOf(t('toggleFolder'), folderOn, toggleFolder)),
            // 交接日志是"文件夹里的东西"，文件夹关掉时它没有落脚点，
            // 所以只在文件夹开启时显示，避免出现"开着却写不出来"的困惑。
            folderOn
              ? h('div', { style: S.row },
                h('span', { style: S.rowText },
                  t('toggleSessionLog'),
                  h('span', { style: S.rowHint }, t('toggleSessionLogHint'))),
                switchOf(t('toggleSessionLog'), sessionLogOn, toggleSessionLog))
              : null,
            error.length > 0 ? h('div', { style: S.err }, error) : null)
        }

        /* ---------- 分页：回收站 ---------- */

        function TrashPanel() {
          const [items, setItems] = useState(null)
          const [busy, setBusy] = useState('')
          const [error, setError] = useState('')
          const [note, setNote] = useState('')
          const alive = useRef(true)

          const load = async () => {
            try {
              const parsed = await callJson('/chat-trash list')
              if (alive.current) {
                setItems(Array.isArray(parsed.items) ? parsed.items : [])
                setError('')
              }
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            }
          }

          useEffect(() => {
            alive.current = true
            void load()
            return () => { alive.current = false }
          }, [])

          const act = async (key, line, doneKey) => {
            if (busy !== '') return
            setBusy(key)
            setError('')
            setNote('')
            try {
              await runCommand(sessionIdOf(), line)
              if (alive.current) setNote(t(doneKey))
              await load()
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            } finally {
              if (alive.current) setBusy('')
            }
          }

          const total = (items ?? []).length
          const bytes = (items ?? []).reduce((sum, item) => sum + Number(item.bytes ?? 0), 0)

          return h('div', null,
            h('p', { style: S.hint }, t('trashHint')),
            h('div', { style: S.toolBar },
              h('span', { style: S.itemMeta },
                t('trashCount').replace('{n}', String(total)).replace('{size}', formatBytes(bytes))),
              h('div', { style: S.itemActions },
                h('button', { type: 'button', style: S.small(false), onClick: () => { void load() } }, t('refresh')),
                total > 0
                  ? h('button', {
                    type: 'button', style: S.small(true), disabled: busy !== '',
                    onClick: () => {
                      if (!window.confirm(t('emptyConfirm'))) return
                      void act('empty', '/chat-trash empty', 'emptied')
                    },
                  }, t('emptyAll'))
                  : null)),

            items === null
              ? h('div', { style: S.itemMeta }, t('loading'))
              : total === 0
                ? h('div', { style: S.itemMeta }, t('emptyTrash'))
                : h('div', null, items.map((item) => h('div', { key: item.id, style: S.item },
                  h('span', { style: S.itemMain },
                    h('span', { style: S.itemTitle, title: item.title || item.sessionId },
                      item.title || item.sessionId),
                    h('span', { style: S.itemMeta },
                      `${formatTime(item.deletedAt)} · ${formatBytes(item.bytes)} · `
                        + (item.kind === 'file' ? t('kindFile')
                          : item.hasFolder ? t('withFolderTag') : t('noFolderTag')))),
                  h('span', { style: S.itemActions },
                    h('button', {
                      type: 'button', style: S.small(false), disabled: busy !== '',
                      onClick: () => { void act(`restore:${item.id}`, `/chat-trash restore ${item.id}`, 'restored') },
                    }, t('restore')),
                    h('button', {
                      type: 'button', style: S.small(true), disabled: busy !== '',
                      onClick: () => {
                        if (!window.confirm(t('purgeConfirm'))) return
                        void act(`purge:${item.id}`, `/chat-trash purge ${item.id}`, 'purged')
                      },
                    }, t('purge')))))),

            note.length > 0 ? h('div', { style: S.itemMeta, role: 'status' }, note) : null,
            error.length > 0 ? h('div', { style: S.err }, error) : null)
        }

        /* ---------- 分页：备份 ---------- */

        function BackupPanel() {
          const [info, setInfo] = useState(null)
          const [busy, setBusy] = useState('')
          const [error, setError] = useState('')
          const [note, setNote] = useState('')
          const alive = useRef(true)

          const load = async () => {
            try {
              const parsed = await callJson('/chat-backup info')
              if (alive.current) { setInfo(parsed); setError('') }
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            }
          }

          useEffect(() => {
            alive.current = true
            void load()
            return () => { alive.current = false }
          }, [])

          const clear = async () => {
            if (busy !== '') return
            setBusy('clear')
            setError('')
            setNote('')
            try {
              await runCommand(sessionIdOf(), '/chat-backup clear')
              if (alive.current) setNote(t('backupCleared'))
              await load()
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            } finally {
              if (alive.current) setBusy('')
            }
          }

          const openDir = async () => {
            if (busy !== '') return
            setBusy('open')
            setError('')
            try {
              await runCommand(sessionIdOf(), '/chat-backup open')
            } catch (failure) {
              if (alive.current) setError(`${t('openDirFailed')}：${String(failure?.message ?? failure)}`)
            } finally {
              if (alive.current) setBusy('')
            }
          }

          const entries = Number(info?.entries ?? 0)
          const bytes = Number(info?.bytes ?? 0)

          return h('div', null,
            h('p', { style: S.hint }, t('backupHint')),

            h('div', { style: S.kv },
              h('span', { style: S.kvKey }, t('backupDir')),
              h('span', { ...S.kvVal, ...S.mono }, info?.dir || '—')),
            h('div', { style: S.kv },
              h('span', { style: S.kvKey }, t('backupUsage')),
              h('span', { style: S.kvVal },
                info === null ? t('loading')
                  : entries === 0 ? t('backupEmpty')
                    : `${entries} 项 · ${formatBytes(bytes)}`)),

            h('div', { style: S.rowActions },
              h('button', { type: 'button', style: S.ghost(busy !== ''), disabled: busy !== '', onClick: () => { void load() } }, t('refresh')),
              h('button', {
                type: 'button', style: S.ghost(busy !== '' || entries === 0),
                disabled: busy !== '' || entries === 0,
                onClick: () => { void openDir() },
              }, t('openBackupDir')),
              h('button', {
                type: 'button', style: S.danger(busy !== '' || entries === 0),
                disabled: busy !== '' || entries === 0,
                onClick: () => {
                  if (!window.confirm(t('clearBackupConfirm'))) return
                  void clear()
                },
              }, t('clearBackups'))),

            note.length > 0 ? h('div', { style: { ...S.itemMeta, marginTop: '8px' }, role: 'status' }, note) : null,
            error.length > 0 ? h('div', { style: S.err }, error) : null)
        }

        /* ---------- 分页：运行守则 ---------- */

        function GuardrailsPanel() {
          const [guardOn, setGuardOn] = useState(true)
          const [state, setState] = useState(null)
          const [expanded, setExpanded] = useState(false)
          const [preview, setPreview] = useState(null)
          const [busy, setBusy] = useState('')
          const [error, setError] = useState('')
          const [note, setNote] = useState('')
          const alive = useRef(true)

          const load = async () => {
            try {
              const [config, detail] = await Promise.all([
                callJson('/chat-config getall'),
                callJson('/chat-guardrails get'),
              ])
              if (!alive.current) return
              setGuardOn(config.guardrails !== false)
              setState(detail)
              setError('')
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            }
          }

          useEffect(() => {
            alive.current = true
            void load()
            return () => { alive.current = false }
          }, [])

          const toggle = async () => {
            if (busy !== '') return
            setBusy('toggle')
            setError('')
            const previous = guardOn
            setGuardOn(!previous)
            try {
              await callJson(`/chat-config guardrails.enabled=${!previous ? 'true' : 'false'}`)
              await load()
            } catch {
              if (alive.current) { setGuardOn(previous); setError(t('saveFailed')) }
            } finally {
              if (alive.current) setBusy('')
            }
          }

          const showPreview = async () => {
            if (busy !== '') return
            setBusy('preview')
            setError('')
            try {
              const detail = await callJson('/chat-guardrails preview')
              if (alive.current) setPreview(String(detail.next ?? ''))
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            } finally {
              if (alive.current) setBusy('')
            }
          }

          const restore = async () => {
            if (busy !== '') return
            if (!window.confirm(t('guardRestoreConfirm'))) return
            setBusy('restore')
            setError('')
            setNote('')
            try {
              await runCommand(sessionIdOf(), '/chat-guardrails restore')
              if (alive.current) setNote(t('guardRestored'))
              await load()
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            } finally {
              if (alive.current) setBusy('')
            }
          }

          const rules = String(state?.rules ?? '')
          const installed = state?.installed === true

          return h('div', null,
            h('p', { style: S.hint }, t('guardHint')),

            h('div', { style: S.row },
              h('span', { style: S.rowText },
                t('toggleGuardrails'),
                h('span', { style: S.rowHint },
                  installed ? t('guardInstalled') : t('guardNotInstalled'))),
              h('button', {
                type: 'button', role: 'switch',
                'aria-checked': guardOn, 'aria-label': t('toggleGuardrails'),
                disabled: busy !== '',
                onClick: toggle,
                style: S.sw(guardOn, busy !== ''),
              }, h('span', { style: S.knob(guardOn) }))),

            h('div', { style: S.rowActions },
              h('button', {
                type: 'button', style: S.ghost(busy !== ''),
                disabled: busy !== '',
                onClick: () => setExpanded((value) => !value),
              }, expanded ? t('guardHideFull') : t('guardShowFull')),
              h('button', {
                type: 'button', style: S.ghost(busy !== ''),
                disabled: busy !== '',
                onClick: () => { void showPreview() },
              }, t('guardPreview')),
              h('button', {
                type: 'button', style: S.ghost(busy !== ''),
                disabled: busy !== '',
                onClick: () => { void restore() },
              }, t('guardRestore'))),

            expanded ? h('pre', { style: S.pre }, rules) : null,
            preview !== null ? h('pre', { style: S.pre }, preview) : null,

            note.length > 0 ? h('div', { style: { ...S.itemMeta, marginTop: '8px' }, role: 'status' }, note) : null,
            error.length > 0 ? h('div', { style: S.err }, error) : null)
        }

        /* ---------- 分页：体检 ---------- */

        function DoctorPanel() {
          const [report, setReport] = useState(null)
          const [busy, setBusy] = useState(false)
          const [error, setError] = useState('')
          const alive = useRef(true)

          useEffect(() => {
            alive.current = true
            return () => { alive.current = false }
          }, [])

          const run = async () => {
            if (busy) return
            setBusy(true)
            setError('')
            try {
              const parsed = await callJson('/chat-doctor')
              if (alive.current) setReport(parsed)
            } catch (failure) {
              if (alive.current) setError(String(failure?.message ?? failure))
            } finally {
              if (alive.current) setBusy(false)
            }
          }

          const checks = Array.isArray(report?.checks) ? report.checks : []
          const problems = Number(report?.problems ?? 0)

          return h('div', null,
            h('p', { style: S.hint }, t('doctorHint')),

            h('div', { style: S.rowActions },
              h('button', {
                type: 'button', style: S.ghost(busy), disabled: busy,
                onClick: () => { void run() },
              }, busy ? t('doctorRunning') : t('doctorRun'))),

            report !== null
              ? h('div', { style: { marginTop: '12px' } },
                h('div', { style: S.itemMeta },
                  `${t('doctorAt')} ${formatTime(report.at)} · `
                    + (problems === 0 ? t('doctorOk') : t('doctorProblems').replace('{n}', String(problems)))),
                h('div', { style: { marginTop: '8px' } }, checks.map((item) => h('div', {
                  key: item.id,
                  style: S.checkRow(item.status),
                },
                h('span', { style: S.badge(item.status) },
                  item.status === 'ok' ? t('statusOk')
                    : item.status === 'warn' ? t('statusWarn') : t('statusInfo')),
                h('span', { style: { minWidth: 0 } },
                  h('span', { style: S.checkText }, item.id),
                  h('span', { style: S.checkSub }, String(item.detail ?? '')))))))
              : null,

            error.length > 0 ? h('div', { style: S.err }, error) : null)
        }

        /* ---------- 设置页外壳：标签导航 ---------- */

        const TABS = ['conversation', 'trash', 'backup', 'guardrails', 'doctor']

        function SettingsPage() {
          const [tab, setTab] = useState('conversation')

          const panel = tab === 'trash' ? TrashPanel
            : tab === 'backup' ? BackupPanel
              : tab === 'guardrails' ? GuardrailsPanel
                : tab === 'doctor' ? DoctorPanel
                  : ConversationPanel

          return h('div', { style: S.page },
            h('h2', { style: S.title }, t('title')),
            h('div', { style: S.tabs, role: 'tablist' }, TABS.map((key) => h('button', {
              key,
              type: 'button',
              role: 'tab',
              'aria-selected': tab === key,
              style: S.tab(tab === key),
              onClick: () => setTab(key),
            }, t('tabs')[key]))),
            h('div', { role: 'tabpanel' }, h(panel)))
        }

        
/* ---------------- 删除确认弹窗 ---------------- */

        function DeleteDialog() {
          const request = useDialog()
          const [withFolder, setWithFolder] = useState(false)
          const [busy, setBusy] = useState(false)
          const [error, setError] = useState('')
          const openId = request?.openId

          useEffect(() => {
            setWithFolder(request?.defaultWithFolder === true)
            setBusy(false)
            setError('')
          }, [openId])

          const cancel = useCallback(() => {
            if (busy) return
            dialogStore.set(null)
          }, [busy])

          useEffect(() => {
            if (request === null) return undefined
            const onKey = (event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (!busy) dialogStore.set(null)
            }
            window.addEventListener('keydown', onKey)
            return () => window.removeEventListener('keydown', onKey)
          }, [request, busy])

          if (request === null) return null

          const folderPath = request.folderPath
          const pending = request.pending === true
          const hasFolder = typeof folderPath === 'string' && folderPath.length > 0

          const confirm = async () => {
            if (busy || pending) return
            setBusy(true)
            setError('')
            try {
              let line = `/chat-delete --session=${request.sessionId}`
              if (withFolder && hasFolder) line += ` --with-folder --folder=${folderPath}`
              await runCommand(request.sessionId, line)
              dialogStore.set(null)

              // 这里刻意不调用 sessions.refresh()：
              // 它走 mergeOrderedBaseline，会把刚被移除的条目合并回来，
              // 反而让已删的行重新出现。行的移除由宿主的
              // `api-session/removed` 事件负责，那边已经发了。
            } catch (failure) {
              setError(`${t('failed')}：${failure?.message ?? ''}`)
            } finally {
              setBusy(false)
            }
          }

          // 弹窗与右键菜单共用 scheme 判断，遮罩/阴影强度按明暗切换
          const scheme = (() => {
            try {
              return ctx.theme?.getTheme?.()?.active?.colorScheme === 'light' ? 'light' : 'dark'
            } catch {
              return 'dark'
            }
          })()

          return h('div', {
            className: 'cm-scrim',
            'data-cm-scheme': scheme,
            style: S.scrim,
            onMouseDown: (event) => { if (event.target === event.currentTarget) cancel() },
          },
          h('div', {
            role: 'dialog', 'aria-modal': 'true', 'aria-label': t('dialogTitle'),
            className: 'cm-card', 'data-cm-scheme': scheme, style: S.card,
          },
          h('div', { style: S.head },
            h('h3', { style: S.h3 }, t('dialogTitle')),
            h('button', {
              type: 'button', 'aria-label': t('close'), title: t('close'),
              disabled: busy, onClick: cancel, style: S.x,
            }, '\u2715')),
          h('p', { style: S.body }, t('dialogLine1')),
          h('p', { style: S.body }, t('dialogLine2')),
          h('p', { style: { ...S.body, ...S.itemMeta, marginTop: '-2px' } }, t('trashHint')),
          h('label', { style: S.check(pending || !hasFolder || busy) },
            h('input', {
              type: 'checkbox', checked: withFolder && hasFolder,
              disabled: pending || !hasFolder || busy,
              onChange: (event) => setWithFolder(event.target.checked),
              style: { marginTop: '2px' },
            }),
            h('span', null,
              h('span', { style: S.checkLabel }, t('withFolder')),
              h('span', { style: S.checkHint },
                pending ? t('querying') : hasFolder ? folderPath : t('folderUnknown')))),
          error.length > 0 ? h('div', { style: S.err }, error) : null,
          h('div', { style: S.foot },
            h('button', { type: 'button', disabled: busy, onClick: cancel, style: S.ghost(busy) }, t('cancel')),
            h('button', { type: 'button', disabled: busy || pending, onClick: confirm, style: S.danger(busy || pending) },
              busy ? t('working') : t('confirm')))))
        }

        /* ---------------- 菜单里的「删除对话」行 ---------------- */

        function DeleteMenuRow(props) {
          const { sessionId } = props
          if (sessionId === undefined) return null

          const onClick = () => {
            const openId = `${sessionId}:${Date.now()}`
            dialogStore.set({ sessionId, folderPath: undefined, pending: true, openId })

            void (async () => {
              let folderPath
              try {
                const text = await runCommand(sessionId, `/chat-folder --session=${sessionId}`)
                if (typeof text === 'string' && text.length > 0) folderPath = text.trim()
              } catch {
                folderPath = undefined
              }
              dialogStore.set({
                sessionId,
                folderPath,
                pending: false,
                defaultWithFolder: folderPath !== undefined,
                openId,
              })
            })()
          }

          return h('button', { type: 'button', role: 'menuitem', style: S.menuRow, onClick },
            h('span', { 'aria-hidden': true, style: { fontSize: '12px' } }, '\u2715'),
            h('span', null, t('menu')))
        }

        /* ---------------- 菜单里的「打开该对话的文件夹」行 ---------------- */

        function OpenFolderMenuRow(props) {
          const { sessionId } = props
          const [folderPath, setFolderPath] = useState(undefined)
          const [checked, setChecked] = useState(false)

          // 只在菜单打开时查一次，不阻塞菜单渲染
          useEffect(() => {
            if (sessionId === undefined || checked) return
            setChecked(true)
            void (async () => {
              try {
                const text = await runCommand(sessionId, `/chat-folder --session=${sessionId}`)
                if (typeof text === 'string' && text.trim().length > 0) setFolderPath(text.trim())
              } catch {
                setFolderPath(undefined)
              }
            })()
          }, [sessionId, checked])

          // 没有文件夹就不占位，别让菜单里出现一行点了没反应的按钮
          if (sessionId === undefined || folderPath === undefined) return null

          const onClick = () => {
            void (async () => {
              try {
                await runCommand(sessionId, `/chat-open-folder --session=${sessionId}`)
              } catch {
                // 打不开就算了，菜单本来就会关闭
              }
            })()
          }

          return h('button', { type: 'button', role: 'menuitem', style: S.menuItem, onClick },
            h('span', { 'aria-hidden': true, style: { fontSize: '12px' } }, '\u25A1'),
            h('span', null, t('menuOpenFolder')))
        }

﻿        /* ---------------- 文件类型识别 ---------------- */

        /**
         * 按扩展名把文件分成几组，每组给一套专属菜单。
         *
         * 为什么要分组而不是一个大菜单：用户右键一张图片和右键一个 zip，
         * 想做的事完全不同。把 20 个菜单项全塞给每个文件，等于没给。
         *
         * 分组是**纯客户端**的判断，不查宿主、不发命令，所以右键瞬间就能出菜单。
         */
        const EXT_GROUPS = {
          image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tif', 'tiff'],
          code: [
            'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs',
            'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'php', 'swift',
            'lua', 'pl', 'r', 'scala', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
            'sql', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte',
            'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env', 'xml', 'gradle',
            'dockerfile', 'makefile', 'cmake', 'gitignore', 'editorconfig',
          ],
          doc: ['md', 'markdown', 'mdx', 'txt', 'rtf', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'odt', 'ods', 'odp', 'epub'],
          archive: ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'cab'],
          media: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus'],
          binary: ['exe', 'msi', 'dll', 'so', 'dylib', 'bin', 'app', 'deb', 'rpm', 'apk', 'jar', 'wasm'],
        }

        /** 把扩展名映射到分组名；认不出来就归到 other。 */
        function kindOf(path) {
          const name = String(path ?? '').split(/[\\/]/).pop() ?? ''
          const dot = name.lastIndexOf('.')
          // 无扩展名但有名的构建文件（Dockerfile / Makefile）按代码处理
          if (dot <= 0) {
            const lower = name.toLowerCase()
            if (['dockerfile', 'makefile', 'cmakelists.txt', 'procfile'].includes(lower)) return 'code'
            return 'other'
          }
          const ext = name.slice(dot + 1).toLowerCase()
          for (const [kind, list] of Object.entries(EXT_GROUPS)) {
            if (list.includes(ext)) return kind
          }
          return 'other'
        }

        /** 分组名 -> 语言包里的标题键。 */
        const KIND_LABEL = {
          image: 'kindImage', code: 'kindCode', doc: 'kindDoc',
          archive: 'kindArchive', media: 'kindMedia', binary: 'kindBinary', other: 'kindOther',
        }

        /**
         * 判断一个右键目标是不是网址链接。
         *
         * 只认 http/https：`javascript:`、`data:`、`file:` 一律不接管，
         * 让它们落到原生菜单（或什么都不发生），避免把恶意链接递进打开通道。
         */
        function urlOf(target) {
          if (target === null || typeof target.closest !== 'function') return undefined
          const anchor = target.closest('a[href]')
          if (anchor === null) return undefined
          const href = String(anchor.getAttribute('href') ?? '').trim()
          if (href.length === 0) return undefined
          let parsed
          try {
            parsed = new URL(href, window.location.href)
          } catch {
            return undefined
          }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
          const hasCredentials = parsed.username !== '' || parsed.password !== ''
          return {
            url: parsed.href,
            text: String(anchor.textContent ?? '').trim(),
            hasCredentials,
            // 显示用：密码换成 ***，用户名保留（用户需要知道是哪个账号）
            displayUrl: hasCredentials ? maskCredentials(parsed) : parsed.href,
          }
        }

        /** 把 URL 里的密码换成 ***，保留用户名。 */
        function maskCredentials(parsed) {
          try {
            const copy = new URL(parsed.href)
            if (copy.password !== '') copy.password = '***'
            return copy.href
          } catch {
            return String(parsed.href)
          }
        }

        /* ---------------- 交付物文件：右键菜单 ---------------- */

        /**
         * 在文件卡片上点右键，直接弹出操作菜单。
         *
         * 为什么用 DOM 事件而不是 slot：官方没有提供"右键菜单"扩展点，
         * 但交付物卡片带了稳定的标记，可以据此定位是哪个文件：
         *   [data-presented-file]  对话里的交付物卡片（内部 .cardPreview 的 title 就是绝对路径）
         *   [data-review-file]     右侧变更审查文件行（属性值就是路径）
         * 这里只在捕获阶段拦截 contextmenu，命中才阻止默认并弹菜单，
         * 其余地方的右键行为完全不受影响。
         */
        function FileContextMenu() {
          const [menu, setMenu] = useState(null)   // { x, y, path } 或 { x, y, url, text }
          const [apps, setApps] = useState(null)
          const [browsers, setBrowsers] = useState(null)
          const [busy, setBusy] = useState(false)
          const [note, setNote] = useState('')
          const boxRef = useRef(null)

          // 路径 / URL 都用 base64 传：Windows 路径常带空格，URL 里常带 & 和 ?，
          // 直接拼进命令行会被拆断或被 shell 解释。
          const encodeArg = (text) => {
            const bytes = new TextEncoder().encode(String(text))
            let binary = ''
            for (const byte of bytes) binary += String.fromCharCode(byte)
            return btoa(binary)
          }

          /** 从右键目标往上找文件卡片，取出它的绝对路径。 */
          const pathOf = (target, event) => {
            if (target === null || typeof target.closest !== 'function') return undefined

            /**
             * 有些容器（尤其 Electron 里被 portal 包过的层）会让 event.target 被 retarget
             * 成宿主元素，这时从 target 往上 closest 就找不到卡片内部的标记。
             * 先按 target 走正常路径，找不到再用 composedPath 里的每个节点重试一遍。
             */
            const fromTarget = pathOfNode(target)
            if (fromTarget !== undefined) return fromTarget
            const path = typeof event?.composedPath === 'function' ? event.composedPath() : []
            for (const node of path) {
              if (node === target) continue
              if (node === null || typeof node.closest !== 'function') continue
              const found = pathOfNode(node)
              if (found !== undefined) return found
            }
            return undefined
          }

          /** 真正的标记解析：给一个 DOM 节点，往上找它所属的文件卡片。 */
          const pathOfNode = (target) => {
            const review = target.closest('[data-review-file]')
            if (review !== null) {
              const value = review.getAttribute('data-review-file')
              if (typeof value === 'string' && value.length > 0) {
                // 审查行给的是工作区相对路径时，用卡片 title 里的绝对路径兜底
                const preview = review.querySelector('[title]')
                const title = preview === null ? '' : String(preview.getAttribute('title') ?? '')
                const looksAbsolute = (text) => /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\')
                return looksAbsolute(title) ? title : value
              }
            }

            /**
             * 右侧「文件」树。
             *
             * 这里给的 data-files-path 是**工作区相对**路径，单看它没法定位磁盘文件。
             * 但树的根节点（data-files-root）是绝对路径，两者拼起来就是绝对路径。
             * 顺序很重要：先找最近的 [data-files-path]，再往上找 [data-files-root]，
             * 否则会拿到树根而不是被点的那个文件。
             */
            const treeRow = target.closest('[data-files-entry]')
            if (treeRow !== null) {
              const rowPath = treeRow.getAttribute('data-files-path')
              if (typeof rowPath === 'string' && rowPath.length > 0) {
                const treeRoot = treeRow.closest('[data-files-root]')
                const root = treeRoot === null ? '' : String(treeRoot.getAttribute('data-files-root') ?? '')
                if (/^[A-Za-z]:[\\/]/.test(rowPath) || rowPath.startsWith('\\\\') || rowPath.startsWith('/')) {
                  return rowPath
                }
                if (root.length > 0) {
                  const sep = root.includes('\\') ? '\\' : '/'
                  return `${root.replace(/[\\/]+$/, '')}${sep}${rowPath.replace(/^[\\/]+/, '')}`
                }
                return rowPath
              }
            }

            const card = target.closest('[data-presented-file]')
            if (card !== null) {
              // 卡片的 title 挂在 .cardPreview 这个 button 上，值是宿主解析过的绝对路径。
              // 但它不是卡片里唯一的 title（图标、状态行也可能有），所以要挑**看起来像
              // 绝对路径**的那一个，而不是简单取第一个。
              const looksAbsolute = (text) => /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\') || text.startsWith('/')
              const titled = card.querySelectorAll('[title]')
              for (const node of titled) {
                const value = String(node.getAttribute('title') ?? '')
                if (looksAbsolute(value)) return value
              }
              const first = titled.item(0)
              const fallback = first === null ? '' : String(first.getAttribute('title') ?? '')
              if (fallback.length > 0) return fallback
            }

            // 兜底：从交付物行容器往上找，命中整行（点到卡片之间的空隙时）
            const row = target.closest('[data-presented-files-row]')
            if (row !== null) {
              const looksAbsolute = (text) => /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\') || text.startsWith('/')
              const titled = row.querySelectorAll('[title]')
              for (const node of titled) {
                const value = String(node.getAttribute('title') ?? '')
                if (looksAbsolute(value)) return value
              }
            }
            return undefined
          }

          useEffect(() => {
            const onContextMenu = (event) => {
              // 网址优先判定：链接里可能嵌着文件卡片的样式，但用户点的是链接本身
              const link = urlOf(event.target)
              if (link !== undefined) {
                event.preventDefault()
                event.stopPropagation()
                setApps(null)
                setNote('')
                setMenu({ x: event.clientX, y: event.clientY, url: link.url, text: link.text })
                return
              }

              const path = pathOf(event.target, event)
              if (path === undefined) return      // 不是文件卡片：放行原生菜单
              event.preventDefault()
              event.stopPropagation()
              setApps(null)
              setBrowsers(null)
              setNote('')
              setMenu({ x: event.clientX, y: event.clientY, path })
            }
            // 捕获阶段，抢在其它处理之前判定
            window.addEventListener('contextmenu', onContextMenu, true)
            return () => window.removeEventListener('contextmenu', onContextMenu, true)
          }, [])

          // 键盘可达：在文件卡片上按 Shift+F10 / 菜单键，弹出同一个菜单。
          // 位置取卡片的矩形，这样不依赖鼠标坐标。
          useEffect(() => {
            const onKeyDown = (event) => {
              const isMenuKey = event.key === 'F10' && event.shiftKey
              const isContextKey = event.key === 'ContextMenu'
              if (!isMenuKey && !isContextKey) return

              // 链接也能用键盘唤出菜单，和鼠标右键同一套动作
              const link = urlOf(event.target)
              if (link !== undefined) {
                event.preventDefault()
                const anchor = event.target.closest('a[href]')
                const rect = anchor?.getBoundingClientRect?.()
                setApps(null)
                setNote('')
                setMenu({
                  x: rect === undefined ? event.clientX : Math.round(rect.left + 12),
                  y: rect === undefined ? event.clientY : Math.round(rect.bottom - 6),
                  url: link.url,
                  text: link.text,
                })
                return
              }

              const path = pathOf(event.target, event)
              if (path === undefined) return
              event.preventDefault()
              const target = typeof event.target.closest === 'function'
                ? (event.target.closest('[data-presented-file]') ?? event.target.closest('[data-review-file]') ?? event.target.closest('[data-files-entry]'))
                : null
              const rect = target?.getBoundingClientRect?.()
              setApps(null)
              setNote('')
              setMenu({
                x: rect === undefined ? event.clientX : Math.round(rect.left + 12),
                y: rect === undefined ? event.clientY : Math.round(rect.bottom - 6),
                path,
              })
            }
            window.addEventListener('keydown', onKeyDown, true)
            return () => window.removeEventListener('keydown', onKeyDown, true)
          }, [])

          // 点别处 / Esc 关闭
          useEffect(() => {
            if (menu === null) return undefined
            const close = (event) => {
              if (boxRef.current !== null && event.target instanceof Node && boxRef.current.contains(event.target)) return
              setMenu(null)
            }
            const onKey = (event) => { if (event.key === 'Escape') setMenu(null) }
            window.addEventListener('mousedown', close, true)
            window.addEventListener('keydown', onKey, true)
            window.addEventListener('scroll', () => setMenu(null), true)
            return () => {
              window.removeEventListener('mousedown', close, true)
              window.removeEventListener('keydown', onKey, true)
            }
          }, [menu])

          if (menu === null) return null

          /* ---- 网址菜单：和文件菜单共用一个外壳，但动作集合完全不同 ---- */
          if (typeof menu.url === 'string') {
            const urlHeight = 210
            const ux = Math.min(menu.x, Math.max(8, window.innerWidth - 260 - 8))
            const uy = Math.min(menu.y, Math.max(8, window.innerHeight - urlHeight - 8))

            const copy = async (value, doneKey) => {
              if (busy) return
              setBusy(true)
              setNote('')
              try {
                await navigator.clipboard.writeText(value)
                setNote(t(doneKey))
                window.setTimeout(() => setMenu(null), 600)
              } catch (failure) {
                setNote(String(failure?.message ?? failure))
              } finally {
                setBusy(false)
              }
            }

            /**
             * 打开网址。
             *
             * 走宿主命令而不是 window.open：window.open 会被浏览器的弹窗拦截器
             * 当成脚本行为拦下（右键菜单的点击不是用户对"打开新窗口"的直接手势），
             * 而且宿主那边对 http/https 有明确的白名单处理。
             */
            /**
             * 打开网址。
             *
             * 走宿主命令而不是 window.open：window.open 会被浏览器的弹窗拦截器
             * 当成脚本行为拦下（右键菜单的点击不是用户对"打开新窗口"的直接手势），
             * 而且宿主那边对 http/https 有明确的白名单处理。
             *
             * 带账号密码的 URL 先弹一次确认：这类链接会把凭据明文塞进地址栏，
             * 用户可能根本没注意到自己在打开一个带密码的地址。确认框把这件事摆明，
             * 但不阻止 —— 用户明确同意后照常打开。
             */
            const openUrl = async (browserId) => {
              if (busy) return

              if (menu.hasCredentials === true) {
                const shown = menu.displayUrl ?? menu.url
                const ok = window.confirm(`${t('credUrlWarning')}\n\n${shown}`)
                if (!ok) return
              }

              setBusy(true)
              setNote('')
              try {
                const line = browserId === undefined
                  ? `/chat-file --action=open-url --url64=${encodeArg(menu.url)}`
                  : `/chat-file --action=open-url --url64=${encodeArg(menu.url)} --browser=${browserId}`
                await runCommand(sessionIdOf(), line)
                setMenu(null)
              } catch (failure) {
                setNote(String(failure?.message ?? failure))
              } finally {
                setBusy(false)
              }
            }

            const loadBrowsers = async () => {
              if (busy) return
              setBusy(true)
              setNote('')
              try {
                const text = await runCommand(sessionIdOf(), '/chat-file --action=browsers')
                const parsed = JSON.parse(String(text ?? '{}'))
                const list = Array.isArray(parsed?.browsers) ? parsed.browsers : []
                setBrowsers(list.map((one) => ({ id: String(one.id), name: String(one.name) })))
                if (list.length === 0) setNote(t('noBrowsers'))
              } catch (failure) {
                setNote(String(failure?.message ?? failure))
              } finally {
                setBusy(false)
              }
            }

            const urlItem = (label, onClick) => h('button', {
              type: 'button',
              role: 'menuitem',
              className: 'cm-item',
              disabled: busy,
              onClick: (event) => { event.preventDefault(); event.stopPropagation(); onClick() },
            }, label)

            const scheme = (() => {
              try {
                const active = ctx.theme?.getTheme?.()?.active?.colorScheme
                return active === 'light' ? 'light' : 'dark'
              } catch {
                return 'dark'
              }
            })()

            return h('div', {
              ref: boxRef,
              role: 'menu',
              className: 'cm-ctxmenu',
              'data-cm-scheme': scheme,
              'data-cm-credential': menu.hasCredentials === true ? 'true' : undefined,
              style: { left: `${ux}px`, top: `${uy}px` },
              onContextMenu: (event) => event.preventDefault(),
            },
            // 顶部显示打码后的 URL：密码变成 ***，避免在菜单里把密码亮出来
            h('div', { className: 'cm-path', title: menu.displayUrl ?? menu.url },
              menu.displayUrl ?? menu.url),
            menu.hasCredentials === true
              ? h('div', { className: 'cm-group cm-cred' }, t('credUrlBadge'))
              : null,
            urlItem(t('openInBrowser'), () => openUrl()),
            browsers === null
              ? urlItem(t('chooseBrowser'), loadBrowsers)
              : h('div', null,
                h('div', { className: 'cm-group' }, t('chooseBrowser')),
                browsers.length === 0
                  ? h('div', { className: 'cm-empty' }, t('noBrowsers'))
                  : h('div', { className: 'cm-apps' }, browsers.map((one) => urlItem(
                    t('openInBrowserNamed').replace('{name}', one.name),
                    () => openUrl(one.id),
                  )))),
            urlItem(t('copyUrl'), () => copy(menu.url, 'copyUrlDone')),
            urlItem(t('copyUrlMarkdown'), () => copy(
              `[${menu.text.length > 0 ? menu.text : menu.displayUrl ?? menu.url}](${menu.url})`,
              'copyUrlMarkdownDone',
            )),
            note.length > 0 ? h('div', { className: 'cm-note' }, note) : null)
          }

          // 菜单不要超出视口
          const width = 200
          const height = apps === null ? 190 : 190 + Math.min(apps.length, 6) * 28
          const x = Math.min(menu.x, Math.max(8, window.innerWidth - width - 8))
          const y = Math.min(menu.y, Math.max(8, window.innerHeight - height - 8))

          // 直接用 Session Remote 的桌面能力，不走「会话命令」通道。
          //
          // 命令通道（remote.commands.execute）会把 command/run、command/done
          // 持久写进会话日志，并作为流程节点渲染到对话里 —— 这就是之前点一次
          // 「打开方式」就在对话框里出现一行 "chat-file …" 的原因。
          // 这里改用现成的 Remote 方法，既不写日志也不影响对话。
          //
          // 注意：remote.session 已在 inject 里声明，这里直接取用。
          const sessionRemote = () => {
            const session = ctx.remote?.session
            if (session === undefined) throw new Error(t('noDesktop'))
            return session
          }

          /** 打开 / 用指定应用打开 / 定位文件。 */
          const openPath = async (request) => {
            const session = sessionRemote()
            if (typeof session.openWorkspacePath !== 'function') throw new Error(t('noDesktop'))
            const result = await session.openWorkspacePath({ path: menu.path, ...request })
            if (result?.ok === false) throw new Error(result?.error?.message ?? t('openFailed'))
            return true
          }

          const act = async (request) => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              await openPath(request)
              setMenu(null)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const copyPath = async () => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              await navigator.clipboard.writeText(menu.path)
              setNote(t('copied'))
              window.setTimeout(() => setMenu(null), 600)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const saveAs = async () => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              const picker = ctx.remote?.directoryPicker
              if (picker === undefined || typeof picker.pick !== 'function') throw new Error(t('noPicker'))
              const dir = await picker.pick()
              if (dir === null || dir === undefined) { setMenu(null); return }
              // 浏览器不能写任意目录，所以"复制到所选目录"只能由宿主完成。
              // 宿主侧唯一的非日志通道是插件注册的远程方法，普通插件拿不到；
              // 因此这里只能用 /chat-file 命令 —— 代价是对话里会留一条命令记录。
              const text = await runCommand(
                (ctx.sessions?.list?.getSnapshot?.()?.ids ?? [])[0],
                `/chat-file --path64=${encodeArg(menu.path)} --action=saveas --target64=${encodeArg(dir)}`,
              )
              setNote(`${t('savedTo')}: ${String(text ?? '').trim()}`)
              window.setTimeout(() => setMenu(null), 900)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const loadApps = async () => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              const session = sessionRemote()
              if (typeof session.workspacePathApplications !== 'function') throw new Error(t('noDesktop'))
              const result = await session.workspacePathApplications({ path: menu.path }, new AbortController().signal)
              const value = result?.ok === false ? [] : (result?.value ?? result)
              const list = Array.isArray(value) ? value : []
              setApps(list.map((app) => ({ id: String(app.id), name: String(app.name), isDefault: app.default === true })))
              if (list.length === 0) setNote(t('noApps'))
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          /* 下面四个动作必须由宿主完成（浏览器写不了本地文件），
             所以只能走会话命令；代价是对话里会留一条命令记录。
             打开 / 定位 / 打开方式仍然走 Remote，不写日志。 */

          const runHostFileAction = async (line, successKey) => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              const text = await runCommand(sessionIdOf(), line)
              setNote(successKey === undefined ? String(text ?? '') : t(successKey))
              window.setTimeout(() => setMenu(null), 700)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const openTerminal = () => runHostFileAction(
            `/chat-file --path64=${encodeArg(menu.path)} --action=terminal`,
          )

          const copyReference = async () => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              // @引用格式：和 DSH 输入框里的文件引用一致，粘贴即可定位到这个文件
              await navigator.clipboard.writeText(`@${menu.path}`)
              setNote(t('copyRefDone'))
              window.setTimeout(() => setMenu(null), 700)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const renameFile = async () => {
            if (busy) return
            const current = String(menu.path).split(/[\\/]/).pop() ?? ''
            const next = window.prompt(t('renameHint'), current)
            if (next === null || next.trim().length === 0 || next.trim() === current) return
            await runHostFileAction(
              `/chat-file --path64=${encodeArg(menu.path)} --action=rename --name64=${encodeArg(next.trim())}`,
              'renameDone',
            )
          }

          const moveToTrash = async () => {
            if (busy) return
            await runHostFileAction(
              `/chat-file --path64=${encodeArg(menu.path)} --action=trash`,
              'moveToTrashDone',
            )
          }

          /* ---- 类型专属动作 ---- */

          // 复制文件内容：走宿主读取，再写剪贴板。
          // 浏览器直接 fetch(file://) 会被同源策略拦掉，只能让宿主读。
          const copyContent = async (asMarkdown, language) => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              const text = await runCommand(
                sessionIdOf(),
                `/chat-file --path64=${encodeArg(menu.path)} --action=read`,
              )
              const body = String(text ?? '')
              if (body.length === 0) throw new Error(t('noContent'))
              const payload = asMarkdown === true
                ? '```' + String(language ?? '') + '\n' + body.replace(/\n$/, '') + '\n```'
                : body
              await navigator.clipboard.writeText(payload)
              setNote(t(asMarkdown === true ? 'copyAsMarkdownDone' : 'copyCodeDone'))
              window.setTimeout(() => setMenu(null), 700)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const extractArchive = async () => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              const text = await runCommand(
                sessionIdOf(),
                `/chat-file --path64=${encodeArg(menu.path)} --action=extract`,
              )
              setNote(`${t('extractDone')}: ${String(text ?? '').trim()}`)
              window.setTimeout(() => setMenu(null), 1100)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const showInfo = async () => {
            if (busy) return
            setBusy(true)
            setNote('')
            try {
              const text = await runCommand(
                sessionIdOf(),
                `/chat-file --path64=${encodeArg(menu.path)} --action=info`,
              )
              const info = JSON.parse(String(text ?? '{}'))
              const kb = Number(info?.size ?? 0)
              const sizeText = kb >= 1024 * 1024
                ? `${(kb / 1024 / 1024).toFixed(1)} MB`
                : kb >= 1024 ? `${(kb / 1024).toFixed(1)} KB` : `${kb} B`
              const when = info?.modifiedAt === undefined
                ? ''
                : new Date(Number(info.modifiedAt)).toLocaleString()
              setNote(`${t('fileSize')}: ${sizeText}    ${t('modifiedAt')}: ${when}`)
            } catch (failure) {
              setNote(String(failure?.message ?? failure))
            } finally {
              setBusy(false)
            }
          }

          const item = (label, onClick) => h('button', {
            type: 'button',
            role: 'menuitem',
            className: 'cm-item',
            disabled: busy,
            onClick: (event) => { event.preventDefault(); event.stopPropagation(); onClick() },
          }, label)

          // 读当前主题明暗：浅色主题需要更强的高光、更轻的阴影，
          // 否则玻璃边缘会糊掉。读不到就按深色处理（DSH 默认偏深）。
          const scheme = (() => {
            try {
              const active = ctx.theme?.getTheme?.()?.active?.colorScheme
              return active === 'light' ? 'light' : 'dark'
            } catch {
              return 'dark'
            }
          })()

          /**
           * 按文件类型决定菜单内容。
           *
           * 设计取舍：**通用项永远在**（打开 / 定位 / 复制路径 / 重命名 / 回收站），
           * 类型专属项插在中间。这样用户不用记"这个文件有没有那一项"，
           * 肌肉记忆始终成立；同时高频的类型操作又不用翻两层菜单。
           */
          const kind = kindOf(menu.path)
          const ext = (() => {
            const name = String(menu.path).split(/[\\/]/).pop() ?? ''
            const dot = name.lastIndexOf('.')
            return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
          })()

          const typeItems = []
          if (kind === 'image') {
            typeItems.push(item(t('showInfo'), showInfo))
          } else if (kind === 'code') {
            typeItems.push(item(t('copyCode'), () => copyContent(false)))
            typeItems.push(item(t('copyAsMarkdown'), () => copyContent(true, ext)))
            typeItems.push(item(t('showInfo'), showInfo))
          } else if (kind === 'doc') {
            typeItems.push(item(t('copyContent'), () => copyContent(false)))
            typeItems.push(item(t('showInfo'), showInfo))
          } else if (kind === 'archive') {
            typeItems.push(item(t('extractHere'), extractArchive))
            typeItems.push(item(t('showInfo'), showInfo))
          } else if (kind === 'media') {
            typeItems.push(item(t('showInfo'), showInfo))
          } else if (kind === 'binary') {
            // 可执行文件只给「定位」和「信息」，不给任何"运行"入口 —— 见下方说明
            typeItems.push(item(t('showInfo'), showInfo))
          } else {
            typeItems.push(item(t('showInfo'), showInfo))
          }

          return h('div', {
            ref: boxRef,
            role: 'menu',
            className: 'cm-ctxmenu',
            'data-cm-scheme': scheme,
            'data-cm-kind': kind,
            style: { left: `${x}px`, top: `${y}px` },
            onContextMenu: (event) => event.preventDefault(),
          },
          h('div', { className: 'cm-path', title: menu.path }, menu.path),
          h('div', { className: 'cm-group' }, t(KIND_LABEL[kind] ?? 'kindOther')),
          item(t('openFile'), () => act({})),
          item(t('openFolder'), () => act({ action: 'reveal' })),
          ...typeItems,
          item(t('openTerminal'), openTerminal),
          item(t('copyPath'), copyPath),
          item(t('copyRef'), copyReference),
          item(t('saveAs'), saveAs),
          item(t('rename'), renameFile),
          apps === null
            ? item(t('chooseApp'), loadApps)
            : h('div', null,
              h('div', { className: 'cm-group' }, t('chooseApp')),
              apps.length === 0
                ? h('div', { className: 'cm-empty' }, t('noApps'))
                : h('div', { className: 'cm-apps' }, apps.map((app) => item(
                  app.isDefault === true ? `${app.name} (${t('defaultApp')})` : app.name,
                  () => act({ application: app.id }),
                )))),
          item(t('moveToTrash'), moveToTrash),
          note.length > 0 ? h('div', { className: 'cm-note' }, note) : null)
        }

        /* ---------------- better-sidebar 适配（可选） ---------------- */

        /**
         * 把管家的设置页注册成 better-sidebar 的一个标签页。
         *
         * 三条硬约束，决定这段代码长这样：
         *
         * 1. **没装时必须零影响**。ctx.get('betterSidebar') 是弱引用访问，
         *    没装就是 undefined，直接 return，后面一行都不执行。
         *    这是本适配唯一允许的探测方式：把 betterSidebar 写进 inject 会让
         *    没装它的用户整个插件挂掉（受限代理找不到服务就抛错）。
         * 2. **装了也不能拖垮管家**。整个注册包在 try/catch 里，
         *    better-sidebar 的 API 若在未来版本变化，失败只表现为"少一个标签页"，
         *    原有的设置页 / 对话菜单 / 文件菜单照常工作。
         * 3. **不能重复注册**。同一个 id 注册两次，better-sidebar 的行为未定义，
         *    所以先 getTab(id) 探测一次。
         */
        function adaptBetterSidebar() {
          /**
           * 服务是异步出现的，所以要轮询；但轮询必须短。
           *
           * 为什么不能只试一次：管家声明了 `immediately: true`，它的 apply 会先于
           * better-sidebar 的 `ctx.provide('betterSidebar', …)` 执行；一次性探测必然
           * 拿到 undefined，适配永远不生效。
           *
           * 为什么上限是 10 次（约 2 秒）而不是 25 次：实测 better-sidebar 0.28.0 在
           * DSH 0.2.1-rc.3 上右栏注册是坏的（它用 `injected.get(...)` 取服务，拿到的
           * 是 undefined 后静默 return），而没装它的人占绝大多数。轮询越久，没装的人
           * 每次加载就白等越久。2 秒足够覆盖正常的注册时序，之后安静放弃。
           */
          let attempts = 0
          let done = false
          let timer = null

          const attempt = () => {
            if (done) return
            attempts += 1

            let service
            try {
              service = ctx.get('betterSidebar')
            } catch {
              service = undefined
            }

            if (service === undefined || service === null || typeof service.registerTab !== 'function') {
              if (attempts < 10) timer = setTimeout(attempt, 200)
              return
            }

            done = true
            registerStewardTab(service)
          }

          // ctx.effect 的回调在插件卸载 / HMR 重载时执行，用来清掉还挂着的定时器。
          // 不加这个，热替换会留下一个跑满 10 秒的旧定时器，反复重载就堆积。
          ctx.effect(() => {
            attempt()
            return () => {
              done = true
              if (timer !== null) clearTimeout(timer)
            }
          }, 'dsh-steward: better-sidebar adapt')
        }

        /** 真正往 better-sidebar 里塞标签页；失败只记日志，绝不影响管家本体。 */
        function registerStewardTab(service) {
          const TAB_ID = 'dsh-steward:panel'
          try {
            if (typeof service.getTab === 'function' && service.getTab(TAB_ID) !== undefined) return
          } catch {
            // 探测失败就当作没注册过，继续；重复注册的后果由下面的 try 兜住
          }

          /**
           * 标签页正文：复用设置页外壳，但把会话锁定成这个标签所属的会话。
           *
           * 为什么必须锁：侧边栏标签是「某会话的页面」，回收站/备份/体检这些
           * 命令都要落在那个会话上；不锁的话 sessionIdOf() 会取到会话列表第一个，
           * 在多面板下打错目标。卸载时恢复原值，避免污染别的标签页。
           */
          function StewardTab(props) {
            const scopeSession = props?.scope?.sessionId
            useEffect(() => {
              const previous = sessionOverride
              sessionOverride = typeof scopeSession === 'string' ? scopeSession : null
              return () => { sessionOverride = previous }
            }, [scopeSession])
            return h(SettingsPage)
          }

          try {
            service.registerTab({
              id: TAB_ID,
              title: () => t('nav'),
              description: () => t('sidebarTabDesc'),
              order: 60,
              single: true,
              // 声明一个空的 pluginToggles：better-sidebar 会因此给这个标签页
              // 生成一行「启用/停用」开关，用户可以单独关掉管家这一页。
              settings: { pluginToggles: [] },
              component: StewardTab,
            })
          } catch (error) {
            try { console.error('[dsh-steward] better-sidebar tab registration failed:', error) } catch {}
          }
        }

        adaptBetterSidebar()

        /* ---------------- 注册 ---------------- */

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-steward-settings',
          order: 32,
          label: () => t('nav'),
        }, SettingsPage))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'dsh-steward-delete',
          order: 420,
        }, DeleteMenuRow))

        // 「打开该对话的文件夹」：排在删除之前，日常用得多
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'dsh-steward-open-folder',
          order: 410,
        }, OpenFolderMenuRow))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-steward-dialog',
          order: 900,
        }, DeleteDialog))

        // 交付物文件的右键菜单。
        // 不用 deliverables.file.actions —— 那是"往文件行里塞按钮"的位置，
        // 用户要的是右键，所以这里挂一个全局菜单层，由它自己拦截 contextmenu。
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-steward-file-menu',
          order: 950,
        }, FileContextMenu))
      },
    }
  },
})
