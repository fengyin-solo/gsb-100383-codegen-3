<template>
  <section class="page" data-module="consultation">
    <header class="page-head">
      <div>
        <h2>层位会商台</h2>
        <p class="page-desc">
          录入地层信息后先由判定规则给出划分建议，记录人再写明采纳或退回理由；会商只按顺序推进层位状态，不直接覆盖原始地层记录。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出会商清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel">
      <h3>推进顺序与裁决顺序</h3>
      <p class="panel-line">
        推进顺序：已划分 → 已记录 → 已校核 → 需补录（补录后重新提交记录）；跳级操作与归档后回退一律拒绝。
      </p>
      <ol class="panel-list">
        <li v-for="line in arbitrationOrder" :key="line">{{ line }}</li>
      </ol>
    </section>

    <section class="panel">
      <h3>发起会商</h3>
      <form class="filter-bar" @submit.prevent="buildSuggestion">
        <label class="filter-item">
          <span>地层编号</span>
          <input v-model="form.地层编号" placeholder="如 STRA-0001，未登记则按新层划分" />
        </label>
        <label class="filter-item">
          <span>所属探方</span>
          <input v-model="form.所属探方" placeholder="如 TREN-0001" />
        </label>
        <label class="filter-item">
          <span>层位序号</span>
          <input v-model="form.层位序号" placeholder="正整数，如 3" />
        </label>
        <label class="filter-item">
          <span>记录人</span>
          <input v-model="form.记录人" />
        </label>
        <label class="filter-item wide">
          <span>土质描述</span>
          <input v-model="form.土质描述" placeholder="不少于 10 字，如：灰褐色粉砂质黏土，土质疏松" />
        </label>
        <button class="btn" type="submit">生成划分建议</button>
      </form>

      <div v-if="suggestion" class="suggestion">
        <p class="suggestion-head">
          划分建议：<strong>{{ suggestion.verdict }}</strong>
          （当前状态「{{ suggestion.currentStatus }}」→ 建议目标「{{ suggestion.targetStatus }}」）
        </p>
        <ul class="panel-list">
          <li v-for="line in suggestion.reasons" :key="line">{{ line }}</li>
        </ul>
        <ul v-if="suggestion.hardFailures.length" class="panel-list error-text">
          <li v-for="line in suggestion.hardFailures" :key="line">{{ line }}</li>
        </ul>
        <p v-if="suggestion.hardFailures.length" class="error-text">
          硬性标准未通过：会商单仍可提交留存，但按裁决顺序①结论时禁止采纳。
        </p>
        <button class="btn primary" type="button" @click="submitTicket">提交会商单</button>
      </div>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th>会商编号</th>
          <th>地层编号</th>
          <th>所属探方</th>
          <th>层位序号</th>
          <th>当前状态</th>
          <th>建议</th>
          <th>人工结论</th>
          <th>会商状态</th>
          <th>基准版本</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in tickets" :key="String(row.id)" :class="{ 'row-selected': detail && detail.id === row.id }">
          <td>{{ row.会商编号 }}</td>
          <td>{{ row.地层编号 }}</td>
          <td>{{ row.所属探方 }}</td>
          <td>{{ row.层位序号 }}</td>
          <td>{{ row.当前状态 }}</td>
          <td>{{ row.建议结论 }}→{{ row.建议目标 }}</td>
          <td>{{ row.人工结论 || '—' }}</td>
          <td>{{ row.status }}</td>
          <td>{{ Number(row.基准版本) === -1 ? '新层' : row.基准版本 }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="showDetail(row)">详情</button>
            <template v-if="row.status === '待结论'">
              <button class="link" type="button" @click="openConclude(row, '采纳')">采纳</button>
              <button class="link" type="button" @click="openConclude(row, '退回')">退回</button>
            </template>
            <button
              v-if="row.status === '已通过' || row.status === '已退回'"
              class="link"
              type="button"
              @click="archive(row)"
            >
              归档会商
            </button>
            <button
              v-if="row.status === '已退回' || row.status === '已归档'"
              class="link"
              type="button"
              @click="reopen(row)"
            >
              回退会商
            </button>
          </td>
        </tr>
        <tr v-if="!tickets.length">
          <td colspan="10" class="empty-state">暂无会商单，请先在上方发起会商</td>
        </tr>
      </tbody>
    </table>

    <section v-if="detail" class="panel">
      <h3>会商单 {{ detail.会商编号 }} 详情</h3>
      <dl class="detail-grid">
        <dt>土质描述</dt>
        <dd>{{ detail.土质描述 }}</dd>
        <dt>建议依据</dt>
        <dd>{{ detail.建议依据 }}</dd>
        <template v-if="detail.硬性未通过">
          <dt>硬性未通过</dt>
          <dd class="error-text">{{ detail.硬性未通过 }}</dd>
        </template>
        <dt>结论理由</dt>
        <dd>{{ detail.结论理由 || '—' }}</dd>
        <dt>裁决结果</dt>
        <dd>{{ detail.裁决结果 || '—' }}</dd>
        <dt>记录人/时间</dt>
        <dd>
          {{ detail.记录人 }} · {{ detail.创建时间 }}
          <span v-if="detail.结论时间">→ 结论于 {{ detail.结论时间 }}</span>
        </dd>
      </dl>
    </section>

    <section v-if="concluding" class="panel">
      <h3>提交结论：{{ concluding.会商编号 }}（{{ concluding.decision }}）</h3>
      <p class="panel-line">
        采纳：建议生效并按顺序推进地层，实测绘图同步增加校核事项；退回：建议不生效，地层保持不变。理由必填，退回理由不少于
        10 字方可优先于系统建议。
      </p>
      <textarea
        v-model="concludeReason"
        rows="3"
        class="reason-box"
        placeholder="写明采纳或退回理由"
      ></textarea>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="submitConclusion">提交结论</button>
        <button class="btn ghost" type="button" @click="concluding = null">取消</button>
      </div>
    </section>

    <footer class="page-foot">
      <span>共 {{ tickets.length }} 张会商单</span>
      <span v-if="notice" class="ok-text">{{ notice }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  archiveTicket,
  concludeTicket,
  createTicket,
  listTickets,
  previewSuggestion,
  reopenTicket,
  type ConclusionDecision,
} from '@/api/consultation-service'
import { downloadEntries } from '@/api/local-service'
import { ARBITRATION_ORDER, type DivisionSuggestion } from '@/data/consultation'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const route = useRoute()
const arbitrationOrder = ARBITRATION_ORDER

const form = reactive({ 地层编号: '', 所属探方: '', 层位序号: '', 土质描述: '', 记录人: store.operator })
const suggestion = ref<DivisionSuggestion | null>(null)
const tickets = ref<EntryRow[]>([])
const detail = ref<EntryRow | null>(null)
const concluding = ref<{ id: number; 会商编号: string; decision: ConclusionDecision } | null>(null)
const concludeReason = ref('')
const notice = ref('')
const errorMessage = ref('')

const stats = computed(() => [
  { label: '会商总数', value: tickets.value.length },
  { label: '待结论', value: tickets.value.filter((row) => row.status === '待结论').length },
  { label: '已通过', value: tickets.value.filter((row) => row.status === '已通过').length },
  { label: '已失效', value: tickets.value.filter((row) => row.status === '已失效').length },
])

function buildSuggestion() {
  notice.value = ''
  errorMessage.value = ''
  if (!form.地层编号.trim() || !form.所属探方.trim() || !form.层位序号.trim() || !form.土质描述.trim()) {
    suggestion.value = null
    errorMessage.value = '地层编号、所属探方、层位序号、土质描述四项都必须录入'
    return
  }
  suggestion.value = previewSuggestion(form)
}

function submitTicket() {
  notice.value = ''
  errorMessage.value = ''
  const result = createTicket(form, form.记录人)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  suggestion.value = null
  reload()
}

function openConclude(row: EntryRow, decision: ConclusionDecision) {
  notice.value = ''
  errorMessage.value = ''
  concluding.value = { id: Number(row.id), 会商编号: String(row.会商编号), decision }
  concludeReason.value = ''
}

function submitConclusion() {
  if (!concluding.value) {
    return
  }
  notice.value = ''
  errorMessage.value = ''
  const result = concludeTicket(concluding.value.id, concluding.value.decision, concludeReason.value)
  if (!result.ok) {
    errorMessage.value = result.message
    reload()
    return
  }
  notice.value = result.message
  concluding.value = null
  concludeReason.value = ''
  reload()
}

function archive(row: EntryRow) {
  notice.value = ''
  errorMessage.value = ''
  const result = archiveTicket(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  reload()
}

function reopen(row: EntryRow) {
  notice.value = ''
  errorMessage.value = ''
  const result = reopenTicket(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  reload()
}

function showDetail(row: EntryRow) {
  detail.value = detail.value && detail.value.id === row.id ? null : row
}

function exportRows() {
  downloadEntries('consultation')
}

function reload() {
  tickets.value = [...listTickets()].reverse()
  if (detail.value) {
    detail.value = tickets.value.find((row) => row.id === detail.value?.id) ?? null
  }
}

onMounted(() => {
  // 从地层记录页「发起会商」带过来的预填
  for (const key of ['地层编号', '所属探方', '层位序号', '土质描述'] as const) {
    const value = route.query[key]
    if (typeof value === 'string') {
      form[key] = value
    }
  }
  if (form.地层编号 && form.所属探方 && form.层位序号 && form.土质描述) {
    buildSuggestion()
  }
  reload()
})
</script>
