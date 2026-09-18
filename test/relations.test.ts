import assert from 'node:assert'
import {
  canAddRelation,
  listRelations,
  normalizeRelations,
  normalizeRelationType,
  relationKey,
  relationTypes,
  summarizeRelations,
} from '../src/lib/relations'
import { buildReviewReport, type ReportInput } from '../src/lib/report'
import type { Annotation, AnnotationRelation } from '../src/types'

function mkAnn(partial: Partial<Annotation> & { id: string }): Annotation {
  return {
    quote: '',
    start: 0,
    end: 0,
    note: '',
    tags: [],
    status: 'bound',
    createdAt: 1,
    updatedAt: 1,
    contextBefore: '',
    contextAfter: '',
    ...partial,
  }
}

function mkRel(partial: Partial<AnnotationRelation> & { id: string }): AnnotationRelation {
  return {
    sourceId: 'a',
    targetId: 'b',
    type: '因果',
    createdAt: 1,
    ...partial,
  }
}

// 1. 关系类型归一：去首尾空白、内部连续空白压缩
{
  assert.strictEqual(normalizeRelationType('  因果  '), '因果')
  assert.strictEqual(normalizeRelationType('并列\t关系'), '并列 关系')
  assert.strictEqual(normalizeRelationType('a   b\n c'), 'a b c')
  assert.strictEqual(normalizeRelationType('   '), '')
  console.log('  ✓ 关系类型归一：trim 与内部空白压缩')
}

// 2. normalizeRelations：非数组 / 缺字段 / 自关联 / 完全重复
{
  assert.deepStrictEqual(normalizeRelations(undefined), [])
  assert.deepStrictEqual(normalizeRelations('x'), [])
  assert.deepStrictEqual(normalizeRelations([null, 1, 'x']), [])
  const cleaned = normalizeRelations([
    { id: 'r1', sourceId: 'a', targetId: 'b', type: '因果', createdAt: 10 },
    { id: 'r2', sourceId: 'a', targetId: 'a', type: '因果', createdAt: 20 }, // 自关联 → 丢弃
    { id: 'r3', sourceId: 'a', targetId: 'b', type: ' 因果 ', createdAt: 30 }, // 归一后与 r1 完全重复 → 丢弃
    { id: 'r4', sourceId: 'b', targetId: 'a', type: '因果', createdAt: 40 }, // 反向不算重复 → 保留
    { id: 'r5', sourceId: 'a', targetId: 'b', type: '并列', createdAt: 50 }, // 类型不同不算重复 → 保留
    { id: '', sourceId: '', targetId: 'b', type: '因果', createdAt: 60 }, // 缺源 → 丢弃
    { id: 'r7', sourceId: 'a', targetId: 'b', type: '   ', createdAt: 70 }, // 空类型 → 丢弃
  ])
  assert.deepStrictEqual(
    cleaned.map((r) => r.id),
    ['r1', 'r4', 'r5'],
    '自关联 / 完全重复 / 缺字段条目应被剔除',
  )
  assert.strictEqual(cleaned[0]!.type, '因果', '类型应归一化')
  // createdAt 兼容 ISO 字符串与非法值
  const withTime = normalizeRelations([
    { id: 't1', sourceId: 'a', targetId: 'b', type: 'x', createdAt: '2026-09-18T00:00:00.000Z' },
    { id: 't2', sourceId: 'a', targetId: 'b', type: 'y', createdAt: 'not-a-date' },
  ])
  assert.strictEqual(withTime[0]!.createdAt, Date.parse('2026-09-18T00:00:00.000Z'))
  assert.ok(Number.isFinite(withTime[1]!.createdAt), '非法时间应回退为当前时间')
  // 缺 id 时自动补全
  const noId = normalizeRelations([{ sourceId: 'a', targetId: 'b', type: 'x', createdAt: 1 }])
  assert.ok(noId[0]!.id.startsWith('rel_'), '缺失 id 应自动生成')
  console.log('  ✓ normalizeRelations：清洗、自关联剔除、完全重复保留第一条')
}

// 3. relationKey 有向：a→b 与 b→a 不同
{
  assert.notStrictEqual(relationKey('a', 'b', 'x'), relationKey('b', 'a', 'x'))
  assert.notStrictEqual(relationKey('a', 'b', 'x'), relationKey('a', 'b', 'y'))
  console.log('  ✓ relationKey：方向与类型均参与判重')
}

