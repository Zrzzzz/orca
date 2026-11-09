import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings, getDefaultUIState } from '../../../../../shared/constants'
import type { PersistedUIState } from '../../../../../shared/persisted-ui-state-types'
import { createUIStore } from './ui-slice-test-harness'
import { callRuntimeRpc } from '../../../runtime/rpc/calls/runtime-rpc-call'

vi.mock('../../../runtime/rpc/calls/runtime-rpc-call', () => ({ callRuntimeRpc: vi.fn() }))

const localUI = getDefaultUIState()
const localSettings = getDefaultSettings('/home/test')
let hostUI: PersistedUIState
const localWrite = vi.fn()
const settingsWrite = vi.fn()

function client(owner: string | null = 'pc2') {
  const store = createUIStore()
  store.setState({ settings: { ...localSettings, activeRuntimeEnvironmentId: owner } })
  store.getState().hydratePersistedUI(localUI, 'startup')
  return store
}

beforeEach(() => {
  vi.clearAllMocks()
  hostUI = { ...getDefaultUIState(), groupBy: 'none', sortBy: 'name', hideSleepingWorkspaces: true }
  localWrite.mockResolvedValue(undefined)
  settingsWrite.mockImplementation(async (updates) => ({ ...localSettings, ...updates }))
  vi.stubGlobal('window', {
    api: {
      ui: { get: async () => localUI, set: localWrite, setWithAck: localWrite },
      settings: { get: async () => localSettings, set: settingsWrite }
    }
  })
  vi.mocked(callRuntimeRpc).mockImplementation(async (_target, method, params) => {
    if (method === 'ui.get') {
      return { ui: { ...hostUI } }
    }
    if (method === 'ui.set') {
      Object.assign(hostUI, params)
      return { ui: { ...hostUI } }
    }
    if (method === 'settings.get') {
      return { settings: { compactWorktreeCards: true } }
    }
    if (method === 'settings.update') {
      return { settings: params }
    }
    throw new Error(`Unexpected RPC: ${method}`)
  })
})

describe('paired desktop workspace view ownership', () => {
  it('reads shared options while retaining local host scope and window geometry', async () => {
    hostUI.sidebarWidth = 800
    hostUI.visibleWorkspaceHostIds = ['local']
    hostUI.hideWorkspacesFromOtherDevices = true
    const store = client()
    await store.getState().refreshWorkspaceView('pc2')
    expect(store.getState()).toMatchObject({
      groupBy: 'none',
      sortBy: 'name',
      showSleepingWorkspaces: false,
      sidebarWidth: localUI.sidebarWidth,
      visibleWorkspaceHostIds: null,
      hideWorkspacesFromOtherDevices: false,
      settings: { compactWorktreeCards: true }
    })
    const projected = store.getState().projectWorkspaceViewUI({ ...localUI, sidebarWidth: 333 })
    store.getState().hydratePersistedUI(projected, 'sync')
    expect(store.getState()).toMatchObject({ groupBy: 'none', sidebarWidth: 333 })
  })

  it('converges two desktops after disjoint edits without writing shared values to local storage', async () => {
    const first = client()
    const second = client()
    await Promise.all([
      first.getState().refreshWorkspaceView('pc2'),
      second.getState().refreshWorkspaceView('pc2')
    ])
    first.getState().setSortBy('recent')
    await first.getState().persistWorkspaceViewUI({ sortBy: 'recent', sidebarWidth: 320 })
    second.getState().setHideDetachedHeadWorkspaces(true)
    await second.getState().persistWorkspaceViewUI({ hideDetachedHeadWorkspaces: true })
    await Promise.all([
      first.getState().refreshWorkspaceView('pc2'),
      second.getState().refreshWorkspaceView('pc2')
    ])
    for (const store of [first, second]) {
      expect(store.getState()).toMatchObject({ sortBy: 'recent', hideDetachedHeadWorkspaces: true })
    }
    expect(localWrite).toHaveBeenCalledWith({ sidebarWidth: 320 })
    expect(
      localWrite.mock.calls.some(
        ([patch]) => 'sortBy' in patch || 'hideDetachedHeadWorkspaces' in patch
      )
    ).toBe(false)
    expect(hostUI).toMatchObject({
      sortBy: 'recent',
      hideDetachedHeadWorkspaces: true,
      sidebarWidth: localUI.sidebarWidth
    })
  })

  it('restores local options on switching back and rejects late reads from a previous owner', async () => {
    const store = client()
    await store.getState().refreshWorkspaceView('pc2')
    const started = Promise.withResolvers<void>()
    let resolveRead: ((value: unknown) => void) | undefined
    vi.mocked(callRuntimeRpc).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
          started.resolve()
        })
    )
    const pending = store.getState().refreshWorkspaceView('pc2')
    await started.promise
    store.setState({ settings: { ...localSettings, activeRuntimeEnvironmentId: null } })
    await store.getState().refreshWorkspaceView(null)
    resolveRead?.({ ui: { ...hostUI, groupBy: 'workspaceStatus' } })
    await pending
    expect(store.getState()).toMatchObject({ groupBy: localUI.groupBy, sortBy: localUI.sortBy })
    expect(store.getState().settings?.compactWorktreeCards).toBe(localSettings.compactWorktreeCards)
  })

  it('keeps options omitted by an older server local and propagates write failure', async () => {
    const store = client()
    vi.mocked(callRuntimeRpc).mockImplementationOnce(async () => ({ ui: { groupBy: 'none' } }))
    await store.getState().refreshWorkspaceView('pc2')
    await store.getState().persistWorkspaceViewUI({ hideDetachedHeadWorkspaces: true })
    expect(localWrite).toHaveBeenCalledWith({ hideDetachedHeadWorkspaces: true })
    vi.mocked(callRuntimeRpc).mockRejectedValueOnce(new Error('Disconnected'))
    await expect(store.getState().persistWorkspaceViewUI({ groupBy: 'repo' })).rejects.toThrow(
      'Disconnected'
    )
    expect(localWrite).not.toHaveBeenCalledWith({ groupBy: 'repo' })
  })

  it('writes card presentation to the owner and leaves unrelated settings on this desktop', async () => {
    const store = client()
    await store.getState().refreshWorkspaceView('pc2')
    const result = await store.getState().persistWorkspaceViewSettings({
      compactWorktreeCards: false,
      theme: 'dark'
    })
    expect(result).toMatchObject({ compactWorktreeCards: false, theme: 'dark' })
    expect(settingsWrite).toHaveBeenCalledExactlyOnceWith({ theme: 'dark' })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'pc2' },
      'settings.update',
      { compactWorktreeCards: false },
      { timeoutMs: 15_000 }
    )
  })
})
