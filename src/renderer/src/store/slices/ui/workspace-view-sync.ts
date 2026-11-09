import type { PersistedUIState } from '../../../../../shared/persisted-ui-state-types'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { callRuntimeRpc } from '../../../runtime/rpc/calls/runtime-rpc-call'
import type { UISliceGet, UISliceSet } from './ui-slice-contract'
import { PERSISTED_UI_WRITE_BASELINE_FIELDS } from './persisted-ui-write-baseline'
import { ALL_WORKSPACE_VIEW_UI_FIELDS } from '../../../../../shared/workspace-view/workspace-view-ui-fields'

// Host IDs, collapse keys and device-origin filters belong to each client's own catalog.
const LOCAL_VIEW_FIELDS = new Set<string>([
  'workspaceHostScope',
  'visibleWorkspaceHostIds',
  'hideWorkspacesFromOtherDevices',
  'collapsedGroups',
  'workspaceStatuses'
])
const SHARED_UI_FIELDS: readonly (keyof PersistedUIState)[] = [
  ...ALL_WORKSPACE_VIEW_UI_FIELDS.filter((field) => !LOCAL_VIEW_FIELDS.has(field)),
  '_worktreeCardModeDefaulted'
]
const SHARED_UI_FIELD_SET = new Set<string>(SHARED_UI_FIELDS)

const SHARED_SETTINGS_FIELDS = [
  'compactWorktreeCards',
  'experimentalNewWorktreeCardStyle',
  'showPinnedWorktreesInGroups'
] as const satisfies readonly (keyof GlobalSettings)[]

function pick<T extends object, K extends keyof T>(
  value: T,
  fields: readonly K[]
): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {}
  for (const field of fields) {
    if (field in value) {
      result[field] = value[field]
    }
  }
  return result
}

function omit<T extends object>(value: T, fields: readonly string[]): Partial<T> {
  const result = { ...value }
  for (const key in result) {
    if (fields.includes(key)) {
      delete result[key]
    }
  }
  return result
}

export type WorkspaceViewSyncSlice = {
  workspaceViewSync: {
    owner: string | null
    ready: boolean
    epoch: number
    ui: Partial<PersistedUIState>
    settings: Partial<GlobalSettings>
  }
  refreshWorkspaceView: (environmentId: string | null) => Promise<void>
  persistWorkspaceViewUI: (updates: Partial<PersistedUIState>) => Promise<void>
  persistWorkspaceViewSettings: (updates: Partial<GlobalSettings>) => Promise<GlobalSettings>
  projectWorkspaceViewUI: (ui: PersistedUIState) => PersistedUIState
}

