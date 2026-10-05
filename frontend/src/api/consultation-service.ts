import { readCollection, writeCollection } from '@/data/local-store'
import { buildSuggestion, RULE_THRESHOLDS } from '@/data/consultation/rules'
import { SEED_CONSULTATIONS, SEED_DRAWING_CHECKS } from '@/data/consultation/seed'
import type {
  AdvanceInput,
  AdvanceResult,
  Consultation,
  ConsultationAction,
  ConsultationStatus,
  ConsultationTrace,
  CreateConsultationInput,
  DrawingCheckItem,
} from '@/data/consultation/types'
import { STATUS_RANK } from '@/data/consultation/types'

/**
 * 层位会商台服务。全部业务约束都在这里，页面只渲染、不做业务判断。
 *
 * 裁决顺序（建议规则与人工结论冲突时，自上而下裁决）：
 *   1) 原始地层事实：rawSnapshot 只读，会商任何步骤都不改写、不回写 stratum；
 *   2) 硬性判定规则（R01~R05）：编号/层序/描述完整性/矛盾描述，命中即否决；
 *   3) 人工结论（记录人采纳/退回、校核人通过/需补录，均留痕、须写理由）；
 *   4) 系统自动建议：仅参考，永远不能自动落为最终划分。
 * 冲突解决：人工结论与硬性规则相反时不静默通过，一律裁决「需补录」，并留痕原因。
 */

const CONSULTATION_COLLECTION = 'consultations'
const DRAWING_COLLECTION = 'drawing-checks'
const REASON_MIN_LEN = 4

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

function loadConsultations(): Consultation[] {
  return readCollection<Consultation>(CONSULTATION_COLLECTION, SEED_CONSULTATIONS)
}

function persistConsultations(rows: Consultation[]): void {
  writeCollection(CONSULTATION_COLLECTION, rows)
}

function loadDrawingChecks(): DrawingCheckItem[] {
  return readCollection<DrawingCheckItem>(DRAWING_COLLECTION, SEED_DRAWING_CHECKS)
}

