import type {
  Confidence,
  DivisionSuggestion,
  RuleHit,
  RuleSeverity,
} from './types'

/**
 * 层位划分判定规则库。
 *
 * 规则、阈值与依据标准集中在这里声明，页面与 service 都不私自硬编码判断。
 * 依据标准（字段填写规则与田野描述要素）：
 * - 《田野考古工作规程》（国家文物局）：地层需按土质土色区分、单位编号与层位记录规范；
 * - 《考古调查、勘探、发掘经费预算定额管理办法》配套的发掘记录规范；
 * - 《大遗址考古工作要求》(WW/T 0071) 及《考古发掘管理》通行记录要素：土质、土色、包含物须成句描述。
 * 纯前端无后端，这里用可审计的关键词规则与明确阈值表达“判定规则/阈值/标准”，便于后续替换为规则服务。
 */

// 阈值集中声明。
export const RULE_THRESHOLDS = {
  /** 土质描述最少要成句的字数；低于则判为描述不完整（硬性）。 */
  SOIL_TEXT_MIN_LEN: 8,
  /** 地层编号正则：STRA 前缀 + 4 位序号（与示例 STRA-0001 一致）。 */
  STRATUM_NO_PATTERN: /^STRA-\d{4}$/,
  /** 层位序号须为正整数（1、2、3……表示自上而下的层序）。 */
  LEVEL_NO_PATTERN: /^[1-9]\d*$/,
} as const

// 依据标准文本，命中明细里直接带出，做到“每条结论都有出处”。
const STD = {
  record: '《田野考古工作规程》地层单位编号与层位记录规范',
  desc: 'WW/T 0071《大遗址考古工作要求》记录要素：土质、土色、包含物须成句描述',
  classify: '《田野考古工作规程》按土质土色划分地层、辨识堆积性质',
} as const

type RuleContext = {
  stratumNo: string
  levelNo: string
  soilTexture: string
  soilColor: string
  inclusions: string
}

type RuleDef = {
  code: string
  title: string
  severity: RuleSeverity
  standard: string
  test: (ctx: RuleContext) => { passed: boolean; detail: string }
}

function includesAny(text: string, words: string[]): string[] {
  return words.filter((word) => word.length > 0 && text.includes(word))
}

// 规则按“先格式硬性、再性质软性”排列。
const RULE_DEFS: RuleDef[] = [
  {
    code: 'R01',
    title: '地层编号格式',
    severity: 'hard',
    standard: STD.record,
    test: (ctx) => {
      const ok = RULE_THRESHOLDS.STRATUM_NO_PATTERN.test(ctx.stratumNo.trim())
      return {
        passed: ok,
        detail: ok
          ? `地层编号「${ctx.stratumNo}」符合 STRA-四位序号 规范`
          : `地层编号「${ctx.stratumNo}」不符合 STRA-#### 编号规范，无法据此归档`,
      }
    },
  },
  {
    code: 'R02',
    title: '层位序号合法',
    severity: 'hard',
    standard: STD.record,
    test: (ctx) => {
      const ok = RULE_THRESHOLDS.LEVEL_NO_PATTERN.test(ctx.levelNo.trim())
      return {
        passed: ok,
        detail: ok
          ? `层位序号「${ctx.levelNo}」为正整数，符合自上而下的层序表达`
          : `层位序号「${ctx.levelNo}」不是正整数，层序无法排序，需补录核实`,
      }
    },
  },
  {
    code: 'R03',
    title: '土质描述完整',
    severity: 'hard',
    standard: STD.desc,
    test: (ctx) => {
      const len = ctx.soilTexture.trim().length
      const ok = len >= RULE_THRESHOLDS.SOIL_TEXT_MIN_LEN
      return {
        passed: ok,
        detail: ok
          ? `土质描述 ${len} 字，达到成句描述阈值（≥${RULE_THRESHOLDS.SOIL_TEXT_MIN_LEN} 字）`
          : `土质描述仅 ${len} 字，低于成句阈值 ${RULE_THRESHOLDS.SOIL_TEXT_MIN_LEN} 字，要素不全`,
      }
    },
  },
  {
    code: 'R04',
    title: '土色要素齐备',
    severity: 'hard',
    standard: STD.desc,
    test: (ctx) => {
      const ok = ctx.soilColor.trim().length > 0
      return {
        passed: ok,
        detail: ok ? '已记录土色，满足“土质土色区分地层”要求' : '缺少土色描述，无法按土色区分相邻地层',
      }
    },
  },
  {
    code: 'R05',
    title: '自相矛盾描述',
    severity: 'hard',
    standard: STD.classify,
    test: (ctx) => {
      const text = ctx.soilTexture
      const compact = includesAny(text, ['致密', '板结', '坚硬'])
      const loose = includesAny(text, ['疏松', '松散'])
      const conflict = compact.length > 0 && loose.length > 0
      return {
        passed: !conflict,
        detail: conflict
          ? `土质描述同时出现「${compact.join('、')}」与「${loose.join('、')}」，性状自相矛盾`
          : '未见自相矛盾的性状描述',
      }
    },
  },
  {
    code: 'R06',
    title: '耕土/表土层辨识',
    severity: 'soft',
    standard: STD.classify,
    test: (ctx) => {
      const hit = includesAny(ctx.soilTexture, ['耕土', '耕植', '表土', '腐殖', '根系', '植物根'])
      return {
        passed: hit.length === 0,
        detail:
          hit.length > 0
            ? `命中「${hit.join('、')}」，倾向划分为耕土/表土层（第 1 层）`
            : '未见耕土/表土特征词',
      }
    },
  },
  {
    code: 'R07',
    title: '文化层辨识',
    severity: 'soft',
    standard: STD.classify,
    test: (ctx) => {
      const text = ctx.soilTexture + ctx.inclusions
      const hit = includesAny(text, ['陶片', '炭粒', '炭屑', '红烧土', '灰烬', '骨屑', '绳纹', '瓦片', '瓷片'])
      return {
        passed: hit.length === 0,
        detail:
          hit.length > 0
            ? `包含物/土质命中「${hit.join('、')}」，倾向划分为文化层`
            : '未见典型文化层包含物',
      }
    },
  },
  {
    code: 'R08',
    title: '扰土/回填辨识',
    severity: 'soft',
    standard: STD.classify,
    test: (ctx) => {
      const text = ctx.soilTexture + ctx.inclusions
      const hit = includesAny(text, ['扰土', '回填', '杂土', '混入', '现代', '塑料', '砖块', '垃圾'])
      return {
        passed: hit.length === 0,
        detail:
          hit.length > 0
            ? `命中「${hit.join('、')}」，倾向判定为扰动/回填堆积，需谨慎划分层位`
            : '未见扰动/回填特征词',
      }
    },
  },
  {
    code: 'R09',
    title: '原生土辨识',
    severity: 'soft',
    standard: STD.classify,
    test: (ctx) => {
      const text = ctx.soilTexture
      const hit = includesAny(text, ['生土', '原生', '未受扰动', '纯净', '无包含物'])
      return {
        passed: hit.length === 0,
        detail:
          hit.length > 0
            ? `命中「${hit.join('、')}」，倾向判定为已到底的原生土（生土层）`
            : '未见原生土特征词',
      }
    },
  },
  {
    code: 'R10',
    title: '自然淤积层辨识',
    severity: 'soft',
    standard: STD.classify,
    test: (ctx) => {
      const text = ctx.soilTexture
      const hit = includesAny(text, ['淤积', '淤土', '砂层', '胶结', '水平层理', '沉积', '黏土'])
      return {
        passed: hit.length === 0,
        detail:
          hit.length > 0
            ? `命中「${hit.join('、')}」，倾向判为自然淤积/沉积层，应与人工堆积区分`
            : '未见自然淤积特征词',
      }
    },
  },
  {
    code: 'R11',
    title: '遗迹迹象提示',
    severity: 'soft',
    standard: STD.record,
    test: (ctx) => {
      const text = ctx.soilTexture + ctx.inclusions
      const hit = includesAny(text, ['柱洞', '灰坑', '夯土', '墓', '灶', '沟'])
      return {
        passed: hit.length === 0,
        detail:
          hit.length > 0
            ? `出现「${hit.join('、')}」等遗迹迹象，提示应另立遗迹单位，不宜并入普通地层`
            : '未见需另立单位的遗迹迹象',
      }
    },
  },
]

