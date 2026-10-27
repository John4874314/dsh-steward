/**
 * 正文里「什么算一个文件路径」的判定测试。
 *
 * 这段逻辑决定右键菜单会不会在正常阅读时乱弹，所以两个方向都要守住：
 *   - 该认的必须认（否则用户右键路径没反应，功能等于没有）
 *   - 不该认的绝不能被认（否则每读一句话都弹菜单，比没有更烦）
 *
 * 直接从 client.js 里抠出 looksLikePath 求值，不复制一份正则 ——
 * 复制会漂移，改了源码测试还绿着才是真的坏。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 抠出 looksLikePath 的函数体（到下一个同缩进的收尾大括号为止）。 */
function extractLooksLikePath() {
  const start = client.indexOf('const looksLikePath = (text) => {')
  assert.ok(start >= 0, 'client.js 里找不到 looksLikePath')
  const rest = client.slice(start)
  const end = rest.indexOf('\n          }')
  assert.ok(end > 0, 'looksLikePath 的结尾没找到')
  const source = rest.slice(0, end + '\n          }'.length)
  // 结尾的 `}` 之后补一个分号，让它成为完整语句
  return new Function(`${source};return looksLikePath;`)()
}

const looksLikePath = extractLooksLikePath()

const shouldMatch = [
  'C:\\Users\\a\\报告.docx',
  '@C:\\Users\\a\\报告.docx',
  'D:/work/notes.md',
  './docs/PRD.md',
  '../src/index.ts',
  '@docs/PRD.md',
  '@islet\\docs\\交接文档.md',
  '~/Documents/a.pdf',
  '/home/user/a.md',
]

const shouldNotMatch = [
  '',
  '你好',
  '这是一个句子，里面有标点。',
  'https://example.com/a.png',       // 网址由 urlOf 处理，这里不该抢
  'docs/PRD.md',                      // 没有 @ 前缀的相对路径，和普通文字太像，不认
  'see the docs folder',
  'C:\\',                             // 只有根，没有内容
  'a',
  'end.',
  'C:\\a b\\c.md',                    // 含空格（消息里通常已断开），不认
]

test('该认的路径都要认出来', () => {
  for (const sample of shouldMatch) {
    assert.equal(looksLikePath(sample), true, `应该认作路径：${sample}`)
  }
})

test('不该认的绝不能被认（避免满屏乱弹菜单）', () => {
  for (const sample of shouldNotMatch) {
    assert.equal(looksLikePath(sample), false, `不该认作路径：${JSON.stringify(sample)}`)
  }
})

test('超长文本不算路径（防止把整段正文当路径发给宿主）', () => {
  const long = 'C:\\a\\' + 'x'.repeat(500) + '.md'
  assert.equal(looksLikePath(long), false)
})

test('带换行的文本不算路径', () => {
  assert.equal(looksLikePath('C:\\a\\b.md\nC:\\c\\d.md'), false)
})
