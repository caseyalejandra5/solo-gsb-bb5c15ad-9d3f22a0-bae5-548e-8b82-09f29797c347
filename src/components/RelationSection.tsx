import { useEffect, useMemo, useState } from 'react'
import type { Annotation, AnnotationRelation } from '../types'
import { badgeColor } from '../lib/segments'
import {
  canAddRelation,
  listRelations,
  relationTypes,
  summarizeRelations,
  type RelationItem,
} from '../lib/relations'

interface Props {
  annotations: Annotation[]
  relations: AnnotationRelation[]
  activeId: string | null
  /** 建立关系；返回错误原因（成功为 null）。调用方在落地前会以最新状态再校验一次 */
  onAdd: (sourceId: string, targetId: string, type: string) => string | null
  onDelete: (id: string) => void
  onFocus: (a: Annotation) => void
}

/** 下拉选项文案：位置 + 引文截断 */
function optionLabel(a: Annotation): string {
  const quote = a.quote || '（空引文）'
  const cut = quote.length > 24 ? `${quote.slice(0, 24)}…` : quote
  return `[${a.start}, ${a.end}) ${cut}`
}

/** 关系的一端：已绑定标注渲染为可定位按钮；待处理 / 已删除渲染为占位说明 */
function RelationEnd({
  a,
  active,
  onFocus,
}: {
  a: Annotation | null
  active: boolean
  onFocus: (a: Annotation) => void
}) {
  if (!a) return <span className="rel-end rel-end-missing">（标注已删除）</span>
  if (a.status !== 'bound') {
    return (
      <span className="rel-end rel-end-pending" title={a.quote}>
        「{a.quote || '（空引文）'}」（待处理）
      </span>
    )
  }
  return (
    <button
      type="button"
      className={`rel-end rel-end-btn ${active ? 'rel-end-active' : ''}`}
      title="在原文中定位"
      onClick={() => onFocus(a)}
    >
      <span className="ann-badge" style={{ backgroundColor: badgeColor(a.id) }} />
      <span className="rel-end-quote">{a.quote || '（空引文）'}</span>
    </button>
  )
}

function RelationCard({
  item,
  activeId,
  onFocus,
  onDelete,
}: {
  item: RelationItem
  activeId: string | null
  onFocus: (a: Annotation) => void
  onDelete: (id: string) => void
}) {
  const { relation } = item
  return (
    <div className={`rel-item ${item.valid ? '' : 'rel-item-invalid'}`}>
      <div className="rel-head">
        <span className="rel-type">{relation.type}</span>
        {item.valid ? (
          <span className="rel-flag rel-flag-ok">有效</span>
        ) : (
          <span className="rel-flag rel-flag-bad">失效</span>
        )}
        <span className="form-spacer" />
        <button
          className="btn btn-small btn-ghost btn-danger-text"
          onClick={() => {
            if (confirm('确定删除这条关系吗？（不影响两端标注）')) onDelete(relation.id)
          }}
        >
          删除
        </button>
      </div>
      <div className="rel-ends">
        <RelationEnd a={item.source} active={activeId === relation.sourceId} onFocus={onFocus} />
        <span className="rel-arrow">→</span>
        <RelationEnd a={item.target} active={activeId === relation.targetId} onFocus={onFocus} />
      </div>
      {item.invalidReason && (
        <p className="rel-reason">
          {item.invalidReason}
          {item.invalidReason.includes('待处理') && '，重新绑定后自动恢复'}
        </p>
      )}
    </div>
  )
}

