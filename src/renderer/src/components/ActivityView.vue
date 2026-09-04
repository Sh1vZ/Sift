<script setup lang="ts">
import { computed } from 'vue'
import ActivityHistoryRow from './ActivityHistoryRow.vue'
import ActivityLiveList from './ActivityLiveList.vue'
import SplitText from './bits/SplitText.vue'
import { activityCount, activityItems, activityTab } from '@/composables/useActivity'
import { clearActivity, historyRecords } from '@/composables/useActivityHistory'
import { motionEnabled } from '@/composables/useMotion'

/**
 * The whole story in one place: every job running now under Active, and
 * everything that finished under History, each row going back to what it was
 * about. The sidebar popover shows a slice of this and points here.
 */
const tabs = computed(() => [
  { label: 'Active', value: 'active', badge: activityCount.value || undefined },
  { label: 'History', value: 'history', badge: historyRecords.value.length || undefined },
])

const stats = computed(
  () => `${activityItems.value.length} running · ${historyRecords.value.length} in history`,
)
</script>

<template>
  <section class="view">
    <header class="head">
      <div class="head-text">
        <SplitText
          v-if="motionEnabled"
          text="Activity"
          tag="h1"
          class-name="title"
          split-type="chars"
          :delay="18"
          :duration="0.55"
          ease="power3.out"
          :from="{ opacity: 0, y: 22 }"
          :to="{ opacity: 1, y: 0 }"
          text-align="left"
          immediate
        />
        <h1 v-else class="title">Activity</h1>
        <p class="stats">{{ stats }}</p>
      </div>

      <div class="toolbar">
        <UButton
          v-if="activityTab === 'history' && historyRecords.length"
          label="Clear history"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="subtle"
          size="lg"
          @click="clearActivity()"
        />
      </div>
    </header>

    <UTabs
      v-model="activityTab"
      :items="tabs"
      variant="link"
      size="md"
      :content="false"
      class="tabs"
      :ui="{ list: 'px-7', trigger: 'font-heading uppercase tracking-wider' }"
    />

    <div class="stage">
      <div class="page">
        <div v-if="activityTab === 'active'" class="card">
          <ActivityLiveList />
        </div>
        <template v-else>
          <UEmpty
            v-if="!historyRecords.length"
            class="empty"
            icon="i-lucide-history"
            title="No history yet"
            description="Finished exports, uploads and clip changes are kept here, across restarts."
            variant="subtle"
          />
          <ul v-else class="card list">
            <ActivityHistoryRow v-for="r in historyRecords" :key="r.id" :record="r" />
          </ul>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 28px 14px;
}
.head-text {
  min-width: 0;
}
.title {
  display: block;
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.stats {
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tabs {
  flex: none;
  border-bottom: 1px solid var(--border);
}
.stage {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.page {
  max-width: var(--page-max);
  margin: 0 auto;
  padding: var(--s-6) 28px var(--s-10);
}
/* The rows carry their own dividers; the card gives the list one edge. */
.card {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.empty {
  padding: var(--s-10) var(--s-4);
}
</style>
