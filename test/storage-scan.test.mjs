// 存储管家的核心判定：哪些附件已经没有会话再引用。
//
// 这是插件里**唯一会移动用户文件**的判断依据，判错就会把还在用的图片当成垃圾。
// 所以单独立一个测试文件，把 scanAttachments 从源码里抠出来、在临时 DSH_HOME 上跑，
// 用最小的真实结构（多帧 zstd 日志 + sha256 命名的附件）验证判定本身。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { readdir, stat, readFile, mkdir, writeFile } from 'node:fs/promises'

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

/** 从 index.js 抠出存储区段，拼成一个可调用的模块。 */
function loadStorageModule() {
  const start = source.indexOf('function attachmentsRoot()')
  const end = source.indexOf('/* 备份目录：用户自己决定留还是删')
  assert.ok(start > 0, 'attachmentsRoot 没找到')
  assert.ok(end > start, '存储区段结尾没找到')
  const body = source.slice(start, end)

  const noop = () => {}
  const factory = new Function(
    'zlib', 'join', 'readdir', 'stat', 'readFile', 'mkdir', 'writeFile',
    'sessionsRoot', 'trashRoot', 'newTrashId', 'movePath', 'ctxWarn',
    body + '\nreturn { scanAttachments, listFilesRecursive }',
  )
  return factory(
    zlib, join, readdir, stat, readFile, mkdir, writeFile,
    () => join(process.env.DSH_HOME, 'sessions'),
    () => join(process.env.DSH_HOME, 'trash'),
    () => 'id',
    async () => 'moved',
    noop,
  )
}

/** 造一个临时 DSH_HOME，返回 { home, putAttachment, putLog, done }。 */
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'steward-scan-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home

  return {
    home,
    /** 写一个附件，返回它的 sha256（也就是 DSH 用的文件名）。 */
    putAttachment(payload) {
      const buffer = Buffer.from(payload)
      const sha = createHash('sha256').update(buffer).digest('hex')
      const dir = join(home, 'attachments', 'v1', 'objects', sha.slice(0, 2))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, sha), buffer)
      return sha
    },
    /** 写一个多帧 zstd 会话日志，帧按传入的文本切。 */
    putLog(frames) {
      const dir = join(home, 'sessions', '--proj--', 'session-t')
      mkdirSync(dir, { recursive: true })
      const buffers = frames.map((text) => zlib.zstdCompressSync(Buffer.from(JSON.stringify({ text }))))
      writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(buffers))
    },
    /** 写一个「已进回收站但还能恢复」的会话日志。 */
    putTrashedLog(frames, id = '20260101-000000-abc123') {
      const dir = join(home, 'trash', id, 'session')
      mkdirSync(dir, { recursive: true })
      const buffers = frames.map((text) => zlib.zstdCompressSync(Buffer.from(JSON.stringify({ text }))))
      writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(buffers))
      return id
    },
    done() {
      process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
      assert.equal(existsSync(home), false, '临时沙箱没删干净')
    },
  }
}

test('被日志引用的附件不算孤儿，没被引用的才算', async () => {
  const box = sandbox()
  try {
    const used = box.putAttachment('used-bytes')
    const orphan = box.putAttachment('orphan-bytes')
    box.putLog(['look at ' + used])

    const { scanAttachments } = loadStorageModule()
    const result = await scanAttachments()

    assert.equal(result.ok, true)
    assert.equal(result.total, 2)
    assert.equal(result.referenced, 1)
    assert.equal(result.orphans.length, 1)
    assert.equal(result.orphans[0].name, orphan)
    assert.ok(!result.orphans.some((item) => item.name === used), '被引用的不能进孤儿列表')
  } finally {
    box.done()
  }
})