// 4. canAddRelation：各种禁止与放行情形
{
  const anns = [
    mkAnn({ id: 'a', status: 'bound' }),
    mkAnn({ id: 'b', status: 'bound' }),
    mkAnn({ id: 'p', status: 'pending' }),
  ]
  const rels = [mkRel({ id: 'r1', sourceId: 'a', targetId: 'b', type: '因果' })]
  // 正常建立
  const ok = canAddRelation(rels, anns, 'b', 'a', '因果')
  assert.ok(ok.ok, '反向关系应允许建立')
  // 类型归一后返回
  const okNorm = canAddRelation(rels, anns, 'a', 'b', ' 并列 ')
  assert.ok(okNorm.ok && okNorm.type === '并列')
  // 自关联
  const self = canAddRelation(rels, anns, 'a', 'a', 'x')
  assert.ok(!self.ok && self.reason.includes('自关联'))
  // 完全重复（类型含多余空白，归一后命中）
  const dup = canAddRelation(rels, anns, 'a', 'b', ' 因果 ')
  assert.ok(!dup.ok && dup.reason.includes('已存在'))
  // 待处理端
  const pend = canAddRelation(rels, anns, 'a', 'p', 'x')
  assert.ok(!pend.ok && pend.reason.includes('已绑定'))
  // 不存在的端
  const missing = canAddRelation(rels, anns, 'a', 'ghost', 'x')
  assert.ok(!missing.ok && missing.reason.includes('不存在'))
  // 空类型 / 未选择
  assert.ok(!canAddRelation(rels, anns, 'a', 'b', '  ').ok)
  assert.ok(!canAddRelation(rels, anns, '', 'b', 'x').ok)
  console.log('  ✓ canAddRelation：自关联 / 完全重复 / 待处理端均被禁止')
}

// 5. listRelations：有效性派生（删除 → 失效；待处理 → 失效；重新绑定 → 恢复）
{
  const rels = [
    mkRel({ id: 'r1', sourceId: 'a', targetId: 'b', type: '因果', createdAt: 1 }),
    mkRel({ id: 'r2', sourceId: 'b', targetId: 'c', type: '并列', createdAt: 2 }),
    mkRel({ id: 'r3', sourceId: 'c', targetId: 'a', type: '引用', createdAt: 3 }),
  ]
  const allBound = [
    mkAnn({ id: 'a' }),
    mkAnn({ id: 'b' }),
    mkAnn({ id: 'c' }),
  ]
  // 全部已绑定 → 全有效
  const items1 = listRelations(rels, allBound)
  assert.strictEqual(items1.filter((i) => i.valid).length, 3)
  assert.deepStrictEqual(summarizeRelations(items1), { total: 3, valid: 3, invalid: 0 })
  // b 进入待处理 → r1、r2 失效，原因分别为目标 / 源待处理
  const withPending = allBound.map((a) => (a.id === 'b' ? { ...a, status: 'pending' as const } : a))
  const items2 = listRelations(rels, withPending)
  const byId2 = new Map(items2.map((i) => [i.relation.id, i]))
  assert.strictEqual(byId2.get('r1')!.valid, false)
  assert.ok(byId2.get('r1')!.invalidReason!.includes('目标标注待处理'))
  assert.strictEqual(byId2.get('r2')!.valid, false)
  assert.ok(byId2.get('r2')!.invalidReason!.includes('源标注待处理'))
  assert.strictEqual(byId2.get('r3')!.valid, true)
  assert.deepStrictEqual(summarizeRelations(items2), { total: 3, valid: 1, invalid: 2 })
  // b 重新绑定 → 全部恢复
  const items3 = listRelations(rels, allBound)
  assert.strictEqual(summarizeRelations(items3).invalid, 0, '重新绑定后关系应自动恢复')
  // c 被删除 → r2、r3 失效（已删除原因）
  const withoutC = allBound.filter((a) => a.id !== 'c')
  const items4 = listRelations(rels, withoutC)
  const byId4 = new Map(items4.map((i) => [i.relation.id, i]))
  assert.ok(byId4.get('r2')!.invalidReason!.includes('目标标注已删除'))
  assert.ok(byId4.get('r3')!.invalidReason!.includes('源标注已删除'))
  assert.strictEqual(byId4.get('r1')!.valid, true)
  // 排序：类型字典序（码元）→ 创建时间；因(56E0) < 并(5E76) < 引(5F15)
  assert.deepStrictEqual(
    items1.map((i) => i.relation.id),
    ['r1', 'r2', 'r3'],
    '应按类型码元字典序排序',
  )
  console.log('  ✓ listRelations：删除 / 待处理自动失效，重新绑定自动恢复')
}

