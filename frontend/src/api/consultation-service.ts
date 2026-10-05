import {
  MIN_REASON_LEN,
  suggestDivision,
  type DivisionSuggestion,
  type SuggestionInput,
} from '../data/consultation'
import { checkStratumStep } from '../data/stratum-flow'
import { listRows, saveRows } from '../data/local-store'
import type { ActionResult, EntryRow } from '../data/types'

// 层位会商台的数据服务：会商单生命周期、并发版本控制、结论应用与跨模块同步。
// 原则：会商只产出结论并按顺序推进地层状态，绝不直接覆盖原始地层描述字段。

const TICKET_KEY = 'consultation'

export type ConclusionDecision = '采纳' | '退回'

export type CreateResult = ActionResult & { ticket?: EntryRow }

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function listTickets(): EntryRow[] {
  return listRows(TICKET_KEY)
}

// 生成划分建议（不落库）：录入四项信息后即可预览。
export function previewSuggestion(input: SuggestionInput): DivisionSuggestion {
  return suggestDivision(input, listRows('stratum'))
}

// 提交会商单：建议随单留存，同一地层允许并发多张待结论会商，但结论时只留一个有效版本。
export function createTicket(input: SuggestionInput, recorder: string): CreateResult {
  const cleaned: SuggestionInput = {
    地层编号: input.地层编号.trim(),
    所属探方: input.所属探方.trim(),
    层位序号: input.层位序号.trim(),
    土质描述: input.土质描述.trim(),
  }
  if (!cleaned.地层编号 || !cleaned.所属探方 || !cleaned.层位序号 || !cleaned.土质描述) {
    return { ok: false, message: '地层编号、所属探方、层位序号、土质描述四项都必须录入' }
  }
  const suggestion = previewSuggestion(cleaned)
  const tickets = listRows(TICKET_KEY)
  const id = nextId(tickets)
  const stratum = listRows('stratum').find((row) => String(row.地层编号) === cleaned.地层编号)
  const ticket: EntryRow = {
    id,
    status: '待结论',
    pending: true,
    abnormal: false,
    会商编号: `HS-${String(id).padStart(4, '0')}`,
    ...cleaned,
    当前状态: suggestion.currentStatus,
    建议结论: suggestion.verdict,
    建议目标: suggestion.targetStatus,
    建议依据: suggestion.reasons.join('；'),
    硬性未通过: suggestion.hardFailures.join('；'),
    人工结论: '',
    结论理由: '',
    裁决结果: '',
    基准版本: stratum ? Number(stratum.version ?? 0) : -1,
    记录人: recorder.trim() || '未署名',
    创建时间: now(),
    结论时间: '',
  }
  saveRows(TICKET_KEY, [...tickets, ticket])
  return {
    ok: true,
    message: `会商单 ${ticket.会商编号} 已提交，建议「${suggestion.verdict}」（目标「${suggestion.targetStatus}」），等待人工结论`,
    ticket,
  }
}

// 并发失效：把会商单标成已失效并落库，返回失败结果。
function failTicket(tickets: EntryRow[], id: number, why: string): ActionResult {
  const next = tickets.map((row) =>
    Number(row.id) === id
      ? { ...row, status: '已失效', pending: false, abnormal: true, 裁决结果: why, 结论时间: now() }
      : row,
  )
  saveRows(TICKET_KEY, next)
  return { ok: false, message: `并发校验未通过：${why}` }
}

