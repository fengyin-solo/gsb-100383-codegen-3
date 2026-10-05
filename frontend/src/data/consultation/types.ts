/** 层位会商台的领域类型。会商只持有原始地层的只读快照，绝不回写、覆盖 stratum 原始记录。 */

/** 会商推进顺序（rank 即推进次序，只能 +1，禁止跳级）。归档是终态封印，不占顺序位。 */
export type ConsultationStatus = '已划分' | '已记录' | '已校核' | '需补录'

export const STATUS_RANK: Record<ConsultationStatus, number> = {
  已划分: 0,
  已记录: 1,
  已校核: 2,
  需补录: 3,
}

/** 会商动作。目标状态由状态机按 +1 规则推导，不在这里写“可跳到任意状态”的映射。 */
export type ConsultationAction =
  | '采纳建议' // 已划分 -> 已记录
  | '退回建议' // 已划分 -> 已记录（仍留痕为退回）
  | '提交校核' // 已记录 -> 已校核，需校核人给出通过/需补录结论
  | '归档结论' // 已校核(通过) -> archived（终态）
  | '退回补录' // 已校核(需补录) -> 需补录
  | '补录续办' // 需补录 -> 生成新版本，旧版失效

export type RuleSeverity = 'hard' | 'soft'
export type RuleKind = 'format' | 'classify' | 'inclusion'

/** 单条判定规则的命中结果。规则、阈值、依据标准都在 rules.ts 里集中声明。 */
export type RuleHit = {
  code: string
  title: string
  severity: RuleSeverity
  kind: RuleKind
  standard: string
  passed: boolean
  detail: string
}

export type Confidence = '高' | '中' | '低'

/** 划分建议：由判定规则、阈值与标准自动汇总，仅供记录人参考，不能直接落为结论。 */
export type DivisionSuggestion = {
  category: string
  confidence: Confidence
  summary: string
  rules: RuleHit[]
  hardViolated: boolean
}

export type Verdict = '待校核' | '通过' | '需补录'

/** 会商流转留痕：每一步是谁、做了什么、理由、依据哪条规则。 */
export type ConsultationTrace = {
  at: string
  operator: string
  action: ConsultationAction | '发起会商' | '补录新版本'
  from: ConsultationStatus | '—'
  to: ConsultationStatus | '已归档' | '—'
  reason: string
  ruleCodes: string[]
}

/** 一条会商记录（一个版本）。rawSnapshot 是原始地层的只读拷贝。 */
export type Consultation = {
  id: number
  stratumNo: string
  trenchNo: string
  levelNo: string
  soilTexture: string
  soilColor: string
  inclusions: string
  rawSnapshot: {
    地层编号: string
    所属探方: string
    层位序号: string
    土质描述: string
    土色描述: string
    包含物特征: string
  }
  suggestion: DivisionSuggestion
  status: ConsultationStatus
  verdict: Verdict
  /** 记录人对建议的采纳/退回理由（采纳理由或退回理由）。 */
  recorderDecision: '—' | '采纳' | '退回'
  recorderReason: string
  recorder: string
  checker: string
  checkReason: string
  version: number
  revision: number
  active: boolean
  archived: boolean
  createdAt: string
  createdBy: string
  archivedAt: string
  traces: ConsultationTrace[]
}

export type CreateConsultationInput = {
  stratumNo: string
  trenchNo: string
  levelNo: string
  soilTexture: string
  soilColor: string
  inclusions: string
  operator: string
}

export type AdvanceInput = {
  operator: string
  reason: string
  /** 提交校核时给出。 */
  verdict?: Exclude<Verdict, '待校核'>
  checker?: string
  /** 乐观锁：必须与当前 revision 一致，否则视为并发冲突。 */
  expectedRevision?: number
  /** 补录续办时，补录人修正后的描述字段（地层身份不变，原始地层依旧不被覆盖）。 */
  supplements?: {
    soilTexture?: string
    soilColor?: string
    inclusions?: string
  }
}

export type AdvanceResult = {
  ok: boolean
  message: string
  consultation?: Consultation
  /** 补录续办会产生新版本，新会话 id 在这里返回。 */
  newId?: number
}

/** 结论通过、归档后，同步到实测绘图页的校核事项（幂等，按 consultationId 去重）。 */
export type DrawingCheckItem = {
  id: number
  consultationId: number
  stratumNo: string
  trenchNo: string
  levelNo: string
  sourceVersion: number
  title: string
  detail: string
  required: string
  createdAt: string
  status: '待校核' | '已校核'
  checkedBy: string
  checkedAt: string
}