test('多帧日志必须逐帧解压，只读到第一帧会把后面的引用误判成孤儿', async () => {
  const box = sandbox()
  try {
    const first = box.putAttachment('first-frame')
    const second = box.putAttachment('second-frame')
    // 两个独立帧；如果实现只解第一帧，second 就会被误判成孤儿
    box.putLog(['ref ' + first, 'ref ' + second])

    const { scanAttachments } = loadStorageModule()
    const result = await scanAttachments()

    assert.equal(result.referenced, 2, '两帧里的引用都要算数')
    assert.equal(result.orphans.length, 0)
  } finally {
    box.done()
  }
})

test('没有会话日志时，所有附件都算孤儿', async () => {
  const box = sandbox()
  try {
    box.putAttachment('a')
    box.putAttachment('b')

    const { scanAttachments } = loadStorageModule()
    const result = await scanAttachments()

    assert.equal(result.total, 2)
    assert.equal(result.orphans.length, 2)
    assert.equal(result.logCount, 0)
  } finally {
    box.done()
  }
})

test('附件目录不存在时如实返回零，不抛错', async () => {
  const box = sandbox()
  try {
    const { scanAttachments } = loadStorageModule()
    const result = await scanAttachments()

    assert.equal(result.ok, true)
    assert.equal(result.total, 0)
    assert.deepEqual(result.orphans, [])
    assert.equal(result.orphanBytes, 0)
  } finally {
    box.done()
  }
})

test('损坏的半截帧不影响整体判定', async () => {
  const box = sandbox()
  try {
    const used = box.putAttachment('good-frame')
    const other = box.putAttachment('should-be-orphan')
    // 正常帧 + 一截坏数据（模拟正在写入的末尾帧）
    const dir = join(box.home, 'sessions', '--proj--', 'session-bad')
    mkdirSync(dir, { recursive: true })
    const good = zlib.zstdCompressSync(Buffer.from(JSON.stringify({ text: 'ref ' + used })))
    const broken = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01, 0x02])
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat([good, broken]))

    const { scanAttachments } = loadStorageModule()
    const result = await scanAttachments()

    assert.equal(result.referenced, 1, '好帧里的引用要算到')
    assert.equal(result.orphans.length, 1)
    assert.equal(result.orphans[0].name, other)
  } finally {
    box.done()
  }
})

// v1.6.2 修的 bug：回收站里可恢复的会话也是引用来源。
// 只扫 sessions/ 会把它们引用的附件误判成孤儿，用户一恢复对话图片就没了。
test('回收站里可恢复的会话，其引用的附件不算孤儿', async () => {
  const box = sandbox()
  try {
    const onlyInTrash = box.putAttachment('referenced-by-trashed-session')
    const reallyOrphan = box.putAttachment('nobody-uses-this')
    box.putTrashedLog(['see ' + onlyInTrash])

    const { scanAttachments } = loadStorageModule()
    const result = await scanAttachments()

    assert.equal(result.referenced, 1, '回收站会话的引用要算到')
    assert.equal(result.trashLogCount, 1, '要统计到回收站日志数')
    assert.equal(result.orphans.length, 1)
    assert.equal(result.orphans[0].name, reallyOrphan)
    assert.ok(
      !result.orphans.some((item) => item.name === onlyInTrash),
      '回收站会话还在引用的附件绝不能进孤儿列表',
    )
  } finally {
    box.done()
  }
})

test('活会话与回收站会话的引用要合并计算，不重复也不漏', async () => {
  const box = sandbox()
  try {
    const live = box.putAttachment('live-ref')
    const trashed = box.putAttachment('trash-ref')
    const neither = box.putAttachment('no-ref')
    box.putLog(['a ' + live])
    box.putTrashedLog(['b ' + trashed])

    const { scanAttachments } = loadStorageModule()
    const result = await scanAttachments()

    assert.equal(result.referenced, 2)
    assert.equal(result.logCount, 1, '活会话日志 1 个')
    assert.equal(result.trashLogCount, 1, '回收站日志 1 个')
    assert.equal(result.orphans.length, 1)
    assert.equal(result.orphans[0].name, neither)
  } finally {
    box.done()
  }
})
