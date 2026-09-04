/**
 * The Google projects the user connected: their OAuth clients, refresh tokens,
 * channels and playlists. Secrets live here decrypted in memory and go to disk
 * only through `safeStorage`; the renderer sees `YouTubeAccount` snapshots
 * that carry neither the secret nor the token.
 *
 * Quota is not counted here or anywhere else in Sift: Google only exposes
 * usage through Cloud Monitoring on billing-enabled projects, and every other
 * quota API returns limits without usage. The one signal is YouTube answering
 * `quotaExceeded`, which parks the project until midnight Pacific.
 */

import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ActionResult } from '@shared/types'
import {
  OAUTH_SCOPES,
  YOUTUBE_SCOPE,
  isClientId,
  nextPacificMidnightMs,
  parseClientSecretJson,
  type YouTubeAccount,
  type YouTubeChannel,
  type YouTubeConnection,
  type YouTubePlaylist,
  type YouTubePrivacy,
  type YouTubeState,
} from '@shared/youtube'
import type { Emit } from '../library'
import type { Store, YouTubeAccountRow } from '../store'
import {
  createPlaylist,
  fetchAvatarDataUrl,
  friendlyError,
  listPlaylists,
  myChannel,
  type ApiContext,
} from './api'
import {
  OAuthError,
  buildAuthUrl,
  exchangeCode,
  pkcePair,
  randomState,
  refreshAccessToken,
  revokeToken,
  startLoopback,
} from './oauth'

const CONNECT_TIMEOUT_MS = 5 * 60_000
/** Refresh this long before the access token actually expires. */
const TOKEN_SLACK_MS = 60_000
const EMIT_MS = 250

/** The cached channel row, or null when empty or unreadable. */
function parseChannel(json: string): YouTubeChannel | null {
  if (!json) return null
  try {
    return JSON.parse(json) as YouTubeChannel
  } catch {
    return null
  }
}

interface Account {
  id: string
  label: string
  projectId: string
  clientId: string
  /** '' when the row could not be decrypted on this PC. */
  clientSecret: string
  refreshToken: string
  channel: YouTubeChannel | null
  addedAtMs: number
  sort: number
  connection: YouTubeConnection
  error: string
  /** YouTube said quotaExceeded; nothing goes through until then. 0 when fine. */
  exhaustedUntilMs: number
  access: { token: string; expiresAtMs: number } | null
  refreshing: Promise<string> | null
  playlists: YouTubePlaylist[] | null
}

export interface AccountsDeps {
  store: Store
  emit: Emit
  /** Only ever handed Google's sign-in URL; the caller keeps the allowlist. */
  openExternal(url: string): void
  /** Whether an upload on that project is queued or running (disconnect/remove refuse then). */
  hasActiveUpload(accountId: string): boolean
}

export class YouTubeAccounts {
  private readonly accounts = new Map<string, Account>()
  private connecting: { id: string; abort: AbortController } | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private encryption = false

  constructor(private readonly deps: AccountsDeps) {}

  /** After `app.whenReady()`: `safeStorage` cannot answer before that. */
  load(): void {
    this.encryption = safeStorage.isEncryptionAvailable()
    for (const row of this.deps.store.listYouTubeAccounts()) {
      const secret = this.decrypt(row.client_secret_enc)
      const token = this.decrypt(row.refresh_token_enc)
      const channel = parseChannel(row.channel_json)
      const unreadable = row.client_secret_enc !== '' && secret === null
      this.accounts.set(row.id, {
        id: row.id,
        label: row.label,
        projectId: row.project_id,
        clientId: row.client_id,
        clientSecret: secret ?? '',
        refreshToken: token ?? '',
        channel,
        addedAtMs: row.added_at_ms,
        sort: row.sort,
        connection: token && channel ? 'connected' : 'disconnected',
        error: unreadable
          ? 'The saved keys could not be read on this PC. Re-import the JSON for this project.'
          : row.refresh_token_enc && token === null
            ? 'The saved sign-in could not be read on this PC. Connect again.'
            : '',
        exhaustedUntilMs: row.exhausted_until_ms,
        access: null,
        refreshing: null,
        playlists: null,
      })
    }
  }

  // ------------------------------------------------------------------ views

  state(): YouTubeState {
    return {
      accounts: [...this.accounts.values()].map((a) => this.snapshot(a)),
      encryptionAvailable: this.encryption,
    }
  }

