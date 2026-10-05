import { buildSuggestion } from './rules'
import type {
  Consultation,
  ConsultationStatus,
  ConsultationTrace,
  DrawingCheckItem,
  Verdict,
} from './types'

// 层位会商示例：首次打开时播种；状态机推进过的记录只做演示，真正约束仍由 service 执行。
function makeConsultation(partial: {
  id: number
  stratumNo: string
  trenchNo: string
  levelNo: string
  soilTexture: string
  soilColor: string
  inclusions: string
  status: ConsultationStatus
  verdict?: Verdict
  recorderDecision?: Consultation['recorderDecision']
  recorderReason?: string
  recorder?: string
  checker?: string
  checkReason?: string
  archived?: boolean
  version?: number
  createdAt: string
  createdBy: string
  traces: ConsultationTrace[]
}): Consultation {
  const suggestion = buildSuggestion({
    stratumNo: partial.stratumNo,
    levelNo: partial.levelNo,
    soilTexture: partial.soilTexture,
    soilColor: partial.soilColor,
    inclusions: partial.inclusions,
  })
  return {
    id: partial.id,
    stratumNo: partial.stratumNo,
    trenchNo: partial.trenchNo,
    levelNo: partial.levelNo,
    soilTexture: partial.soilTexture,
    soilColor: partial.soilColor,
    inclusions: partial.inclusions,
    rawSnapshot: {
      地层编号: partial.stratumNo,
      所属探方: partial.trenchNo,
      层位序号: partial.levelNo,
      土质描述: partial.soilTexture,
      土色描述: partial.soilColor,
      包含物特征: partial.inclusions,
    },
    suggestion,
    status: partial.status,
    verdict: partial.verdict ?? '待校核',
    recorderDecision: partial.recorderDecision ?? '—',
    recorderReason: partial.recorderReason ?? '',
    recorder: partial.recorder ?? '',
    checker: partial.checker ?? '',
    checkReason: partial.checkReason ?? '',
    version: partial.version ?? 1,
    revision: 1,
    active: true,
    archived: partial.archived ?? false,
    createdAt: partial.createdAt,
    createdBy: partial.createdBy,
    archivedAt: partial.archived ? partial.createdAt : '',
    traces: partial.traces,
  }
}

export const SEED_CONSULTATIONS: Consultation[] = [
  makeConsultation({
    id: 1,
    stratumNo: 'STRA-1001',
    trenchNo: 'T0502',
    levelNo: '3',
    soilTexture: '黄褐色黏土，较致密，含少量炭粒与碎陶片',
    soilColor: '黄褐色',
    inclusions: '炭粒、碎陶片',
    status: '已划分',
    createdAt: '2026-09-20 09:12',
    createdBy: '值班管理员',
    traces: [
      {
        at: '2026-09-20 09:12',
        operator: '值班管理员',
        action: '发起会商',
        from: '—',
        to: '已划分',
        reason: '新揭露第 3 层，发起层位会商',
        ruleCodes: [],
      },
    ],
  }),
  makeConsultation({
    id: 2,
    stratumNo: 'STRA-1002',
    trenchNo: 'T0502',
    levelNo: '2',
    soilTexture: '灰褐色粉砂土，疏松，含大量炭屑、红烧土颗粒和绳纹陶片',
    soilColor: '灰褐色',
    inclusions: '炭屑、红烧土、绳纹陶片',
    status: '已校核',
    verdict: '通过',
    recorderDecision: '采纳',
    recorderReason: '土质土色与包含物均支持文化层判断，采纳建议划分为文化层。',
    recorder: '李记录',
    checker: '王校核',
    checkReason: '复核无误，文化层特征明确，同意通过并归档。',
    archived: true,
    createdAt: '2026-09-18 10:05',
    createdBy: '李记录',
    traces: [
      {
        at: '2026-09-18 10:05',
        operator: '李记录',
        action: '发起会商',
        from: '—',
        to: '已划分',
        reason: '第 2 层揭露完成，发起会商',
        ruleCodes: [],
      },
      {
        at: '2026-09-18 10:30',
        operator: '李记录',
        action: '采纳建议',
        from: '已划分',
        to: '已记录',
        reason: '土质土色与包含物均支持文化层判断，采纳。',
        ruleCodes: ['R07'],
      },
      {
        at: '2026-09-19 15:20',
        operator: '王校核',
        action: '提交校核',
        from: '已记录',
        to: '已校核',
        reason: '复核无误，文化层特征明确，结论通过。',
        ruleCodes: ['R07'],
      },
      {
        at: '2026-09-19 15:22',
        operator: '王校核',
        action: '归档结论',
        from: '已校核',
        to: '已归档',
        reason: '结论通过，归档并同步实测绘图校核事项。',
        ruleCodes: [],
      },
    ],
  }),
  makeConsultation({
    id: 3,
    stratumNo: 'STRA-1003',
    trenchNo: 'T0503',
    levelNo: '1',
    soilTexture: '黄褐色黏土，质地致密但又疏松，含少量陶片',
    soilColor: '黄褐色',
    inclusions: '少量陶片',
    status: '需补录',
    verdict: '需补录',
    recorderDecision: '采纳',
    recorderReason: '现场判断为一般文化层，采纳建议先记录。',
    recorder: '李记录',
    checker: '王校核',
    checkReason: '土质“致密”与“疏松”自相矛盾，硬性规则 R05 未过，不能通过，退回补录。',
    createdAt: '2026-09-21 14:00',
    createdBy: '李记录',
    traces: [
      {
        at: '2026-09-21 14:00',
        operator: '李记录',
        action: '发起会商',
        from: '—',
        to: '已划分',
        reason: 'T0503 第 1 层发起会商',
        ruleCodes: [],
      },
      {
        at: '2026-09-21 14:10',
        operator: '李记录',
        action: '采纳建议',
        from: '已划分',
        to: '已记录',
        reason: '现场判断为一般文化层，先采纳记录。',
        ruleCodes: ['R07'],
      },
      {
        at: '2026-09-22 09:40',
        operator: '王校核',
        action: '提交校核',
        from: '已记录',
        to: '已校核',
        reason: '复核发现性状描述矛盾，初步结论为需补录。',
        ruleCodes: ['R05'],
      },
      {
        at: '2026-09-22 09:42',
        operator: '王校核',
        action: '退回补录',
        from: '已校核',
        to: '需补录',
        reason: '硬性规则 R05 未过，退回补录核实致密/疏松性状。',
        ruleCodes: ['R05'],
      },
    ],
  }),
]

// 结论通过归档后同步到实测绘图页的校核事项（与 SEED_CONSULTATIONS 中已归档记录对应，幂等）。
export const SEED_DRAWING_CHECKS: DrawingCheckItem[] = [
  {
    id: 1,
    consultationId: 2,
    stratumNo: 'STRA-1002',
    trenchNo: 'T0502',
    levelNo: '2',
    sourceVersion: 1,
    title: '依据 STRA-1002（v1）校核地层剖面图',
    detail: '该层已会商归档为文化层，请核对剖面图中层界、土质土色注记与包含物分布是否一致。',
    required: '核对层位界线、土色土质标注、包含物图例；确认无误后在实测图上签核。',
    createdAt: '2026-09-19 15:22',
    status: '待校核',
    checkedBy: '',
    checkedAt: '',
  },
]