/** 标注关系侧栏分区：建立有向关系 + 按类型筛选的关系列表 */
export function RelationSection(props: Props) {
  const { annotations, relations } = props

  // 可选端点：仅已绑定标注，按原文位置排序
  const bound = useMemo(
    () =>
      annotations
        .filter((a) => a.status === 'bound')
        .sort((x, y) => x.start - y.start || x.end - y.end || x.id.localeCompare(y.id)),
    [annotations],
  )
  const items = useMemo(() => listRelations(relations, annotations), [relations, annotations])
  const types = useMemo(() => relationTypes(relations), [relations])
  const summary = summarizeRelations(items)
  const countByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of relations) m.set(r.type, (m.get(r.type) ?? 0) + 1)
    return m
  }, [relations])

  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [type, setType] = useState('')
  /** 类型筛选：'' 表示全部 */
  const [filter, setFilter] = useState('')

  // 选中的端点不再可选（被删 / 进入待处理）时重置选择；筛选的类型消失时回到全部
  useEffect(() => {
    if (sourceId && !bound.some((a) => a.id === sourceId)) setSourceId('')
    if (targetId && !bound.some((a) => a.id === targetId)) setTargetId('')
  }, [bound, sourceId, targetId])
  useEffect(() => {
    if (filter && !types.includes(filter)) setFilter('')
  }, [types, filter])

  const filled = !!(sourceId && targetId && type.trim())
  const check = canAddRelation(relations, annotations, sourceId, targetId, type)

  const submit = () => {
    if (!check.ok) return
    props.onAdd(sourceId, targetId, type)
  }

  const shown = filter ? items.filter((it) => it.relation.type === filter) : items

  return (
    <section className="side-section">
      <h2 className={`side-heading ${summary.invalid > 0 ? 'side-heading-relation' : ''}`}>
        标注关系
        {summary.invalid > 0 && (
          <span className="conflict-count-badge relation-count-badge">{summary.invalid}</span>
        )}
      </h2>
      <p className="side-hint">
        在两条<strong>已绑定</strong>标注之间建立<strong>有向关系</strong>（源 → 目标 + 关系类型）；
        不能自关联，同一对标注同一类型只能建立一次（反向或不同类型不算重复）。
        端点标注被删除或进入待处理时关系自动<strong>失效</strong>，重新绑定后自动恢复。
      </p>

      {bound.length < 2 ? (
        <p className="side-hint">至少需要两条已绑定标注才能建立关系。</p>
      ) : (
        <div className="rel-form">
          <label className="form-label" htmlFor="rel-source">
            源标注
          </label>
          <select
            id="rel-source"
            className="rule-input rel-select"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">选择源标注…</option>
            {bound.map((a) => (
              <option key={a.id} value={a.id}>
                {optionLabel(a)}
              </option>
            ))}
          </select>

          <label className="form-label" htmlFor="rel-target">
            目标标注
          </label>
          <select
            id="rel-target"
            className="rule-input rel-select"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">选择目标标注…</option>
            {bound.map((a) => (
              <option key={a.id} value={a.id}>
                {optionLabel(a)}
              </option>
            ))}
          </select>

          <label className="form-label" htmlFor="rel-type">
            关系类型
          </label>
          <input
            id="rel-type"
            className="rule-input"
            list="rel-type-suggestions"
            value={type}
            placeholder="如：因果、并列、引用…"
            onChange={(e) => setType(e.target.value)}
          />
          <datalist id="rel-type-suggestions">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          {filled && !check.ok && <p className="rel-error">{check.reason}</p>}
          <div className="rel-form-actions">
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={!check.ok}
              onClick={submit}
            >
              建立关系
            </button>
          </div>
        </div>
      )}

      {relations.length > 0 && (
        <>
          <div className="rel-summary">
            共 <strong>{summary.total}</strong> 条 · 有效 <strong>{summary.valid}</strong> · 失效{' '}
            <strong className={summary.invalid > 0 ? 'rel-summary-bad' : ''}>
              {summary.invalid}
            </strong>
          </div>

          <div className="rel-filter-row">
            <label className="form-label" htmlFor="rel-filter">
              按类型筛选
            </label>
            <select
              id="rel-filter"
              className="rule-input rel-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">全部类型（{relations.length}）</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}（{countByType.get(t) ?? 0}）
                </option>
              ))}
            </select>
          </div>

          {shown.length === 0 ? (
            <p className="side-hint">该类型下没有关系。</p>
          ) : (
            shown.map((item) => (
              <RelationCard
                key={item.relation.id}
                item={item}
                activeId={props.activeId}
                onFocus={props.onFocus}
                onDelete={props.onDelete}
              />
            ))
          )}
        </>
      )}
      {relations.length === 0 && bound.length >= 2 && (
        <p className="side-hint">还没有关系。在上方选择源、目标并填写类型即可建立。</p>
      )}
    </section>
  )
}
