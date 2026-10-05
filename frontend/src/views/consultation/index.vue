<template>
  <section class="page" data-module="consultation">
    <header class="page-head">
      <div>
        <h2>层位会商台</h2>
        <p class="page-desc">
          为地层记录增设会商：录入地层编号、所属探方、层位序号与土质描述后，先按规则/阈值/标准给划分建议，
          再由记录人写明采纳或退回理由。会商只引用原始地层快照，绝不覆盖原始记录。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">发起会商</button>
        <button class="btn" type="button" @click="resetAll">恢复示例</button>
      </div>
    </header>

    <div class="rule-banner">
      <p class="banner-line">
        <strong>推进顺序：</strong>
        <span class="pipeline">
          <template v-for="(step, i) in statusOrder" :key="step">
            <span class="pipe-step">{{ i + 1 }}.{{ step }}</span>
            <span v-if="i < statusOrder.length - 1" class="pipe-arrow">→</span>
          </template>
          <span class="pipe-arrow">→</span><span class="pipe-step final">归档（终态封印）</span>
        </span>
        ｜只能逐级 +1，<b>跳级操作、归档后回退一律拒绝</b>。
      </p>
      <p class="banner-line">
        <strong>冲突裁决顺序：</strong>
        ① 原始地层事实（只读） &gt; ② 硬性判定规则（R01–R05） &gt; ③ 人工结论（须留痕理由） &gt; ④ 系统自动建议（仅参考）。
        人工与硬规则相反时不静默通过，一律裁决「需补录」。
      </p>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>地层编号 / 所属探方</span>
        <input v-model="filters.stratumNo" placeholder="如 STRA-1001 或 T0502" />
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option v-for="step in [...statusOrder, '已归档']" :key="step" :value="step">{{ step }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>会商号</th>
          <th>地层编号</th>
          <th>所属探方</th>
          <th>层位序号</th>
          <th>土质描述（原始快照）</th>
          <th>版本</th>
          <th>有效性</th>
          <th>当前状态</th>
          <th>校核结论</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ archived: row.archived, inactive: !row.active && !row.archived }">
          <td>#{{ row.id }}</td>
          <td>{{ row.stratumNo }}</td>
          <td>{{ row.trenchNo }}</td>
          <td>{{ row.levelNo }}</td>
          <td class="cell-clip" :title="row.soilTexture">{{ row.soilTexture }}</td>
          <td>v{{ row.version }}</td>
          <td>
            <span :class="['badge', row.archived ? 'badge-archive' : row.active ? 'badge-active' : 'badge-dead']">
              {{ row.archived ? '已归档' : row.active ? '有效版本' : '已失效' }}
            </span>
          </td>
          <td>{{ row.archived ? '已归档' : row.status }}</td>
          <td>{{ row.verdict }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看 / 会商</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="empty-state">暂无会商记录，可先发起一场层位会商</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条会商版本（同一地层并发只保留一个有效版本）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 发起会商 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <div class="modal">
        <h3>发起层位会商</h3>
        <p class="modal-tip">必填四项录入后，系统立即按判定规则/阈值/标准生成划分建议；会商不回写原始地层。</p>
        <div class="form-grid">
          <label><span>地层编号 *</span><input v-model="form.stratumNo" placeholder="STRA-####" /></label>
          <label><span>所属探方 *</span><input v-model="form.trenchNo" placeholder="如 T0502" /></label>
          <label><span>层位序号 *</span><input v-model="form.levelNo" placeholder="自上而下正整数，如 3" /></label>
          <label><span>记录人</span><input v-model="form.operator" placeholder="记录人" /></label>
          <label class="wide"><span>土质描述 *</span><textarea v-model="form.soilTexture" rows="2" placeholder="如：黄褐色黏土，较致密，含少量炭粒与碎陶片" /></label>
          <label><span>土色描述</span><input v-model="form.soilColor" placeholder="如 黄褐色" /></label>
          <label><span>包含物特征</span><input v-model="form.inclusions" placeholder="如 炭粒、碎陶片" /></label>
        </div>

        <div class="suggest-preview">
          <template v-if="preview">
            <p class="suggest-head">
              划分建议：<b>{{ preview.category }}</b>
              <span :class="['conf', preview.hardViolated ? 'conf-hard' : '']">置信度 {{ preview.confidence }}</span>
              <span v-if="preview.hardViolated" class="conf-hard">· 硬性规则未通过，须补录</span>
            </p>
            <p class="suggest-summary">{{ preview.summary }}</p>
            <ul class="rule-mini">
              <li v-for="rule in preview.rules" :key="rule.code" :class="{ fail: !rule.passed, hard: rule.severity === 'hard' }">
                {{ rule.code }} {{ rule.title }}：{{ rule.detail }}
              </li>
            </ul>
          </template>
          <p v-else class="modal-tip">填齐「地层编号、所属探方、层位序号、土质描述」后这里会出现划分建议。</p>
        </div>

        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">发起（进入「已划分」）</button>
        </div>
      </div>
    </div>

    <!-- 会商详情 + 推进 -->
    <div v-if="selected" class="modal-mask" @click.self="closeDetail">
      <div class="modal modal-wide">
        <div class="detail-head">
          <h3>会商 #{{ selected.id }} · {{ selected.stratumNo }}（v{{ selected.version }}）</h3>
          <span :class="['badge', selected.archived ? 'badge-archive' : selected.active ? 'badge-active' : 'badge-dead']">
            {{ selected.archived ? '已归档（禁止回退）' : selected.active ? '有效版本' : '已失效历史版本' }}
          </span>
        </div>

        <ol class="pipeline-bar">
          <li
            v-for="(step, i) in statusOrder"
            :key="step"
            :class="stepClass(selected, step)"
          >
            <span class="step-idx">{{ i + 1 }}</span>{{ step }}
          </li>
          <li :class="selected.archived ? 'done' : ''"><span class="step-idx">✓</span>归档</li>
        </ol>

        <div class="detail-cols">
          <div class="detail-block">
            <h4>原始地层快照（只读，不可覆盖）</h4>
            <table class="kv-table">
              <tbody>
                <tr><th>地层编号</th><td>{{ selected.rawSnapshot.地层编号 }}</td></tr>
                <tr><th>所属探方</th><td>{{ selected.rawSnapshot.所属探方 }}</td></tr>
                <tr><th>层位序号</th><td>{{ selected.rawSnapshot.层位序号 }}</td></tr>
                <tr><th>土质描述</th><td>{{ selected.rawSnapshot.土质描述 }}</td></tr>
                <tr><th>土色描述</th><td>{{ selected.rawSnapshot.土色描述 || '—' }}</td></tr>
                <tr><th>包含物特征</th><td>{{ selected.rawSnapshot.包含物特征 || '—' }}</td></tr>
              </tbody>
            </table>

            <h4>系统划分建议（规则 / 阈值 / 标准）</h4>
            <p class="suggest-head">
              {{ selected.suggestion.category }}
              <span :class="['conf', selected.suggestion.hardViolated ? 'conf-hard' : '']">置信度 {{ selected.suggestion.confidence }}</span>
            </p>
            <ul class="rule-list">
              <li v-for="rule in selected.suggestion.rules" :key="rule.code">
                <div>
                  <span :class="['rule-tag', rule.passed ? 'tag-pass' : rule.severity === 'hard' ? 'tag-hard' : 'tag-soft']">
                    {{ rule.passed ? '通过' : rule.severity === 'hard' ? '硬性未过' : '倾向' }}
                  </span>
                  <b>{{ rule.code }} {{ rule.title }}</b>
                </div>
                <p>{{ rule.detail }}</p>
                <small>依据：{{ rule.standard }}</small>
              </li>
            </ul>
          </div>

          <div class="detail-block">
            <h4>人工结论留痕</h4>
            <table class="kv-table">
              <tbody>
                <tr><th>记录人处置</th><td>{{ selected.recorderDecision }}</td></tr>
                <tr><th>采纳/退回理由</th><td>{{ selected.recorderReason || '—' }}</td></tr>
                <tr><th>校核人</th><td>{{ selected.checker || '—' }}</td></tr>
                <tr><th>校核结论</th><td>{{ selected.verdict }}</td></tr>
                <tr><th>校核意见</th><td>{{ selected.checkReason || '—' }}</td></tr>
                <tr v-if="selected.archived"><th>归档时间</th><td>{{ selected.archivedAt }}</td></tr>
              </tbody>
            </table>

            <h4 v-if="!selected.archived && available.length">推进会商（逐级，禁止跳级）</h4>
            <div v-if="!selected.archived && available.length" class="action-box">
              <div class="action-btns">
                <button
                  v-for="act in available"
                  :key="act"
                  type="button"
                  :class="['btn', actForm.action === act ? 'primary' : '']"
                  @click="chooseAction(act)"
                >{{ act }}</button>
              </div>
              <template v-if="actForm.action">
                <p class="action-hint">{{ actionHint(actForm.action) }}</p>
                <div v-if="actForm.action === '补录续办'" class="supplement-box">
                  <label class="field">
                    <span>补录后土质描述 *（原始地层快照仍只读保留）</span>
                    <textarea v-model="actForm.supplementTexture" rows="2"></textarea>
                  </label>
                  <div class="supplement-row">
                    <label class="field"><span>补录后土色</span><input v-model="actForm.supplementColor" /></label>
                    <label class="field"><span>补录后包含物</span><input v-model="actForm.supplementInclusions" /></label>
                  </div>
                </div>
                <label v-if="actForm.action === '提交校核'" class="field">
                  <span>校核结论 *</span>
                  <select v-model="actForm.verdict">
                    <option value="通过">通过</option>
                    <option value="需补录">需补录</option>
                  </select>
                </label>
                <label class="field">
                  <span>{{ actForm.action === '提交校核' ? '校核人' : actForm.action === '补录续办' ? '补录人' : '操作人' }}</span>
                  <input v-model="actForm.operator" placeholder="签名" />
                </label>
                <label class="field">
                  <span>{{ reasonLabel(actForm.action) }} *（不少于 4 字）</span>
                  <textarea v-model="actForm.reason" rows="3" :placeholder="reasonPlaceholder(actForm.action)"></textarea>
                </label>
                <div class="modal-actions">
                  <button class="btn primary" type="button" @click="submitAction(selected)">确认执行</button>
                </div>
              </template>
            </div>
            <p v-else-if="!selected.archived" class="modal-tip">该版本处于「需补录」终态，请用「补录续办」生成新版本。</p>
            <p v-else class="modal-tip">已归档定案，任何回退或再流转都会被拒绝。</p>

            <h4>流转记录</h4>
            <ol class="trace-list">
              <li v-for="(t, i) in selected.traces" :key="i">
                <div class="trace-head">
                  <b>{{ t.action }}</b>
                  <span>{{ t.from }} → {{ t.to }}</span>
                  <span>{{ t.at }} · {{ t.operator }}</span>
                </div>
                <p>{{ t.reason }}</p>
                <small v-if="t.ruleCodes.length">关联规则：{{ t.ruleCodes.join('、') }}</small>
              </li>
            </ol>
          </div>
        </div>

        <p v-if="detailError" class="error-text">{{ detailError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  advanceConsultation,
  allowedActions,
  createConsultation,
  listConsultations,
  listDrawingChecks,
  resetConsultations,
  STATUS_ORDER,
} from '@/api/consultation-service'
import { buildSuggestion } from '@/data/consultation/rules'
import type {
  Consultation,
  ConsultationAction,
  ConsultationStatus,
  Verdict,
} from '@/data/consultation/types'
import { STATUS_RANK } from '@/data/consultation/types'

const statusOrder = STATUS_ORDER

const rows = ref<Consultation[]>([])
const drawingPending = ref(0)
const errorMessage = ref('')
const filters = reactive<{ stratumNo: string; status: string }>({ stratumNo: '', status: '' })

const creating = ref(false)
const form = reactive({
  stratumNo: '',
  trenchNo: '',
  levelNo: '',
  soilTexture: '',
  soilColor: '',
  inclusions: '',
  operator: '值班管理员',
})
const formError = ref('')

const selectedId = ref<number | null>(null)
const detailError = ref('')
const actForm = reactive<{
  action: ConsultationAction | ''
  reason: string
  verdict: Exclude<Verdict, '待校核'>
  operator: string
  supplementTexture: string
  supplementColor: string
  supplementInclusions: string
}>({
  action: '',
  reason: '',
  verdict: '通过',
  operator: '值班管理员',
  supplementTexture: '',
  supplementColor: '',
  supplementInclusions: '',
})

const stats = computed(() => [
  { label: '会商版本总数', value: rows.value.length },
  { label: '进行中有效版本', value: rows.value.filter((r) => r.active && !r.archived).length },
  { label: '已归档定案', value: rows.value.filter((r) => r.archived).length },
  { label: '需补录', value: rows.value.filter((r) => r.status === '需补录' && r.active).length },
  { label: '待绘图校核事项', value: drawingPending.value },
])

const preview = computed(() => {
  if (!form.stratumNo.trim() || !form.trenchNo.trim() || !form.levelNo.trim() || !form.soilTexture.trim()) {
    return null
  }
  return buildSuggestion({
    stratumNo: form.stratumNo,
    levelNo: form.levelNo,
    soilTexture: form.soilTexture,
    soilColor: form.soilColor,
    inclusions: form.inclusions,
  })
})

const selected = computed(() =>
  selectedId.value === null ? undefined : rows.value.find((row) => row.id === selectedId.value),
)
const available = computed(() => (selected.value ? allowedActions(selected.value) : []))

function reload() {
  errorMessage.value = ''
  rows.value = listConsultations({ stratumNo: filters.stratumNo, status: filters.status })
  drawingPending.value = listDrawingChecks().filter((item) => item.status === '待校核').length
}

function resetFilters() {
  filters.stratumNo = ''
  filters.status = ''
  reload()
}

function openCreate() {
  formError.value = ''
  creating.value = true
}

function submitCreate() {
  formError.value = ''
  const result = createConsultation({ ...form })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  creating.value = false
  Object.assign(form, {
    stratumNo: '', trenchNo: '', levelNo: '', soilTexture: '', soilColor: '', inclusions: '', operator: '值班管理员',
  })
  reload()
  if (result.consultation) {
    selectedId.value = result.consultation.id
    resetActForm()
  }
}

function openDetail(row: Consultation) {
  selectedId.value = row.id
  detailError.value = ''
  resetActForm()
}

function closeDetail() {
  selectedId.value = null
  detailError.value = ''
}

function resetActForm() {
  actForm.action = ''
  actForm.reason = ''
  actForm.verdict = '通过'
  actForm.operator = '值班管理员'
  actForm.supplementTexture = ''
  actForm.supplementColor = ''
  actForm.supplementInclusions = ''
}

function chooseAction(act: ConsultationAction) {
  actForm.action = act
  if (act === '退回补录' || act === '退回建议') actForm.verdict = '需补录'
  if (act === '提交校核') actForm.verdict = '通过'
  if (act === '补录续办' && selected.value) {
    actForm.supplementTexture = selected.value.soilTexture
    actForm.supplementColor = selected.value.soilColor
    actForm.supplementInclusions = selected.value.inclusions
  }
  detailError.value = ''
}

function reasonLabel(act: string): string {
  if (act === '采纳建议') return '采纳理由'
  if (act === '退回建议') return '退回理由'
  if (act === '提交校核') return '校核意见'
  if (act === '归档结论') return '归档说明'
  if (act === '退回补录') return '退回补录理由'
  return '补录说明'
}

function reasonPlaceholder(act: string): string {
  const map: Record<string, string> = {
    采纳建议: '说明为何采纳系统划分建议、与现场事实是否一致',
    退回建议: '说明为何退回系统建议，依据哪条现场事实或规则',
    提交校核: '校核人写明复核依据；人工与硬规则冲突时将被裁决为需补录',
    归档结论: '确认结论通过，归档后同步实测绘图校核事项，不可回退',
    退回补录: '写明需要补录核实的具体内容（如土质性状矛盾）',
    补录续办: '说明本次补录修正了哪些字段，生成新版本，旧版留失效',
  }
  return map[act] ?? '请写明理由'
}

function actionHint(act: string): string {
  const map: Record<string, string> = {
    采纳建议: '「已划分」→「已记录」：采纳系统建议，但仍以你的留痕结论为准。',
    退回建议: '「已划分」→「已记录」：不采纳建议并写明退回理由，流程照常前进。',
    提交校核: '「已记录」→「已校核」：给出通过/需补录结论；硬规则未过时通过会被改判需补录。',
    归档结论: '「已校核(通过)」→「归档」：终态封印，同步实测绘图校核事项。',
    退回补录: '「已校核」→「需补录」：逐级前进，不是回退。',
    补录续办: '「需补录」→ 生成新版本，从「已划分」重走，旧版本置失效、不改原始地层。',
  }
  return map[act] ?? ''
}

function submitAction(row: Consultation) {
  if (!actForm.action) return
  detailError.value = ''
  const result = advanceConsultation(row.id, actForm.action, {
    operator: actForm.operator,
    reason: actForm.reason,
    verdict: actForm.action === '提交校核' ? actForm.verdict : undefined,
    checker: actForm.operator,
    expectedRevision: row.revision,
    supplements:
      actForm.action === '补录续办'
        ? {
            soilTexture: actForm.supplementTexture,
            soilColor: actForm.supplementColor,
            inclusions: actForm.supplementInclusions,
          }
        : undefined,
  })
  if (!result.ok) {
    detailError.value = result.message
    reload()
    return
  }
  reload()
  if (actForm.action === '补录续办' && result.newId) {
    selectedId.value = result.newId
  }
  resetActForm()
}

function stepClass(row: Consultation, step: ConsultationStatus): string {
  if (row.archived) return 'done'
  const rank = STATUS_RANK[step]
  const currentRank = STATUS_RANK[row.status]
  if (rank < currentRank) return 'done'
  if (rank === currentRank) return 'current'
  return ''
}

function resetAll() {
  resetConsultations()
  closeDetail()
  reload()
}

onMounted(reload)
</script>

<style scoped>
.rule-banner { background: #fff; border: 1px solid var(--border); border-left: 4px solid var(--brand); border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; }
.banner-line { margin: 4px 0; font-size: 12.5px; line-height: 1.7; color: #334155; }
.pipeline { white-space: nowrap; }
.pipe-step { background: #eef2f7; border-radius: 999px; padding: 1px 8px; }
.pipe-step.final { background: #e7f0ff; color: var(--brand); }
.pipe-arrow { margin: 0 4px; color: var(--muted); }
.cell-clip { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { border-radius: 999px; padding: 2px 8px; font-size: 12px; white-space: nowrap; }
.badge-active { background: #e7f7ee; color: #067647; }
.badge-archive { background: #e7f0ff; color: #1f6feb; }
.badge-dead { background: #f2f4f7; color: var(--muted); }
tr.arch td { background: #f8fafc; color: var(--muted); }
tr.inactive td { background: #fcfcfd; color: #94a3b8; }

.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-start; justify-content: center; padding: 32px 16px; overflow-y: auto; z-index: 50; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 560px; max-width: 100%; }
.modal-wide { width: 960px; }
.modal h3 { margin: 0 0 6px; }
.modal h4 { margin: 14px 0 6px; font-size: 13.5px; }
.modal-tip { color: var(--muted); font-size: 12px; margin: 4px 0; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
.form-grid label span, .field span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid .wide { grid-column: 1 / -1; }
input, textarea, select { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit; }
.suggest-preview { background: #f8fafc; border: 1px dashed var(--border); border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
.suggest-head { margin: 2px 0; font-size: 13px; }
.suggest-summary { margin: 4px 0; font-size: 12.5px; color: #334155; }
.conf { font-size: 12px; color: var(--brand); margin-left: 6px; }
.conf-hard { color: #b42318; }
.rule-mini, .rule-list { list-style: none; margin: 6px 0 0; padding: 0; }
.rule-mini li { font-size: 12px; color: #475569; padding: 1px 0; }
.rule-mini li.fail { color: #b45309; }
.rule-mini li.hard.fail { color: #b42318; font-weight: 600; }
.rule-list li { border-bottom: 1px dashed var(--border); padding: 6px 0; }
.rule-list li p { margin: 2px 0; font-size: 12.5px; }
.rule-list li small { color: var(--muted); }
.rule-tag { border-radius: 4px; padding: 0 6px; font-size: 11px; margin-right: 6px; }
.tag-pass { background: #e7f7ee; color: #067647; }
.tag-hard { background: #fdeaea; color: #b42318; }
.tag-soft { background: #eef2f7; color: #475569; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; }
.pipeline-bar { list-style: none; display: flex; gap: 6px; padding: 0; margin: 10px 0; flex-wrap: wrap; }
.pipeline-bar li { flex: 1; min-width: 110px; text-align: center; border: 1px solid var(--border); border-radius: 6px; padding: 6px; font-size: 12px; color: var(--muted); background: #f8fafc; }
.pipeline-bar li .step-idx { display: inline-block; width: 18px; height: 18px; border-radius: 50%; background: #e2e8f0; color: #64748b; margin-right: 4px; }
.pipeline-bar li.done { background: #e7f7ee; border-color: #9ad8b4; color: #067647; }
.pipeline-bar li.done .step-idx { background: #067647; color: #fff; }
.pipeline-bar li.current { background: #e7f0ff; border-color: var(--brand); color: var(--brand); font-weight: 600; }
.pipeline-bar li.current .step-idx { background: var(--brand); color: #fff; }
.detail-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.kv-table { width: 100%; border-collapse: collapse; }
.kv-table th, .kv-table td { border: 1px solid var(--border); padding: 5px 8px; font-size: 12.5px; text-align: left; vertical-align: top; }
.kv-table th { width: 92px; background: #f8fafc; color: var(--muted); font-weight: 500; }
.action-box { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #fcfdff; }
.action-btns { display: flex; flex-wrap: wrap; gap: 6px; }
.action-hint { font-size: 12px; color: var(--muted); margin: 8px 0; }
.supplement-box { background: #fff; border: 1px dashed var(--border); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
.supplement-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.field { display: block; margin-bottom: 8px; }
.trace-list { list-style: none; margin: 6px 0 0; padding: 0; max-height: 260px; overflow-y: auto; }
.trace-list li { border-left: 3px solid var(--brand); padding: 4px 8px; margin-bottom: 6px; background: #f8fafc; border-radius: 0 6px 6px 0; }
.trace-head { display: flex; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.trace-head span { color: var(--muted); }
.trace-list p { margin: 2px 0; font-size: 12.5px; }
.trace-list small { color: var(--muted); }
@media (max-width: 900px) { .detail-cols { grid-template-columns: 1fr; } .form-grid { grid-template-columns: 1fr; } }
</style>
