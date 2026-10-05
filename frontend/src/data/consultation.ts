import { STRATUM_NEXT_STATUS } from './stratum-flow'
import type { EntryRow } from './types'

// —— 判定规则、阈值与标准：会商台划分建议的唯一依据，调整只在这里改 ——

export const MIN_SOIL_DESC_LEN = 10 // S1 土质描述充分性阈值（字符）
export const MIN_REASON_LEN = 10 // 人工结论理由充分性阈值（字符），退回建议时适用

// 土质关键词库：只产生建议性（软规则）信号，不构成硬性拦截
const DISTURB_KEYWORDS = ['扰', '现代', '回填', '混杂'] // R1 疑似扰动堆积
const ACTIVITY_KEYWORDS = ['灰', '烧土', '炭', '红烧'] // R2 人类活动堆积
const CLEAN_KEYWORDS = ['生土', '纯净', '致密'] // R3 堆积单纯、疑似生土

// 裁决顺序：建议规则与人工结论冲突时按此裁定（会商台页面上同步公示）。
// ① 硬性标准优先：S1-S4 任一不通过，禁止采纳，直接以规则裁决为准；
// ② 人工结论优先：与软规则建议冲突时，记录人理由充分（≥10字）的，以人工结论为准；
// ③ 系统建议兜底：人工理由不充分时，以系统建议为准，结论不予生效。
export const ARBITRATION_ORDER = [
  '① 硬性标准优先：描述充分性、层位序号合法性、登记一致性、层位唯一性任一不通过时，禁止采纳，直接以规则裁决为准；',
  '② 人工结论优先：人工结论与软规则建议冲突时，记录人理由充分（不少于 10 字）的，以人工结论为准；',
  '③ 系统建议兜底：人工理由不充分时，以系统建议为准，结论不予生效，需补充理由后重新提交。',
]

export type SuggestionInput = {
  地层编号: string
  所属探方: string
  层位序号: string
  土质描述: string
}

export type DivisionSuggestion = {
  isNew: boolean // 地层编号是否尚未登记
  currentStatus: string // 当前状态；未登记时为「未登记」
  verdict: '登记新层' | '推进' | '退回补录' | '维持'
  targetStatus: string // 建议目标状态；维持时等于当前状态
  reasons: string[] // 命中的规则、阈值与标准说明
  hardFailures: string[] // 硬性标准未通过项：非空时按裁决顺序①禁止采纳
}

function hitKeywords(text: string, keywords: string[]): string[] {
  return keywords.filter((word) => text.includes(word))
}

