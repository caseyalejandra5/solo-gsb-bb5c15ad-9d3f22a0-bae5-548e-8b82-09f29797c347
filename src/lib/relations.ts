// 标注关系：两条已绑定标注之间的有向关系（源 → 目标 + 关系类型）
//
// 建立规则：
//   - 源与目标都必须是当前【已绑定】的标注；
//   - 禁止自关联（源与目标是同一条标注）；
//   - 禁止完全重复（源 + 目标 + 关系类型完全相同）；方向相反或类型不同不算重复。
//
// 有效 / 失效为派生状态，不随记录持久化：
//   任一端标注被删除或进入待处理 → 关系自动失效；
//   待处理端重新绑定（恢复为已绑定）→ 关系自动恢复有效。
// 因此删除标注、编辑原文重定位、手动重绑等路径都不需要额外维护关系表。

import type { Annotation, AnnotationRelation } from '../types'

/** 关系类型归一：去首尾空白、内部连续空白压缩为单个空格（保证「完全重复」判断稳定） */
export function normalizeRelationType(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function makeRelationId(): string {
  return `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 完全重复判断的键：源 + 目标 + 类型（有向，a→b 与 b→a 不同） */
export function relationKey(sourceId: string, targetId: string, type: string): string {
  return `${sourceId} ${targetId} ${type}`
}

function parseTime(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return t
  }
  return Date.now()
}

/**
 * 清洗关系列表：非数组按空处理（旧版数据缺省）；缺字段、自关联的条目丢弃；
 * 完全重复（源 + 目标 + 类型相同）保留第一条。
 */
export function normalizeRelations(raw: unknown): AnnotationRelation[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AnnotationRelation[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const r = x as Partial<AnnotationRelation>
    const sourceId = typeof r.sourceId === 'string' ? r.sourceId : ''
    const targetId = typeof r.targetId === 'string' ? r.targetId : ''
    const type = normalizeRelationType(typeof r.type === 'string' ? r.type : '')
    if (!sourceId || !targetId || !type) continue
    if (sourceId === targetId) continue
    const key = relationKey(sourceId, targetId, type)
    if (seen.has(key)) continue
    seen.add(key)
    const id = typeof r.id === 'string' && r.id ? r.id : makeRelationId()
    out.push({ id, sourceId, targetId, type, createdAt: parseTime(r.createdAt) })
  }
  return out
}

export type AddRelationCheck = { ok: true; type: string } | { ok: false; reason: string }

/**
 * 校验是否可建立一条关系：类型非空、源 / 目标都已选择且为不同的已绑定标注、
 * 不与现有关系完全重复。通过时返回归一化后的类型。
 */
export function canAddRelation(
  relations: AnnotationRelation[],
  annotations: Annotation[],
  sourceId: string,
  targetId: string,
  rawType: string,
): AddRelationCheck {
  const type = normalizeRelationType(rawType)
  if (!sourceId || !targetId) return { ok: false, reason: '请选择源标注与目标标注' }
  if (sourceId === targetId) return { ok: false, reason: '不能自关联：源与目标是同一条标注' }
  if (!type) return { ok: false, reason: '请填写关系类型' }
  const byId = new Map(annotations.map((a) => [a.id, a]))
  const source = byId.get(sourceId)
  const target = byId.get(targetId)
  if (!source || !target) return { ok: false, reason: '源或目标标注已不存在' }
  if (source.status !== 'bound' || target.status !== 'bound') {
    return { ok: false, reason: '只能关联两条已绑定标注' }
  }
  const key = relationKey(sourceId, targetId, type)
  if (relations.some((r) => relationKey(r.sourceId, r.targetId, r.type) === key)) {
    return { ok: false, reason: '已存在相同源、目标与类型的关系' }
  }
  return { ok: true, type }
}

/** 附带当前有效性（派生状态）的关系视图 */
export interface RelationItem {
  relation: AnnotationRelation
  /** 源标注；已被删除时为 null */
  source: Annotation | null
  /** 目标标注；已被删除时为 null */
  target: Annotation | null
  /** 有效：两端标注都存在且均为已绑定 */
  valid: boolean
  /** 失效原因（有效时为 null） */
  invalidReason: string | null
}

function endInvalidReason(a: Annotation | null): 'deleted' | 'pending' | null {
  if (!a) return 'deleted'
  if (a.status !== 'bound') return 'pending'
  return null
}

const END_REASON_LABEL = { deleted: '已删除', pending: '待处理' } as const

/**
 * 由关系表与当前标注集派生关系视图（含有效 / 失效与原因）。
 * 结果按「类型字典序 → 创建时间 → ID」排序，保证筛选与展示顺序稳定。
 * 纯函数：不修改传入数据。
 */
export function listRelations(
  relations: AnnotationRelation[],
  annotations: Annotation[],
): RelationItem[] {
  const byId = new Map(annotations.map((a) => [a.id, a]))
  const items: RelationItem[] = relations.map((relation) => {
    const source = byId.get(relation.sourceId) ?? null
    const target = byId.get(relation.targetId) ?? null
    const s = endInvalidReason(source)
    const t = endInvalidReason(target)
    let invalidReason: string | null = null
    if (s && t) {
      invalidReason = s === t
        ? `源与目标标注均${END_REASON_LABEL[s]}`
        : `源标注${END_REASON_LABEL[s]}，目标标注${END_REASON_LABEL[t]}`
    } else if (s) {
      invalidReason = `源标注${END_REASON_LABEL[s]}`
    } else if (t) {
      invalidReason = `目标标注${END_REASON_LABEL[t]}`
    }
    return { relation, source, target, valid: invalidReason === null, invalidReason }
  })
  items.sort(
    (x, y) =>
      (x.relation.type < y.relation.type ? -1 : x.relation.type > y.relation.type ? 1 : 0) ||
      x.relation.createdAt - y.relation.createdAt ||
      x.relation.id.localeCompare(y.relation.id),
  )
  return items
}

/** 当前出现过的全部关系类型（字典序），供筛选与输入补全 */
export function relationTypes(relations: AnnotationRelation[]): string[] {
  const set = new Set(relations.map((r) => r.type))
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** 有效 / 失效汇总 */
export function summarizeRelations(items: RelationItem[]): {
  total: number
  valid: number
  invalid: number
} {
  let valid = 0
  for (const it of items) if (it.valid) valid++
  return { total: items.length, valid, invalid: items.length - valid }
}
