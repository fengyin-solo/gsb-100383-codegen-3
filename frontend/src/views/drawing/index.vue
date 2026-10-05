<template>
  <section class="page" data-module="drawing">
    <header class="page-head">
      <div>
        <h2>实测绘图管理</h2>
        <p class="page-desc">维护实测图纸，围绕图纸编号、绘图对象、绘图类型、比例尺做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记实测图纸</button>
        <button class="btn" type="button" @click="exportRows">导出实测绘图清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 跨业务面：层位会商结论通过并归档后，会同步在此新增校核事项 -->
    <section class="sync-panel">
      <header class="sync-head">
        <h3>层位会商联动校核事项</h3>
        <span class="sync-count">待校核 {{ pendingChecks.length }} ｜ 已签核 {{ doneChecks.length }}</span>
      </header>
      <p class="sync-tip">来源：层位会商台结论通过并归档时幂等同步；同一地层只认一个有效版本，事项按会商号去重。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>事项号</th><th>来源会商</th><th>地层编号</th><th>所属探方</th><th>层位</th><th>校核内容与要求</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in checks" :key="item.id" :class="{ 'is-done': item.status === '已校核' }">
            <td>#{{ item.id }}</td>
            <td>#{{ item.consultationId }} v{{ item.sourceVersion }}</td>
            <td>{{ item.stratumNo }}</td>
            <td>{{ item.trenchNo }}</td>
            <td>{{ item.levelNo }}</td>
            <td>
              <div>{{ item.title }}</div>
              <small class="sync-detail">{{ item.detail }} 要求：{{ item.required }}</small>
            </td>
            <td>
              {{ item.status }}
              <small v-if="item.checkedBy" class="sync-detail"><br />{{ item.checkedBy }} · {{ item.checkedAt }}</small>
            </td>
            <td class="row-actions">
              <button v-if="item.status === '待校核'" class="link" type="button" @click="signCheck(item.id)">签核完成</button>
              <span v-else class="sync-done">已完成</span>
            </td>
          </tr>
          <tr v-if="!checks.length">
            <td colspan="8" class="empty-state">暂无联动校核事项；层位会商结论通过并归档后会出现在这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无实测绘图数据，可先登记实测图纸</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条实测绘图记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  checkDrawingItem,
  listDrawingChecks,
} from '@/api/consultation-service'
import type { DrawingCheckItem } from '@/data/consultation/types'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('drawing')
const columns = ["图纸编号", "绘图对象", "绘图类型", "比例尺", "绘图人", "校核人", "完成日期", "图纸状态"]
const actions = ["提交校核", "确认校核", "退回修改"]
const statuses = ["绘制中", "待校核", "已校核", "已数字化", "需修改"]
const stats = [{"label": "图纸总数", "value": 0}, {"label": "已校核数", "value": 0}, {"label": "待校核数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 跨业务面：层位会商结论通过归档后同步过来的校核事项，本页只负责展示与签核。
const checks = ref<DrawingCheckItem[]>([])
const pendingChecks = computed(() => checks.value.filter((item) => item.status === '待校核'))
const doneChecks = computed(() => checks.value.filter((item) => item.status === '已校核'))

function reloadChecks() {
  checks.value = listDrawingChecks()
}

function signCheck(id: number) {
  errorMessage.value = ''
  const result = checkDrawingItem(id, '绘图校核人')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reloadChecks()
}
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '实测图纸登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    reloadChecks()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '实测绘图列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.sync-panel { background: #fff; border: 1px solid var(--border); border-left: 4px solid var(--brand); border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }
.sync-head { display: flex; justify-content: space-between; align-items: baseline; }
.sync-head h3 { margin: 0; font-size: 14px; }
.sync-count { font-size: 12px; color: var(--muted); }
.sync-tip { margin: 4px 0 8px; font-size: 12px; color: var(--muted); }
.sync-detail { color: var(--muted); font-size: 11.5px; line-height: 1.6; }
.sync-done { color: #067647; font-size: 12px; }
tr.is-done td { background: #f8fafc; color: var(--muted); }
</style>