// 划分建议引擎：只产出建议与依据，不改任何数据；是否生效由人工结论与裁决顺序决定。
export function suggestDivision(input: SuggestionInput, stratumRows: EntryRow[]): DivisionSuggestion {
  const reasons: string[] = []
  const hardFailures: string[] = []
  const desc = input.土质描述.trim()
  const seq = input.层位序号.trim()
  const trench = input.所属探方.trim()
  const existing = stratumRows.find((row) => String(row.地层编号) === input.地层编号.trim())

  // S1 描述充分性
  if (desc.length >= MIN_SOIL_DESC_LEN) {
    reasons.push(`S1 描述充分性：土质描述 ${desc.length} 字 ≥ 阈值 ${MIN_SOIL_DESC_LEN} 字，通过`)
  } else {
    hardFailures.push(`S1 描述充分性：土质描述 ${desc.length} 字 < 阈值 ${MIN_SOIL_DESC_LEN} 字，不通过`)
  }
  // S2 层位序号合法性
  if (/^[1-9]\d*$/.test(seq)) {
    reasons.push(`S2 层位序号：「${seq}」为正整数，通过`)
  } else {
    hardFailures.push(`S2 层位序号：「${seq || '空'}」不是正整数，不通过`)
  }
  // S3 登记一致性（已登记地层）/ S4 层位唯一性（新层）
  if (existing) {
    const consistent = String(existing.所属探方) === trench && String(existing.层位序号) === seq
    if (consistent) {
      reasons.push('S3 登记一致性：录入信息与地层登记一致，通过')
    } else {
      hardFailures.push(
        `S3 登记一致性：登记信息为「${existing.所属探方} / 层位${existing.层位序号}」，与录入不符，不通过`,
      )
    }
  } else {
    const duplicated = stratumRows.some(
      (row) => String(row.所属探方) === trench && String(row.层位序号) === seq,
    )
    if (duplicated) {
      hardFailures.push(`S4 层位唯一性：探方「${trench}」的层位序号「${seq}」已被占用，不通过`)
    } else {
      reasons.push('S4 层位唯一性：同探方无重复层位序号，通过')
    }
  }

  const disturbed = hitKeywords(desc, DISTURB_KEYWORDS)
  const activity = hitKeywords(desc, ACTIVITY_KEYWORDS)
  const clean = hitKeywords(desc, CLEAN_KEYWORDS)

  // 新层划分：地层编号尚未登记时，建议登记为新地层或暂缓
  if (!existing) {
    if (disturbed.length > 0) {
      reasons.push(`R1 扰动信号：土质描述含「${disturbed.join('、')}」，疑似扰动堆积`)
      reasons.push('R5 新层划分：建议暂缓登记，核实扰动情况后再录')
      return { isNew: true, currentStatus: '未登记', verdict: '维持', targetStatus: '未登记', reasons, hardFailures }
    }
    if (activity.length > 0) {
      reasons.push(`R2 活动堆积信号：土质描述含「${activity.join('、')}」，登记后建议优先完成记录`)
    } else if (clean.length > 0) {
      reasons.push(`R3 堆积单纯信号：土质描述含「${clean.join('、')}」，疑似生土，校核时需确认是否到底`)
    }
    reasons.push('R5 新层划分：地层编号未登记，建议登记为新地层（已划分）')
    return { isNew: true, currentStatus: '未登记', verdict: '登记新层', targetStatus: '已划分', reasons, hardFailures }
  }

  const current = String(existing.status)
  const archived = existing.已归档 === true
  const next = STRATUM_NEXT_STATUS[current] ?? current

  // 扰动信号：已校核且未封存的建议退回补录，其余状态建议维持并补充说明
  if (disturbed.length > 0) {
    reasons.push(`R1 扰动信号：土质描述含「${disturbed.join('、')}」，疑似扰动堆积`)
    if (current === '已校核' && !archived) {
      reasons.push('建议退回补录：核实扰动范围后重新记录')
      return { isNew: false, currentStatus: current, verdict: '退回补录', targetStatus: '需补录', reasons, hardFailures }
    }
    reasons.push(`建议维持「${current}」，补充扰动说明后再按顺序推进`)
    return { isNew: false, currentStatus: current, verdict: '维持', targetStatus: current, reasons, hardFailures }
  }

  // 已校核：无异常信号时建议维持；已归档封存的明确禁止回退
  if (current === '已校核') {
    reasons.push(
      archived
        ? 'R4 封存检查：已校核结论已归档封存，禁止回退，建议维持现状'
        : 'R4 校核检查：已校核且无异常信号，建议维持现状；如需退回补录请由人工结论说明',
    )
    return { isNew: false, currentStatus: current, verdict: '维持', targetStatus: current, reasons, hardFailures }
  }

  // 常规推进：已划分 → 已记录，需补录 → 已记录，已记录 → 已校核
  if (activity.length > 0) {
    reasons.push(`R2 活动堆积信号：土质描述含「${activity.join('、')}」，建议优先推进至「${next}」`)
  } else if (clean.length > 0) {
    reasons.push(`R3 堆积单纯信号：土质描述含「${clean.join('、')}」，疑似生土，建议推进至「${next}」并在校核时确认是否到底`)
  } else {
    reasons.push(`R0 常规信号：无特殊土质信号，建议按顺序推进至「${next}」`)
  }
  return { isNew: false, currentStatus: current, verdict: '推进', targetStatus: next, reasons, hardFailures }
}