// 6. relationTypes：去重 + 字典序
{
  const rels = [
    mkRel({ id: 'r1', type: '因果' }),
    mkRel({ id: 'r2', type: '并列' }),
    mkRel({ id: 'r3', type: '因果', targetId: 'c' }),
  ]
  assert.deepStrictEqual(relationTypes(rels), ['因果', '并列'])
  assert.deepStrictEqual(relationTypes([]), [])
  console.log('  ✓ relationTypes：去重并按字典序排列')
}

// 7. 审阅报告：有效 / 失效关系汇总与明细
{
  const text = '甲乙丙丁戊己庚辛壬癸'
  const input: ReportInput = {
    title: '关系报告',
    text,
    annotations: [
      mkAnn({ id: 'a', quote: text.slice(0, 2), start: 0, end: 2 }),
      mkAnn({ id: 'b', quote: text.slice(3, 5), start: 3, end: 5 }),
      mkAnn({ id: 'p', quote: '消失的引文', status: 'pending', start: 0, end: 0 }),
    ],
    conflictRules: [],
    ignoredConflicts: [],
    coverageTags: [],
    relations: [
      mkRel({ id: 'r1', sourceId: 'a', targetId: 'b', type: '因果', createdAt: 1 }),
      mkRel({ id: 'r2', sourceId: 'b', targetId: 'p', type: '并列', createdAt: 2 }),
      mkRel({ id: 'r3', sourceId: 'a', targetId: 'ghost', type: '引用', createdAt: 3 }),
    ],
  }
  const report = buildReviewReport(input, new Date('2026-09-18T03:04:05.000Z'))
  assert.strictEqual(report.stats.relationsValid, 1)
  assert.strictEqual(report.stats.relationsInvalid, 2)
  const html = report.html
  assert.ok(html.includes('标注关系（3）'), '应有关系统计分区')
  assert.ok(html.includes('有效关系（1）'), '应列出有效关系分组')
  assert.ok(html.includes('失效关系（2）'), '应列出失效关系分组')
  assert.ok(html.includes('rep-rel-type'), '应渲染关系类型')
  assert.ok(html.includes('因果'), '应包含关系类型文本')
  assert.ok(html.includes('目标标注待处理'), '应给出待处理失效原因')
  assert.ok(html.includes('目标标注已删除'), '应给出已删除失效原因')
  assert.ok(html.includes('href="#ann-1"'), '有效关系的端应链接到标注明细')
  assert.ok(html.includes('rep-rel-invalid'), '失效关系应有失效样式类')
  // 汇总卡片
  assert.ok(html.includes('>1</span><span class="rep-stat-label">有效关系'), '汇总应含有效关系数')
  assert.ok(html.includes('>2</span><span class="rep-stat-label">失效关系'), '汇总应含失效关系数')
  // 纯函数：不修改输入
  const again = buildReviewReport(input, new Date('2026-09-18T03:04:05.000Z'))
  assert.strictEqual(again.html, html, '相同输入应产出相同 HTML')
  console.log('  ✓ 审阅报告：有效 / 失效关系汇总与明细')
}

// 8. 报告边界：无关系时
{
  const report = buildReviewReport(
    {
      title: '空',
      text: '',
      annotations: [],
      conflictRules: [],
      ignoredConflicts: [],
      coverageTags: [],
      relations: [],
    },
    new Date('2026-09-18T03:04:05.000Z'),
  )
  assert.strictEqual(report.stats.relationsValid, 0)
  assert.strictEqual(report.stats.relationsInvalid, 0)
  assert.ok(report.html.includes('没有标注关系'), '无关系时应有空态提示')
  console.log('  ✓ 报告边界：无关系空态')
}

console.log('\n标注关系测试全部通过')