export function evaluateRules(ctx: RuleContext): RuleHit[] {
  return RULE_DEFS.map((def) => {
    const result = def.test(ctx)
    return {
      code: def.code,
      title: def.title,
      severity: def.severity,
      kind: def.code === 'R11' ? 'inclusion' : def.severity === 'hard' ? 'format' : 'classify',
      standard: def.standard,
      passed: result.passed,
      detail: result.detail,
    }
  })
}

/** 依据命中的软性分类规则给出倾向层位类别（仅建议，绝不自动落结论）。 */
function suggestCategory(rules: RuleHit[]): { category: string; confidence: Confidence } {
  const hitCode = (code: string) => rules.some((rule) => rule.code === code && !rule.passed)
  // 多条同时命中时，按田野风险优先级给倾向：扰动 > 遗迹提示 > 表土 > 文化层 > 淤积 > 生土。
  if (hitCode('R08')) return { category: '扰动/回填堆积（慎划层位）', confidence: '中' }
  if (hitCode('R11')) return { category: '疑似遗迹（建议另立遗迹单位）', confidence: '中' }
  if (hitCode('R06')) return { category: '耕土/表土层', confidence: '高' }
  if (hitCode('R07')) return { category: '文化层', confidence: '高' }
  if (hitCode('R10')) return { category: '自然淤积/沉积层', confidence: '中' }
  if (hitCode('R09')) return { category: '原生土（生土层）', confidence: '高' }
  return { category: '一般堆积层（按土质土色细分）', confidence: '低' }
}

/** 汇总划分建议。硬性规则任一不通过，直接给出“暂缓划分·补录核实”，置信度判为高。 */
export function buildSuggestion(ctx: RuleContext): DivisionSuggestion {
  const rules = evaluateRules(ctx)
  const hard = rules.filter((rule) => rule.severity === 'hard')
  const soft = rules.filter((rule) => rule.severity === 'soft')
  const hardViolated = hard.some((rule) => !rule.passed)
  const softHits = soft.filter((rule) => !rule.passed)

  const category = suggestCategory(rules)
  const failedHard = hard.filter((rule) => !rule.passed)

  if (hardViolated) {
    return {
      category: '暂缓划分·补录核实',
      confidence: '高',
      summary: `硬性规则 ${failedHard
        .map((rule) => rule.code)
        .join('、')} 未通过：${failedHard.map((rule) => rule.title).join('、')}，应补录核实后再划分。`,
      rules,
      hardViolated: true,
    }
  }

  const confidence: Confidence =
    softHits.length >= 1 && category.confidence === '高'
      ? '高'
      : softHits.length >= 1
        ? '中'
        : '低'
  const summary =
    softHits.length > 0
      ? `依据 ${softHits.map((rule) => rule.code).join('、')} 倾向划分为「${category.category}」（置信度${confidence}）。此为系统建议，最终以记录人/校核人留痕结论为准。`
      : '未命中明确的性状特征词，倾向「一般堆积层」，建议补充更典型的土质土色与包含物描述。'

  return { category: category.category, confidence, summary, rules, hardViolated: false }
}