// 提交人工结论（采纳 / 退回）。裁决顺序：硬性标准 > 理由充分的人工结论 > 系统建议。
export function concludeTicket(id: number, decision: ConclusionDecision, reason: string): ActionResult {
  const tickets = listRows(TICKET_KEY)
  const ticket = tickets.find((row) => Number(row.id) === id)
  if (!ticket) {
    return { ok: false, message: `没有找到编号为 ${id} 的会商单` }
  }
  if (ticket.status !== '待结论') {
    return { ok: false, message: `会商单当前状态「${ticket.status}」，只有待结论的会商能提交结论` }
  }
  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    return { ok: false, message: '请先写明采纳或退回理由，没有理由的结论不予生效' }
  }
  const hardFailures = String(ticket.硬性未通过 ?? '')
    .split('；')
    .filter(Boolean)

  // 裁决顺序①：硬性标准优先，未通过时禁止采纳
  if (decision === '采纳' && hardFailures.length > 0) {
    return {
      ok: false,
      message: `硬性标准未通过，按裁决顺序①以规则为准，禁止采纳：${hardFailures.join('；')}`,
    }
  }
  // 裁决顺序③：退回理由不充分时，以系统建议为准
  if (decision === '退回' && trimmedReason.length < MIN_REASON_LEN) {
    return {
      ok: false,
      message: `退回理由 ${trimmedReason.length} 字不足 ${MIN_REASON_LEN} 字，按裁决顺序③以系统建议为准，结论不予生效，请补充理由`,
    }
  }

  const strata = listRows('stratum')
  const sIndex = strata.findIndex((row) => String(row.地层编号) === String(ticket.地层编号))
  const verdict = String(ticket.建议结论)
  const target = String(ticket.建议目标)

  let nextStrata: EntryRow[] | null = null
  let arbitration = ''
  let appliedNote = ''

  if (decision === '采纳') {
    // 并发守卫：同一地层只能留下一个有效版本，基准版本对不上即失效
    const baseVersion = Number(ticket.基准版本)
    if (baseVersion === -1) {
      if (sIndex >= 0) {
        return failTicket(tickets, id, `地层 ${ticket.地层编号} 已由其他会商或登记入口建立，本并发版本失效`)
      }
    } else {
      if (sIndex < 0) {
        return failTicket(tickets, id, `地层 ${ticket.地层编号} 的记录已不存在，本并发版本失效`)
      }
      const currentVersion = Number(strata[sIndex].version ?? 0)
      if (currentVersion !== baseVersion) {
        return failTicket(
          tickets,
          id,
          `地层 ${ticket.地层编号} 已推进到版本 ${currentVersion}（本会商基于版本 ${baseVersion}），本并发版本失效`,
        )
      }
    }

    if (verdict === '登记新层') {
      const newRow: EntryRow = {
        id: nextId(strata),
        status: '已划分',
        pending: true,
        abnormal: false,
        version: 0,
        地层编号: ticket.地层编号,
        所属探方: ticket.所属探方,
        层位序号: ticket.层位序号,
        土质描述: ticket.土质描述,
        土色描述: '',
        包含物特征: '',
        记录人: ticket.记录人,
        记录状态: '会商登记',
      }
      nextStrata = [...strata, newRow]
      appliedNote = `已按会商结论登记新地层 ${ticket.地层编号}（已划分）`
    } else if (verdict === '推进' || verdict === '退回补录') {
      const row = strata[sIndex]
      const step = checkStratumStep(String(row.status), target, row.已归档 === true)
      if (!step.ok) {
        return { ok: false, message: step.message }
      }
      const updated: EntryRow = {
        ...row,
        status: target,
        version: Number(row.version ?? 0) + 1,
        pending: target !== '已校核',
      }
      nextStrata = strata.map((item, index) => (index === sIndex ? updated : item))
      appliedNote = `地层 ${ticket.地层编号} 已按顺序推进：${row.status} → ${target}（版本 ${updated.version}），原始描述字段未被改动`
    } else {
      appliedNote = '建议为维持现状，地层记录保持不变'
    }
    arbitration = '人工采纳建议，与规则结论方向一致，按裁决顺序②准予生效'
  } else {
    arbitration = `人工退回建议，理由充分（${trimmedReason.length} 字 ≥ ${MIN_REASON_LEN} 字），按裁决顺序②以人工结论为准，地层记录保持不变`
    appliedNote = '退回建议，地层记录不变'
  }

  if (nextStrata) {
    saveRows('stratum', nextStrata)
  }

  const concludedStatus = decision === '采纳' ? '已通过' : '已退回'
  // 同一地层其余待结论会商全部失效：并发会商只留一个有效版本
  const nextTickets = tickets.map((row) => {
    if (Number(row.id) === id) {
      return {
        ...row,
        status: concludedStatus,
        pending: false,
        人工结论: decision,
        结论理由: trimmedReason,
        裁决结果: arbitration,
        结论时间: now(),
      }
    }
    if (row.status === '待结论' && String(row.地层编号) === String(ticket.地层编号)) {
      return {
        ...row,
        status: '已失效',
        pending: false,
        abnormal: true,
        裁决结果: `同一地层的会商已由 ${ticket.会商编号} 先行结论，本并发版本失效`,
        结论时间: now(),
      }
    }
    return row
  })
  saveRows(TICKET_KEY, nextTickets)

  // 结论通过后，跨业务面同步：实测绘图增加校核事项
  if (decision === '采纳') {
    syncDrawingVerification(ticket)
  }
  return { ok: true, message: `会商单 ${ticket.会商编号} 结论已生效（${decision}）。${appliedNote}` }
}

