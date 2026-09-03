import { computed, ref } from 'vue'
import { IDLE_UPDATE_STATE, type UpdateState, type WhatsNew } from '@shared/types'
import { toast } from './useToasts'

/**
 * Auto-update state, mirrored from main. The updater there owns the state
 * machine; this is a read-through copy plus the three actions the UI needs.
 *
 * `notes` arrives already flattened to plain text — main strips the HTML the
 * GitHub feed serves — so nothing here needs to render markup.
 */
const api = window.api

/** Where releases are published; mirrors the `publish` block in electron-builder.yml. */
const RELEASES_URL = 'https://github.com/Sh1vZ/Sift/releases'

export const update = ref<UpdateState>({ ...IDLE_UPDATE_STATE })

/** The changelog for the running build, shown once after it updates itself. */
export const whatsNew = ref<WhatsNew | null>(null)

export const checking = computed(() => update.value.status === 'checking')
export const updateReady = computed(() => update.value.status === 'downloaded')
/** False in a development build, where there is no feed to check. */
export const canUpdate = computed(() => update.value.status !== 'unsupported')

/**
 * The title bar shows an update only once it is actionable or on its way in.
 * Checking, up-to-date and error states belong in Settings — surfacing them here
 * would make a background check feel like something the user has to attend to.
 */
export const updatePill = computed(() => {
  switch (update.value.status) {
    case 'downloading':
      return {
        label: `Updating · ${Math.round(update.value.progress * 100)}%`,
        icon: 'i-lucide-cloud-download',
        ready: false
      }
    case 'downloaded':
      return { label: 'Restart to update', icon: 'i-lucide-circle-arrow-up', ready: true }
    default:
      return null
  }
})

/**
 * The release page for the version on offer, or the release list when there is
 * none. Opened with `target="_blank"`, which the main process turns into
 * `shell.openExternal` — a plain link would navigate the app window instead.
 */
export const releaseUrl = computed(() =>
  update.value.version ? `${RELEASES_URL}/tag/v${update.value.version}` : RELEASES_URL
)

export async function initUpdates(): Promise<void> {
  // Seed before subscribing: the launch check can land before the renderer is
  // listening, and this also restores state across a devtools reload.
  update.value = await api.updates.get()

  api.on('update:changed', (next) => {
    const was = update.value.status
    update.value = next
    // Once per download, not on every push that keeps the same status.
    if (next.status === 'downloaded' && was !== 'downloaded') {
      toast('success', `Sift ${next.version} is ready`, 'Restart to finish installing.', {
        label: 'Restart now',
        onClick: () => api.updates.install()
      })
    }
  })

  whatsNew.value = await api.updates.whatsNew()
}

export async function checkForUpdates(): Promise<void> {
  update.value = await api.updates.check()
}

export function installUpdate(): void {
  api.updates.install()
}

/** Idempotent: the dialog's button and its own close both land here. */
export function dismissWhatsNew(): void {
  if (!whatsNew.value) return
  whatsNew.value = null
  api.updates.dismissWhatsNew()
}