function persistDrawingChecks(rows: DrawingCheckItem[]): void {
  writeCollection(DRAWING_COLLECTION, rows)
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

function fail(message: string): AdvanceResult {
  return { ok: false, message }
}

function trace(
  partial: Omit<ConsultationTrace, 'at'>,
): ConsultationTrace {
  return { at: nowText(), ...partial }
}

/** 同一地层并发会商只能留下一个有效版本：active 为 true 的记录至多一条（创建与续办处均强制）。 */

export function listConsultations(filters: { stratumNo?: string; status?: string } = {}): Consultation[] {
  const rows = loadConsultations()
  const no = (filters.stratumNo ?? '').trim()
  const status = (filters.status ?? '').trim()
  return rows
    .filter((row) => (no ? row.stratumNo.includes(no) || row.trenchNo.includes(no) : true))
    .filter((row) => (status ? row.status === status || (status === '已归档' && row.archived) : true))
    .sort((a, b) => (a.id === b.id ? a.version - b.version : b.id - a.id))
}

export function getConsultation(id: number): Consultation | undefined {
  return loadConsultations().find((row) => row.id === id)
}

export function createConsultation(input: CreateConsultationInput): AdvanceResult {
  const stratumNo = input.stratumNo.trim()
  const trenchNo = input.trenchNo.trim()
  const levelNo = input.levelNo.trim()
  const soilTexture = input.soilTexture.trim()
  const operator = input.operator.trim() || '值班管理员'

  if (!stratumNo || !trenchNo || !levelNo || !soilTexture) {
    return fail('地层编号、所属探方、层位序号、土质描述均为必填，缺一不可发起会商')
  }

  const rows = loadConsultations()

  // 并发控制 + 版本谱系：同一地层只允许一个有效版本，也不允许另起炉灶。
  // - 已有进行中(active)版本：并发会商，拒绝；
  // - 已有归档定案版本：归档后回退/重开，拒绝；
  // - 仅有失效(被补录续办取代)版本：必须走「补录续办」保持版本谱系，拒绝新建。
  const sameStratum = rows.filter((row) => row.stratumNo === stratumNo.trim())
  const active = sameStratum.find((row) => row.active)
  const archived = sameStratum.find((row) => row.archived)
  if (active) {
    return fail(
      `同一地层并发会商只能保留一个有效版本：该地层已有进行中的会商（#${active.id} v${active.version}，${active.status}）`,
    )
  }
  if (archived) {
    return fail('该地层已有归档定案的会商，归档后禁止回退或重新发起')
  }
  if (sameStratum.length > 0) {
    const last = sameStratum[sameStratum.length - 1]
    return fail(`该地层存在未结的会商历史（#${last.id} v${last.version}），请在原会商上「补录续办」，不能另起新会商`)
  }

  const suggestion = buildSuggestion({
    stratumNo,
    levelNo,
    soilTexture,
    soilColor: input.soilColor.trim(),
    inclusions: input.inclusions.trim(),
  })

  const id = nextId(rows)
  const createdAt = nowText()
  const consultation: Consultation = {
    id,
    stratumNo,
    trenchNo,
    levelNo,
    soilTexture,
    soilColor: input.soilColor.trim(),
    inclusions: input.inclusions.trim(),
    // 原始地层的只读快照：会商全程只能引用它，不能改它，更不会回写到 stratum 模块。
    rawSnapshot: {
      地层编号: stratumNo,
      所属探方: trenchNo,
      层位序号: levelNo,
      土质描述: soilTexture,
      土色描述: input.soilColor.trim(),
      包含物特征: input.inclusions.trim(),
    },
    suggestion,
    status: '已划分',
    verdict: '待校核',
    recorderDecision: '—',
    recorderReason: '',
    recorder: operator,
    checker: '',
    checkReason: '',
    version: 1,
    revision: 1,
    active: true,
    archived: false,
    createdAt,
    createdBy: operator,
    archivedAt: '',
    traces: [
      trace({
        operator,
        action: '发起会商',
        from: '—',
        to: '已划分',
        reason: `录入地层 ${stratumNo}（${trenchNo} 第 ${levelNo} 层），系统按规则给出划分建议`,
        ruleCodes: suggestion.rules.filter((rule) => !rule.passed).map((rule) => rule.code),
      }),
    ],
  }
  persistConsultations([...rows, consultation])
  return { ok: true, message: `会商已发起，当前状态「已划分」。建议：${suggestion.category}`, consultation }
}

/** 当前状态允许的下一步动作（只允许 +1 或终态封印），跳级与归档后回退一律不给。 */
export function allowedActions(row: Consultation): ConsultationAction[] {
  if (row.archived) return []
  if (row.status === '需补录') return ['补录续办']
  if (row.status === '已校核') {
    return row.verdict === '通过' ? ['归档结论'] : ['退回补录']
  }
  if (row.status === '已划分') return ['采纳建议', '退回建议']
  if (row.status === '已记录') return ['提交校核']
  return []
}

function saveMutated(
  rows: Consultation[],
  target: Consultation,
  expectedRevision: number | undefined,
): { rows: Consultation[] } | AdvanceResult {
  const current = rows.find((row) => row.id === target.id)
  if (!current) return fail(`会商 #${target.id} 已不存在`)
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    return fail(
      `检测到并发修改：会商 #${target.id} 版本号已变化（当前 r${current.revision}，你持有的是 r${expectedRevision}），请刷新后重试`,
    )
  }
  target.revision = current.revision + 1
  const next = rows.map((row) => (row.id === target.id ? target : row))
  persistConsultations(next)
  return { rows: next }
}

/** 结论通过并归档时，幂等同步一条校核事项到实测绘图页（跨业务面）。 */
function syncDrawingCheck(row: Consultation): void {
  const checks = loadDrawingChecks()
  if (checks.some((item) => item.consultationId === row.id)) {
    return
  }
  const item: DrawingCheckItem = {
    id: nextId(checks),
    consultationId: row.id,
    stratumNo: row.stratumNo,
    trenchNo: row.trenchNo,
    levelNo: row.levelNo,
    sourceVersion: row.version,
    title: `依据 ${row.stratumNo}（v${row.version}）校核地层剖面图`,
    detail: `该层会商结论已通过归档（${row.suggestion.category}）。请核对实测图中层界、土质土色注记与包含物分布。`,
    required: '核对层位界线、土色土质标注、包含物图例，确认一致后在实测图上签核。',
    createdAt: nowText(),
    status: '待校核',
    checkedBy: '',
    checkedAt: '',
  }
  persistDrawingChecks([...checks, item])
}