// 归档会商单：已通过/已退回才能归档；归档「已校核」结论时同步封存地层，禁止回退补录。
export function archiveTicket(id: number): ActionResult {
  const tickets = listRows(TICKET_KEY)
  const ticket = tickets.find((row) => Number(row.id) === id)
  if (!ticket) {
    return { ok: false, message: `没有找到编号为 ${id} 的会商单` }
  }
  if (ticket.status === '已归档') {
    return { ok: false, message: `会商单 ${ticket.会商编号} 已归档，请勿重复归档` }
  }
  if (ticket.status !== '已通过' && ticket.status !== '已退回') {
    return { ok: false, message: `会商单当前状态「${ticket.status}」，只有已通过或已退回的会商能归档` }
  }
  let sealed = false
  if (ticket.status === '已通过' && String(ticket.人工结论) === '采纳' && String(ticket.建议目标) === '已校核') {
    const strata = listRows('stratum')
    const sIndex = strata.findIndex((row) => String(row.地层编号) === String(ticket.地层编号))
    if (sIndex >= 0 && String(strata[sIndex].status) === '已校核') {
      saveRows(
        'stratum',
        strata.map((row, index) => (index === sIndex ? { ...row, 已归档: true } : row)),
      )
      sealed = true
    }
  }
  saveRows(
    TICKET_KEY,
    tickets.map((row) => (Number(row.id) === id ? { ...row, status: '已归档', pending: false } : row)),
  )
  return {
    ok: true,
    message: `会商单 ${ticket.会商编号} 已归档${sealed ? '，对应地层的已校核结论同步封存，禁止回退补录' : ''}`,
  }
}

// 回退会商：仅已退回的会商可退回待结论；已归档的一律拒绝。
export function reopenTicket(id: number): ActionResult {
  const tickets = listRows(TICKET_KEY)
  const ticket = tickets.find((row) => Number(row.id) === id)
  if (!ticket) {
    return { ok: false, message: `没有找到编号为 ${id} 的会商单` }
  }
  if (ticket.status === '已归档') {
    return { ok: false, message: '归档后回退被拒绝：会商单已归档，结论封存，禁止回退' }
  }
  if (ticket.status === '已通过') {
    return { ok: false, message: '结论已生效并应用到地层，不能回退；如需调整请重新发起会商' }
  }
  if (ticket.status === '已失效') {
    return { ok: false, message: '已失效的并发版本不能回退' }
  }
  if (ticket.status === '待结论') {
    return { ok: false, message: '会商单尚未结论，无需回退' }
  }
  saveRows(
    TICKET_KEY,
    tickets.map((row) =>
      Number(row.id) === id
        ? { ...row, status: '待结论', pending: true, 人工结论: '', 结论理由: '', 裁决结果: '', 结论时间: '' }
        : row,
    ),
  )
  return { ok: true, message: `会商单 ${ticket.会商编号} 已回退为待结论，可重新提交结论` }
}

// 结论通过后，在实测绘图模块同步登记一条校核事项（按来源会商编号幂等，不重复登记）。
function syncDrawingVerification(ticket: EntryRow): void {
  const drawings = listRows('drawing')
  if (drawings.some((row) => String(row.来源会商 ?? '') === String(ticket.会商编号))) {
    return
  }
  const id = nextId(drawings)
  const item: EntryRow = {
    id,
    status: '待校核',
    pending: true,
    abnormal: false,
    图纸编号: `DRAW-${String(id).padStart(4, '0')}`,
    绘图对象: `地层${ticket.地层编号}（${ticket.所属探方}·层位${ticket.层位序号}）`,
    绘图类型: '层位校核图',
    比例尺: '1:20',
    绘图人: ticket.记录人,
    校核人: '待指派',
    完成日期: now().slice(0, 10),
    图纸状态: '会商校核事项',
    来源会商: ticket.会商编号,
  }
  saveRows('drawing', [...drawings, item])
}
