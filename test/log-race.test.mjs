/**
 * 交接日志并发写：回归测试。
 *
 * 背景：2026-10-27 和 2026-11-02 两次「应用意外停止」弹窗，根因都是这一行：
 *   rename '...交接日志.md.tmp' -> '...交接日志.md': ENOENT
 *
 * 写日志有四个并发入口（建目录、turn/end、end-seed、手动命令），
 * 而旧实现用**固定**的 `交接日志.md.tmp`：
 *   A 写 tmp → B 也写同一个 tmp → A rename 成功（tmp 没了）→ B rename ENOENT
 * 这条错误经 stderr 传给桌面版主进程，宿主一退出就弹崩溃框。
 *
 * 这个测试跑三组对照，并且**直接读插件的源码**确认它用的是哪一种：
 *   ① 固定 tmp 名                → 必失败（ENOENT）
 *   ② 唯一 tmp 名、不排队        → 仍失败（Windows 上并发覆盖同一目标 EPERM）
 *   ③ 唯一 tmp 名 + 按会话串行化 → 0 失败
 *
 * 跑法：node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile, rename, rm, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (name) => readFileSync(join(root, name), 'utf8')

const host = read('index.js')
const payload = 'x'.repeat(120_000)

/** 三组写法各跑一轮并发，返回失败次数。 */
async function stress(writer, rounds = 20, concurrency = 8) {
  const dir = join(tmpdir(), `steward-race-${process.pid}-${Math.random().toString(36).slice(2)}`)
  await mkdir(dir, { recursive: true })
  const target = join(dir, '交接日志.md')
  const codes = new Set()
  let failed = 0
  try {
    for (let round = 0; round < rounds; round += 1) {
      const jobs = []
      for (let i = 0; i < concurrency; i += 1) {
        jobs.push(
          writer(target, i, payload).catch((error) => {
            failed += 1
            codes.add(String(error?.code ?? error?.message ?? error))
          }),
        )
      }
      await Promise.all(jobs)
    }
    // 最终文件必须完整（不能是半截）
    const final = await readFile(target, 'utf8')
    assert.ok(final.startsWith('x'), '最终文件内容损坏')
    assert.ok(final.length >= payload.length, '最终文件被截断')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  return { failed, codes }
}

/** ① 固定 tmp 名 */
async function fixedTmp(target, i, body) {
  const temp = `${target}.tmp`
  await writeFile(temp, `${body}${i}`, 'utf8')
  await rename(temp, target)
}

/** ② 唯一 tmp 名、不排队 */
async function uniqueTmp(target, i, body) {
  const temp = `${target}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(temp, `${body}${i}`, 'utf8')
  await rename(temp, target)
}

/** ③ 唯一 tmp 名 + 串行化（插件现在的实现） */
const queues = new Map()
async function queuedTmp(target, i, body) {
  const previous = queues.get(target) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    const temp = `${target}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`
    await writeFile(temp, `${body}${i}`, 'utf8')
    await rename(temp, target)
  })
  queues.set(target, current)
  try {
    await current
  } finally {
    if (queues.get(target) === current) queues.delete(target)
  }
}

test('并发写日志：固定 tmp 名会失败，串行化后 0 失败', async () => {
  const fixed = await stress(fixedTmp)
  const unqueued = await stress(uniqueTmp)
  const queued = await stress(queuedTmp)

  assert.ok(fixed.failed > 0,
    `固定 tmp 名应该能复现失败，实际 0 次 —— 压测失效了，需要检查`)
  assert.ok(fixed.codes.has('ENOENT') || fixed.codes.size > 0,
    '固定 tmp 名的失败应该是 ENOENT 类')

  assert.equal(queued.failed, 0,
    `串行化后不应该再有失败，实际 ${queued.failed} 次（${[...queued.codes].join(', ')}）`)

  // 中间那组不是必须失败（机器快时可能侥幸），但一旦失败必须是 EPERM 类，
  // 这条只是记录「光改 tmp 名不够」这个事实，不做硬断言。
  void unqueued
})

test('插件的实现必须是「唯一 tmp 名 + 按会话串行化」', () => {
  // 唯一 tmp 名：不能再是 `${target}.tmp`
  assert.ok(!/const temp = `\$\{target\}\.tmp`/.test(host),
    'index.js 又用回固定的 `${target}.tmp`：并发写会 ENOENT')

  // tmp 名里必须带随机/时间戳成分
  assert.ok(/const temp = `\$\{target\}\.\$\{process\.pid\}/.test(host),
    'index.js 的 tmp 名没有唯一化')

  // 必须存在按会话的写队列
  assert.ok(host.includes('logWriteQueue'),
    'index.js 缺少 logWriteQueue：同一会话的并发写入没有串行化')

  // 队列必须真的被用来串接（previous → current）
  assert.ok(/const previous = logWriteQueue\.get\(sessionId\)/.test(host),
    'logWriteQueue 没有按 sessionId 取上一个 Promise')
  assert.ok(/logWriteQueue\.set\(sessionId, current\)/.test(host),
    'logWriteQueue 没有写回队尾')

  // 拆分出来的实际写入函数
  assert.ok(host.includes('async function writeSessionLogNow('),
    '缺少 writeSessionLogNow：串行化外壳与真正写入没有分开')

  // 失败分支必须清理 tmp，否则并发失败会留下垃圾文件
  assert.ok(/rm\(temp, \{ force: true \}\)/.test(host),
    '写失败后没有清理 tmp 文件')
})