export function advanceConsultation(id: number, action: ConsultationAction, input: AdvanceInput): AdvanceResult {
  const rows = loadConsultations()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return fail(`没有找到编号为 ${id} 的会商记录`)

  const reason = input.reason.trim()
  if (reason.length < REASON_MIN_LEN) {
    return fail(`必须写明${action === '采纳建议' ? '采纳' : action === '退回建议' ? '退回' : ''}理由（不少于 ${REASON_MIN_LEN} 字），不能让会商无依据推进`)
  }

  const current = rows[index]

  // 归档后任何回退/再推进都拒绝。
  if (current.archived) {
    return fail('该会商已归档定案，归档后禁止回退或再次流转')
  }

  const allowed = allowedActions(current)
  if (!allowed.includes(action)) {
    if (current.status === '需补录') {
      return fail('「需补录」是当前版本的终态，只能通过「补录续办」生成新版本，不能在旧版上回退或跳级')
    }
    return fail(`当前状态「${current.status}」不允许执行「${action}」（会商只能按 已划分→已记录→已校核→需补录 顺序推进，禁止跳级）`)
  }

  const operator = input.operator.trim() || current.checker || current.recorder
  const next: Consultation = {
    ...current,
    rawSnapshot: { ...current.rawSnapshot },
    suggestion: {
      ...current.suggestion,
      rules: current.suggestion.rules.map((rule) => ({ ...rule })),
    },
    traces: [...current.traces],
  }

  const hardCodes = next.suggestion.rules.filter((rule) => rule.severity === 'hard' && !rule.passed)
  const hardCodeList = hardCodes.map((rule) => rule.code)

  // —— 已划分 -> 已记录：记录人必须采纳或退回建议并写理由。两种动作都推进到已记录。 ——
  if (action === '采纳建议' || action === '退回建议') {
    if (next.status !== '已划分') return fail('只能在「已划分」阶段采纳或退回建议')
    const adopt = action === '采纳建议'

    // 裁决顺序：硬性规则 > 人工结论。建议本身已暂缓时，不允许“直接采纳为划分结论”。
    if (adopt && next.suggestion.hardViolated) {
      return fail(
        `硬性规则 ${hardCodeList.join('、')} 未通过，按裁决顺序（原始事实＞硬规则＞人工＞自动建议）不能采纳为划分结论，请改选「退回建议」并补录`,
      )
    }
    next.status = '已记录'
    next.recorderDecision = adopt ? '采纳' : '退回'
    next.recorderReason = reason
    next.recorder = operator
    next.traces.push(
      trace({
        operator,
        action,
        from: '已划分',
        to: '已记录',
        reason,
        ruleCodes: next.suggestion.rules.filter((rule) => !rule.passed).map((rule) => rule.code),
      }),
    )
    return commit(rows, next, input.expectedRevision)
  }

  // —— 已记录 -> 已校核：校核人给“通过/需补录”结论。硬规则未过，结论强制为需补录。 ——
  if (action === '提交校核') {
    if (next.status !== '已记录') return fail('只能在「已记录」阶段提交校核')
    let verdict = input.verdict
    if (!verdict) return fail('提交校核必须给出「通过」或「需补录」结论')
    if (next.suggestion.hardViolated && verdict === '通过') {
      // 冲突裁决：人工“通过”与硬规则相反，不静默通过，强制改判为需补录。
      verdict = '需补录'
    }
    next.status = '已校核'
    next.verdict = verdict
    next.checker = (input.checker ?? '').trim() || operator
    next.checkReason =
      verdict === '需补录' && next.suggestion.hardViolated
        ? `${reason}｜系统裁决：硬性规则 ${hardCodeList.join('、')} 未通过，人工“通过”被改判为需补录`
        : reason
    next.traces.push(
      trace({
        operator: next.checker,
        action: '提交校核',
        from: '已记录',
        to: '已校核',
        reason: next.checkReason,
        ruleCodes: hardCodeList,
      }),
    )
    return commit(rows, next, input.expectedRevision)
  }

  // —— 已校核(通过) -> 归档（终态封印）。归档同步实测绘图校核事项。 ——
  if (action === '归档结论') {
    if (next.status !== '已校核' || next.verdict !== '通过') {
      return fail('只有校核结论为「通过」的会商才能归档；结论为需补录者必须先退回补录')
    }
    if (next.suggestion.hardViolated) {
      return fail('硬性规则未通过的会商不得归档，按裁决顺序应退回补录')
    }
    next.archived = true
    next.active = false
    next.archivedAt = nowText()
    next.traces.push(
      trace({ operator, action: '归档结论', from: '已校核', to: '已归档', reason, ruleCodes: [] }),
    )
    const saved = commit(rows, next, input.expectedRevision)
    if ('ok' in saved && saved.ok === false) return saved
    // 归档成功后跨业务同步（幂等）。会商本身不改写原始地层。
    syncDrawingCheck(next)
    return { ok: true, message: '会商结论已通过并归档，已同步在实测绘图页新增校核事项；归档后不可回退', consultation: next }
  }

  // —— 已校核(需补录) -> 需补录（仍 +1，不是回退）。 ——
  if (action === '退回补录') {
    if (next.status !== '已校核' || next.verdict !== '需补录') {
      return fail('只有校核结论为「需补录」时才能退回补录；结论通过者应直接归档')
    }
    next.status = '需补录'
    next.traces.push(
      trace({ operator: next.checker || operator, action: '退回补录', from: '已校核', to: '需补录', reason, ruleCodes: hardCodeList }),
    )
    return commit(rows, next, input.expectedRevision)
  }

  // —— 需补录 -> 补录续办：旧版本置失效，生成 v(n+1)，从「已划分」重新走流程。 ——
  if (action === '补录续办') {
    if (next.status !== '需补录') return fail('只有处于「需补录」的版本才能补录续办')
    // 旧版封印为失效（保留历史），绝不修改旧版内容。
    next.active = false
    next.traces.push(
      trace({ operator, action: '补录续办', from: '需补录', to: '—', reason, ruleCodes: hardCodeList }),
    )
    const newVersionNo = next.version + 1
    // 补录人可修正描述字段；地层身份（编号/探方/层位序号）不变，rawSnapshot 原始事实原样保留。
    const revisedSoilTexture = input.supplements?.soilTexture?.trim() || next.soilTexture
    const revisedSoilColor = input.supplements?.soilColor?.trim() || next.soilColor
    const revisedInclusions = input.supplements?.inclusions?.trim() || next.inclusions
    if (revisedSoilTexture.trim().length < RULE_THRESHOLDS.SOIL_TEXT_MIN_LEN) {
      return fail(`补录后的土质描述仍少于 ${RULE_THRESHOLDS.SOIL_TEXT_MIN_LEN} 字，未达到成句阈值，不能续办`)
    }
    const reSuggest = buildSuggestion({
      stratumNo: next.stratumNo,
      levelNo: next.levelNo,
      soilTexture: revisedSoilTexture,
      soilColor: revisedSoilColor,
      inclusions: revisedInclusions,
    })
    const renewed: Consultation = {
      ...next,
      id: nextId(rows),
      soilTexture: revisedSoilTexture,
      soilColor: revisedSoilColor,
      inclusions: revisedInclusions,
      suggestion: reSuggest,
      status: '已划分',
      verdict: '待校核',
      recorderDecision: '—',
      recorderReason: '',
      checker: '',
      checkReason: '',
      version: newVersionNo,
      revision: 1,
      active: true,
      archived: false,
      archivedAt: '',
      createdAt: nowText(),
      createdBy: operator,
      traces: [
        trace({
          operator,
          action: '补录新版本',
          from: '需补录',
          to: '已划分',
          reason: `承接 #${next.id} v${next.version} 补录续办，生成 v${newVersionNo}；新版本采用补录后的描述，原始地层快照只读不改、不覆盖 stratum`,
          ruleCodes: reSuggest.rules.filter((rule) => !rule.passed).map((rule) => rule.code),
        }),
      ],
    }
    const expected = input.expectedRevision
    if (expected !== undefined && current.revision !== expected) {
      return fail(`检测到并发修改：会商 #${current.id} 版本号已变化，请刷新后重试`)
    }
    const superseded = { ...next, revision: current.revision + 1 }
    const nextRows = rows.map((row) => (row.id === current.id ? superseded : row))
    persistConsultations([...nextRows, renewed])
    return {
      ok: true,
      message: `已生成新版本 v${newVersionNo}（#${renewed.id}），从「已划分」重新会商；旧版本失效留痕`,
      consultation: renewed,
      newId: renewed.id,
    }
  }

  return fail(`未识别的会商动作「${action}」`)
}

