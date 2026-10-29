/**
 * 「@文件引用 chip」的识别测试。
 *
 * 对话里那个 `交接日志.md` 小标签，DOM 上只有文件名（title = label），
 * 完整路径在 React props 里拿不到。插件靠三条同时成立来认它：
 *   1) span 且有 title
 *   2) textContent 与 title 完全一致
 *   3) 内部有 svg 图标
 *
 * 这三条太松会误判（普通带 title 的文字被当成文件），太紧会认不出。
 * 这里用假 DOM 把两个方向都钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** 抠出 chipOf 的函数体。 */
function extractChipOf() {
  const start = client.indexOf('const chipOf = (target) => {')
  assert.ok(start >= 0, 'client.js 里找不到 chipOf')
  const rest = client.slice(start)
  const end = rest.indexOf('\n          }')
  assert.ok(end > 0, 'chipOf 的结尾没找到')
  return new Function(`${rest.slice(0, end + '\n          }'.length)};return chipOf;`)()
}

const chipOf = extractChipOf()

/** 极简假 DOM 节点。 */
function el({ tag = 'SPAN', attrs = {}, text = '', hasSvg = false, parent = null } = {}) {
  const node = {
    tagName: tag,
    _attrs: attrs,
    _text: text,
    _hasSvg: hasSvg,
    _parent: parent,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null
    },
    get textContent() {
      return this._text
    },
    querySelector(selector) {
      if (selector === 'svg') return this._hasSvg ? { tagName: 'svg' } : null
      return null
    },
    closest(selector) {
      if (selector === 'span[title]') {
        let cur = this
        while (cur !== null) {
          if (cur.tagName === 'SPAN' && cur.getAttribute('title') !== null) return cur
          cur = cur._parent
        }
        return null
      }
      return null
    },
  }
  return node
}

test('真正的 @引用 chip 要认出来', () => {
  // <span title="交接日志.md"><svg/><span>交接日志.md</span></span>
  const chip = el({ attrs: { title: '交接日志.md' }, text: '交接日志.md', hasSvg: true })
  const hit = chipOf(chip)
  assert.ok(hit !== undefined, '应该认出这是文件 chip')
  assert.equal(hit.name, '交接日志.md')
})

test('点在 chip 内部的子节点上也能认出来', () => {
  const chip = el({ attrs: { title: 'PRD.md' }, text: 'PRD.md', hasSvg: true })
  const inner = el({ tag: 'SPAN', text: 'PRD.md', parent: chip })
  const hit = chipOf(inner)
  assert.ok(hit !== undefined, '从子节点往上找应该命中父 chip')
  assert.equal(hit.name, 'PRD.md')
})

test('普通带 title 的文字不能误判', () => {
  // 没有 svg 图标 -> 不是 chip
  const plain = el({ attrs: { title: '交接日志.md' }, text: '交接日志.md', hasSvg: false })
  assert.equal(chipOf(plain), undefined, '没有图标的不能算 chip')

  // 文本和 title 不一致 -> 不是 chip（chip 的文本就是 label）
  const mismatch = el({ attrs: { title: 'a.md' }, text: '完全不同的文字', hasSvg: true })
  assert.equal(chipOf(mismatch), undefined, '文本与 title 不一致的不能算 chip')

  // 没有 title -> 不是
  const noTitle = el({ text: '交接日志.md', hasSvg: true })
  assert.equal(chipOf(noTitle), undefined)
})

test('目录引用（没有扩展名）不处理', () => {
  const dirChip = el({ attrs: { title: 'docs' }, text: 'docs', hasSvg: true })
  assert.equal(chipOf(dirChip), undefined, '目录引用没有扩展名，交给 DSH 自己的打开逻辑')
})

test('null / 非元素输入不炸', () => {
  assert.equal(chipOf(null), undefined)
  assert.equal(chipOf(undefined), undefined)
  assert.equal(chipOf({}), undefined)
})
