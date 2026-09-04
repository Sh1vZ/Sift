<script setup lang="ts">
/**
 * One titled settings section: a header with an optional right-hand action,
 * then whatever the pane puts in the body. `flush` hands the body's padding to
 * the rows inside it, which is what lines their labels up with the header.
 */
withDefaults(defineProps<{ title: string; description?: string; flush?: boolean }>(), {
  description: '',
  flush: false,
})
</script>

<template>
  <UCard class="panel" :ui="flush ? { body: 'p-0 sm:p-0' } : {}">
    <template #header>
      <div class="head">
        <div class="head-text">
          <h2 class="title">{{ title }}</h2>
          <p v-if="description" class="sub">{{ description }}</p>
        </div>
        <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
      </div>
    </template>
    <slot />
  </UCard>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--s-4);
}
.head-text {
  min-width: 0;
}
.title {
  font-size: var(--text-md);
  font-weight: 600;
}
.sub {
  margin-top: var(--s-1);
  font-size: var(--text-sm);
  color: var(--fg-muted);
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex: 0 0 auto;
}
</style>