function commit(
  rows: Consultation[],
  next: Consultation,
  expectedRevision: number | undefined,
): AdvanceResult {
  const result = saveMutated(rows, next, expectedRevision)
  if ('ok' in result) return result
  return { ok: true, message: `会商已推进至「${next.status}」`, consultation: next }
}

// —— 实测绘图页的校核事项（跨业务面）——
export function listDrawingChecks(): DrawingCheckItem[] {
  return loadDrawingChecks().sort((a, b) => Number(b.id) - Number(a.id))
}

export function checkDrawingItem(id: number, operator: string): AdvanceResult {
  const checks = loadDrawingChecks()
  const index = checks.findIndex((item) => item.id === id)
  if (index < 0) return fail(`没有找到编号为 ${id} 的校核事项`)
  const item = checks[index]
  if (item.status === '已校核') return fail('该校核事项已签核，无需重复操作')
  const updated: DrawingCheckItem = {
    ...item,
    status: '已校核',
    checkedBy: operator.trim() || '值班管理员',
    checkedAt: nowText(),
  }
  persistDrawingChecks(checks.map((row) => (row.id === id ? updated : row)))
  return { ok: true, message: `校核事项 #${id} 已签核完成` }
}

export function resetConsultations(): void {
  writeCollection(CONSULTATION_COLLECTION, SEED_CONSULTATIONS)
  writeCollection(DRAWING_COLLECTION, SEED_DRAWING_CHECKS)
}

// 供页面展示状态推进次序与裁决优先级，避免页面各自硬编码。
export const STATUS_ORDER: ConsultationStatus[] = ['已划分', '已记录', '已校核', '需补录']
export { STATUS_RANK }