  private snapshot(a: Account): YouTubeAccount {
    return {
      id: a.id,
      label: a.label,
      projectId: a.projectId,
      clientId: a.clientId,
      hasSecret: a.clientSecret !== '',
      connection: a.connection,
      channel: a.channel ? { ...a.channel } : null,
      error: a.error,
      quotaExhaustedUntilMs: a.exhaustedUntilMs > Date.now() ? a.exhaustedUntilMs : 0,
      addedAtMs: a.addedAtMs,
    }
  }

  /** Connected projects in the user's order. */
  connectedIds(): string[] {
    return [...this.accounts.values()]
      .filter((a) => a.connection === 'connected')
      .sort((x, y) => x.sort - y.sort || x.addedAtMs - y.addedAtMs)
      .map((a) => a.id)
  }

  label(id: string): string {
    return this.accounts.get(id)?.label ?? 'YouTube project'
  }

  channelTitle(id: string): string {
    return this.accounts.get(id)?.channel?.title ?? ''
  }

  isConnected(id: string): boolean {
    return this.accounts.get(id)?.connection === 'connected'
  }

  isExhausted(id: string, nowMs = Date.now()): boolean {
    return (this.accounts.get(id)?.exhaustedUntilMs ?? 0) > nowMs
  }

  /** The first candidate that is connected and not out of quota, or null. */
  pick(candidates: readonly string[], nowMs = Date.now()): string | null {
    return candidates.find((id) => this.isConnected(id) && !this.isExhausted(id, nowMs)) ?? null
  }

  /** YouTube answered quotaExceeded: park the project until the Pacific day ends. */
  markExhausted(id: string, nowMs = Date.now()): void {
    const a = this.accounts.get(id)
    if (!a) return
    a.exhaustedUntilMs = nextPacificMidnightMs(nowMs)
    this.persist(a)
    this.scheduleEmit(true)
  }