export function createWorkspaceViewSyncActions(
  set: UISliceSet,
  get: UISliceGet
): WorkspaceViewSyncSlice {
  let requestGeneration = 0
  const owner = (): string | null => get().settings?.activeRuntimeEnvironmentId || null
  return {
    workspaceViewSync: { owner: null, ready: true, epoch: 0, ui: {}, settings: {} },
    projectWorkspaceViewUI: (ui) => {
      const sync = get().workspaceViewSync
      return owner() && sync.owner === owner() && sync.ready ? { ...ui, ...sync.ui } : ui
    },
    refreshWorkspaceView: async (environmentId) => {
      if (owner() !== environmentId) {
        return
      }
      const generation = ++requestGeneration
      const switched = get().workspaceViewSync.owner !== environmentId
      if (switched) {
        set((state) => ({
          workspaceViewSync: {
            owner: environmentId,
            ready: false,
            epoch: state.workspaceViewSync.epoch + 1,
            ui: {},
            settings: {}
          },
          persistedUIWriteInFlightCounts: {}
        }))
      }
      try {
        const localUI = await window.api.ui.get()
        const localSettings = await window.api.settings.get()
        const target = environmentId ? { kind: 'environment' as const, environmentId } : null
        const [remoteUI, remoteSettings] = target
          ? await Promise.all([
              callRuntimeRpc<{ ui: Partial<PersistedUIState> }>(target, 'ui.get', undefined, {
                timeoutMs: 15_000
              }),
              callRuntimeRpc<{ settings: Partial<GlobalSettings> }>(
                target,
                'settings.get',
                undefined,
                { timeoutMs: 15_000 }
              )
            ])
          : [null, null]
        if (generation !== requestGeneration || owner() !== environmentId) {
          return
        }
        const ui = remoteUI ? pick(remoteUI.ui, SHARED_UI_FIELDS) : {}
        const settings = remoteSettings
          ? pick(remoteSettings.settings, SHARED_SETTINGS_FIELDS)
          : pick(localSettings, SHARED_SETTINGS_FIELDS)
        const initialRead = !get().workspaceViewSync.ready
        set((state) => {
          const baseline = state.persistedUIWriteBaseline
          const nextBaseline = baseline ? { ...baseline } : null
          if (initialRead && nextBaseline) {
            for (const field of PERSISTED_UI_WRITE_BASELINE_FIELDS) {
              const wireField =
                field === 'showSleepingWorkspaces' ? 'hideSleepingWorkspaces' : field
              if (SHARED_UI_FIELD_SET.has(wireField)) {
                Object.assign(nextBaseline, { [field]: state[field] })
              }
            }
          }
          return {
            workspaceViewSync: { ...state.workspaceViewSync, ready: true, ui, settings },
            settings: state.settings
              ? { ...state.settings, ...pick(localSettings, SHARED_SETTINGS_FIELDS), ...settings }
              : state.settings,
            ...(initialRead ? { persistedUIWriteBaseline: nextBaseline } : {})
          }
        })
        get().hydratePersistedUI({ ...localUI, ...ui }, 'sync')
      } catch (error) {
        console.warn('Failed to synchronize workspace view:', error)
      }
    },
    persistWorkspaceViewUI: (updates) => {
      const environmentId = owner()
      const sync = get().workspaceViewSync
      const shared = pick(updates, SHARED_UI_FIELDS)
      if (!environmentId || Object.keys(shared).length === 0) {
        return (window.api.ui.setWithAck ?? window.api.ui.set)(updates)
      }
      if (sync.owner !== environmentId || !sync.ready) {
        return Promise.reject(new Error('Workspace view is still connecting.'))
      }
      return (async () => {
        // Older servers may omit an option; keep that option local rather than sending an unknown key.
        const remote = pick(
          shared,
          SHARED_UI_FIELDS.filter((key) => key in sync.ui)
        )
        const local = omit(updates, Object.keys(remote))
        ++requestGeneration
        await Promise.all([
          Object.keys(local).length
            ? (window.api.ui.setWithAck ?? window.api.ui.set)(local)
            : Promise.resolve(),
          Object.keys(remote).length
            ? callRuntimeRpc({ kind: 'environment', environmentId }, 'ui.set', remote, {
                timeoutMs: 15_000
              })
            : Promise.resolve()
        ])
        if (owner() === environmentId && get().workspaceViewSync.epoch === sync.epoch) {
          await get().refreshWorkspaceView(environmentId)
        }
      })()
    },
    persistWorkspaceViewSettings: async (updates) => {
      const environmentId = owner()
      const sync = get().workspaceViewSync
      if (!environmentId) {
        return window.api.settings.set(updates)
      }
      if (!SHARED_SETTINGS_FIELDS.some((key) => key in updates)) {
        const local = await window.api.settings.set(updates)
        return { ...local, ...(sync.owner === environmentId ? sync.settings : {}) }
      }
      if (sync.owner !== environmentId || !sync.ready) {
        throw new Error('Workspace view is still connecting.')
      }
      const remote = pick(
        updates,
        SHARED_SETTINGS_FIELDS.filter((key) => key in sync.settings)
      )
      const local = omit(updates, Object.keys(remote))
      ++requestGeneration
      const [localResult, remoteResult] = await Promise.all([
        Object.keys(local).length ? window.api.settings.set(local) : window.api.settings.get(),
        Object.keys(remote).length
          ? callRuntimeRpc<{ settings: Partial<GlobalSettings> }>(
              { kind: 'environment', environmentId },
              'settings.update',
              remote,
              { timeoutMs: 15_000 }
            )
          : Promise.resolve(null)
      ])
      const shared = remoteResult
        ? pick(remoteResult.settings, SHARED_SETTINGS_FIELDS)
        : sync.settings
      if (owner() === environmentId && get().workspaceViewSync.epoch === sync.epoch) {
        set((state) => ({ workspaceViewSync: { ...state.workspaceViewSync, settings: shared } }))
      }
      return { ...localResult, ...shared }
    }
  }
}
