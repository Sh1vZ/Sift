<script setup lang="ts">
import { computed } from 'vue'
import ActivityHistoryRow from './ActivityHistoryRow.vue'
import ActivityLiveList from './ActivityLiveList.vue'
import {
  activityCount,
  activityItems,
  openActivity,
  recentRecords,
} from '@/composables/useActivity'
import { historyRecords } from '@/composables/useActivityHistory'

/**
 * The sidebar glance: what is running now, then the last few things that
 * finished. Anything longer than that is the Activity page's job, which the
 * footer opens — the popover is for a look, not for digging.
 */
const more = computed(() => Math.max(0, historyRecords.value.length - recentRecords.value.length))
</script>

<template>
  <div class="panel">
    <header class="head">
      <h3>Activity</h3>
      <UBadge
        v-if="activityCount"
        color="primary"
        variant="soft"
        size="md"
        :label="`${activityCount} active`"
      />
    </header>

    <div class="scroll">
      <template v-if="activityItems.length || recentRecords.length">
        <section v-if="activityItems.length" aria-labelledby="activity-running">
          <h4 id="activity-running" class="section">Running</h4>
          <ActivityLiveList />
        </section>
        <section v-if="recentRecords.length" aria-labelledby="activity-recent">
          <h4 id="activity-recent" class="section">Recent</h4>
          <ul class="list">
            <ActivityHistoryRow v-for="r in recentRecords" :key="r.id" :record="r" />
          </ul>
        </section>
      </template>
      <UEmpty
        v-else
        class="empty"
        icon="i-lucide-moon"
        title="Nothing yet"
        description="Exports, uploads and scans show up here while they work, and stay a while after."
        variant="subtle"
        size="sm"
      />
    </div>

    <footer class="foot">
      <UButton
        class="all"
        :label="more ? `See all activity · ${more} more` : 'See all activity'"
        trailing-icon="i-lucide-arrow-right"
        color="neutral"
        variant="ghost"
        size="sm"
        block
        @click="openActivity()"
      />
    </footer>
  </div>
</template>

<style scoped>
.panel {
  width: 380px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-3) var(--s-4);
  border-bottom: 1px solid var(--border);
}
.head h3 {
  flex: 1;
  font-size: var(--text-md);
  font-weight: 600;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.section {
  padding: var(--s-3) var(--s-4) var(--s-1);
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
section + section .section {
  border-top: 1px solid var(--border);
  padding-top: var(--s-3);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.empty {
  padding: var(--s-5) var(--s-4);
}
.foot {
  flex: none;
  padding: var(--s-2);
  border-top: 1px solid var(--border);
}
.all {
  justify-content: space-between;
}
</style>
