// 地层状态推进顺序：已划分 → 已记录 → 已校核 → 需补录 →（补录后重新提交）已记录。
// 会商台与地层记录页共用这一套顺序守卫：跳级操作与归档后回退都在这里被拒绝。

export const STRATUM_FLOW_ORDER = ['已划分', '已记录', '已校核', '需补录'] as const

// 每个状态唯一允许的下一状态：需补录之后重新提交记录，回到「已记录」。
export const STRATUM_NEXT_STATUS: Record<string, string> = {
  已划分: '已记录',
  已记录: '已校核',
  已校核: '需补录',
  需补录: '已记录',
}

export type StepCheck = { ok: boolean; message: string }

// 校验一次状态推进：只允许走到顺序中的下一状态；已归档封存的地层禁止回退补录。
export function checkStratumStep(current: string, target: string, archived: boolean): StepCheck {
  const expected = STRATUM_NEXT_STATUS[current]
  if (!expected) {
    return { ok: false, message: `地层状态「${current}」不在推进顺序内，拒绝操作` }
  }
  if (target !== expected) {
    return {
      ok: false,
      message: `跳级操作被拒绝：地层须按「${STRATUM_FLOW_ORDER.join('→')}」顺序推进，「${current}」的下一状态只能是「${expected}」，不能直接到「${target}」`,
    }
  }
  if (target === '需补录' && archived) {
    return { ok: false, message: '归档后回退被拒绝：该地层的已校核结论已归档封存，禁止退回补录' }
  }
  return { ok: true, message: '' }
}