  /**
   * One connected project per channel, in the user's order. A video belongs to
   * a channel, not a project, so any project signed into that channel may act
   * on it; trying every project of the same channel would only waste quota.
   */
  connectedPerChannel(): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of this.connectedIds()) {
      const ch = this.accounts.get(id)?.channel?.id ?? id
      if (seen.has(ch)) continue
      seen.add(ch)
      out.push(id)
    }
    return out
  }

  /** Which connected project owns a playlist, from the cached lists; '' when unknown. */
  ownerOfPlaylist(playlistId: string): string {
    for (const a of this.accounts.values()) {
      if (a.playlists?.some((p) => p.id === playlistId)) return a.id
    }
    return ''
  }

  playlistTitle(playlistId: string): string {
    for (const a of this.accounts.values()) {
      const p = a.playlists?.find((x) => x.id === playlistId)
      if (p) return p.title
    }
    return ''
  }

  // ------------------------------------------------------------ credentials

  add(
    clientId: string,
    clientSecret: string,
    label: string,
    projectId = '',
  ): ActionResult & { account?: YouTubeAccount } {
    const id = clientId.trim()
    const secret = clientSecret.trim()
    if (!id || !secret)
      return { ok: false, error: 'Both the client ID and the client secret are needed.' }
    if (!isClientId(id))
      return { ok: false, error: 'That does not look like a Google OAuth client ID.' }
    if ([...this.accounts.values()].some((a) => a.clientId === id))
      return { ok: false, error: 'That project is already added.' }
    const a: Account = {
      id: randomUUID().slice(0, 8),
      label: label.trim() || projectId || `Project ${this.accounts.size + 1}`,
      projectId,
      clientId: id,
      clientSecret: secret,
      refreshToken: '',
      channel: null,
      addedAtMs: Date.now(),
      sort: this.accounts.size,
      connection: 'disconnected',
      error: '',
      exhaustedUntilMs: 0,
      access: null,
      refreshing: null,
      playlists: null,
    }
    this.accounts.set(a.id, a)
    this.persist(a)
    void this.deps.store.flush()
    this.scheduleEmit(true)
    return { ok: true, account: this.snapshot(a) }
  }

  addJson(text: string, fallbackLabel = ''): ActionResult & { account?: YouTubeAccount } {
    const parsed = parseClientSecretJson(text)
    if (!parsed)
      return {
        ok: false,
        error:
          'That is not a Google client secret file. Download it from Credentials → your OAuth client.',
      }
    return this.add(
      parsed.clientId,
      parsed.clientSecret,
      parsed.projectId || fallbackLabel,
      parsed.projectId,
    )
  }

  rename(id: string, label: string): ActionResult {
    const a = this.accounts.get(id)
    if (!a) return { ok: false, error: 'Project not found.' }
    const next = label.trim()
    if (!next) return { ok: false, error: 'Give the project a name.' }
    a.label = next
    this.persist(a)
    this.scheduleEmit(true)
    return { ok: true }
  }

  async remove(id: string): Promise<ActionResult> {
    const a = this.accounts.get(id)
    if (!a) return { ok: false, error: 'Project not found.' }
    if (this.deps.hasActiveUpload(id))
      return { ok: false, error: 'Wait for the current upload to finish or cancel it first.' }
    if (this.connecting?.id === id) this.cancelConnect()
    if (a.refreshToken) await revokeToken(a.refreshToken)
    this.accounts.delete(id)
    this.deps.store.deleteYouTubeAccount(id)
    void this.deps.store.flush()
    this.scheduleEmit(true)
    return { ok: true }
  }

  async disconnect(id: string): Promise<ActionResult> {
    const a = this.accounts.get(id)
    if (!a) return { ok: false, error: 'Project not found.' }
    if (this.deps.hasActiveUpload(id))
      return { ok: false, error: 'Wait for the current upload to finish or cancel it first.' }
    if (this.connecting?.id === id) this.cancelConnect()
    if (a.refreshToken) await revokeToken(a.refreshToken)
    a.refreshToken = ''
    a.access = null
    a.channel = null
    a.playlists = null
    a.connection = 'disconnected'
    a.error = ''
    this.persist(a)
    void this.deps.store.flush()
    this.scheduleEmit(true)
    return { ok: true }
  }

  // ---------------------------------------------------------------- connect

  async connect(id: string): Promise<ActionResult> {
    const a = this.accounts.get(id)
    if (!a) return { ok: false, error: 'Project not found.' }
    if (!a.clientSecret)
      return {
        ok: false,
        error: 'The client secret is missing. Re-import the JSON for this project.',
      }
    if (this.connecting)
      return {
        ok: false,
        error: 'A sign-in is already open in your browser. Finish it there, or cancel it.',
      }
    const abort = new AbortController()
    this.connecting = { id, abort }
    a.connection = 'connecting'
    a.error = ''
    this.scheduleEmit(true)

    const { verifier, challenge } = pkcePair()
    const state = randomState()
    try {
      const loop = await startLoopback(state, abort.signal, CONNECT_TIMEOUT_MS)
      const url = buildAuthUrl({
        clientId: a.clientId,
        redirectUri: loop.redirectUri,
        challenge,
        state,
        scopes: OAUTH_SCOPES,
      })
      this.deps.openExternal(url)
      const code = await loop.code
      const tokens = await exchangeCode({
        clientId: a.clientId,
        clientSecret: a.clientSecret,
        code,
        redirectUri: loop.redirectUri,
        verifier,
      })
      if (!tokens.scope.split(' ').includes(YOUTUBE_SCOPE)) {
        throw new OAuthError(
          'scope',
          'Google did not grant channel access. Tick the YouTube permission and try again.',
        )
      }
      a.refreshToken = tokens.refreshToken
      a.access = { token: tokens.accessToken, expiresAtMs: tokens.expiresAtMs }
      const ch = await myChannel(this.ctx(id, abort.signal))
      a.channel = {
        id: ch.id,
        title: ch.title,
        avatar: await fetchAvatarDataUrl(ch.avatarUrl, abort.signal),
      }
      a.connection = 'connected'
      a.error = ''
      this.persist(a)
      await this.deps.store.flush()
      this.scheduleEmit(true)
      void this.playlists(id, true)
      return { ok: true }
    } catch (err) {
      // The account keeps whatever it had before; a failed reconnect is not a disconnect.
      // A token from a sign-in that never reached its channel is not kept either.
      if (!a.channel) {
        a.refreshToken = ''
        a.access = null
      }
      a.connection = a.refreshToken && a.channel ? 'connected' : 'disconnected'
      a.error = friendlyError(err, a.label)
      this.scheduleEmit(true)
      return { ok: false, error: a.error }
    } finally {
      this.connecting = null
    }
  }

  cancelConnect(): void {
    this.connecting?.abort.abort()
  }

  // ----------------------------------------------------------------- tokens

  /** A bearer token for the project, refreshed when within a minute of expiry. */
  async accessToken(id: string, force = false): Promise<string> {
    const a = this.accounts.get(id)
    if (!a) throw new OAuthError('unknown_account', 'Project not found.')
    if (!a.refreshToken) throw new OAuthError('invalid_grant', 'Not connected.')
    if (!force && a.access && a.access.expiresAtMs - Date.now() > TOKEN_SLACK_MS)
      return a.access.token
    if (a.refreshing) return a.refreshing
    a.refreshing = refreshAccessToken({
      clientId: a.clientId,
      clientSecret: a.clientSecret,
      refreshToken: a.refreshToken,
    })
      .then((t) => {
        a.access = { token: t.accessToken, expiresAtMs: t.expiresAtMs }
        return t.accessToken
      })
      .catch((err: unknown) => {
        if (
          err instanceof OAuthError &&
          (err.code === 'invalid_grant' ||
            err.code === 'invalid_client' ||
            err.code === 'unauthorized_client')
        ) {
          // The token is dead; the channel stays so the pane can still say whose it was.
          a.refreshToken = ''
          a.access = null
          a.connection = 'disconnected'
          a.error = friendlyError(err, a.label)
          this.persist(a)
          void this.deps.store.flush()
          this.scheduleEmit(true)
        }
        throw err
      })
      .finally(() => {
        a.refreshing = null
      })
    return a.refreshing
  }

  /** What `api.ts` needs to make calls on behalf of one project. */
  ctx(id: string, signal?: AbortSignal): ApiContext {
    return {
      auth: { accessToken: (force) => this.accessToken(id, force) },
      signal,
    }
  }

  // -------------------------------------------------------------- playlists

  async playlists(
    id: string,
    refresh = false,
  ): Promise<ActionResult & { playlists?: YouTubePlaylist[] }> {
    const a = this.accounts.get(id)
    if (!a) return { ok: false, error: 'Project not found.' }
    if (a.connection !== 'connected') return { ok: false, error: `${a.label} is not connected.` }
    if (a.playlists && !refresh) return { ok: true, playlists: a.playlists }
    try {
      a.playlists = await listPlaylists(this.ctx(id))
      return { ok: true, playlists: a.playlists }
    } catch (err) {
      return { ok: false, error: friendlyError(err, a.label) }
    }
  }

  async createPlaylist(
    id: string,
    title: string,
    privacy: YouTubePrivacy,
  ): Promise<ActionResult & { playlist?: YouTubePlaylist }> {
    const a = this.accounts.get(id)
    if (!a) return { ok: false, error: 'Project not found.' }
    if (a.connection !== 'connected') return { ok: false, error: `${a.label} is not connected.` }
    const name = title.trim()
    if (!name) return { ok: false, error: 'Give the playlist a name.' }
    try {
      const playlist = await createPlaylist(this.ctx(id), name, privacy)
      a.playlists = [playlist, ...(a.playlists ?? [])]
      return { ok: true, playlist }
    } catch (err) {
      return { ok: false, error: friendlyError(err, a.label) }
    }
  }

  // -------------------------------------------------------------- internals

  private encrypt(value: string): string {
    if (!value || !this.encryption) return ''
    return safeStorage.encryptString(value).toString('base64')
  }

  /** Null when the ciphertext cannot be read here (other Windows account, corrupt row). */
  private decrypt(enc: string): string | null {
    if (!enc) return ''
    if (!this.encryption) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  private persist(a: Account): void {
    // The quota_* columns date from a usage counter that no longer exists; they
    // keep their defaults so older rows and this code agree on the row shape.
    const row: YouTubeAccountRow = {
      id: a.id,
      label: a.label,
      project_id: a.projectId,
      client_id: a.clientId,
      client_secret_enc: this.encrypt(a.clientSecret),
      refresh_token_enc: this.encrypt(a.refreshToken),
      channel_json: a.channel ? JSON.stringify(a.channel) : '',
      quota_limit: 10_000,
      quota_limit_source: 'default',
      quota_day: '',
      quota_google_used: 0,
      quota_synced_at_ms: 0,
      quota_local_used: 0,
      exhausted_until_ms: a.exhaustedUntilMs,
      added_at_ms: a.addedAtMs,
      sort: a.sort,
    }
    this.deps.store.upsertYouTubeAccount(row)
  }

  scheduleEmit(now = false): void {
    const send = (): void => this.deps.emit('youtube:changed', this.state())
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      this.emitTimer = null
      send()
      return
    }
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      send()
    }, EMIT_MS)
  }

  shutdown(): void {
    this.cancelConnect()
    if (this.emitTimer) clearTimeout(this.emitTimer)
    this.emitTimer = null
  }
}
