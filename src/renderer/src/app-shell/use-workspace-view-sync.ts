import { useEffect } from 'react'
import { useAppStore } from '../store'
import { runtimeHostConnectionStateForEntry } from '../runtime/hosts/connections/runtime-host-connection-state'

export function useWorkspaceViewSync(): void {
  const owner = useAppStore((state) => state.settings?.activeRuntimeEnvironmentId ?? null)
  const ready = useAppStore((state) => state.persistedUIReady)
  const connection = useAppStore((state) =>
    owner
      ? runtimeHostConnectionStateForEntry(state.runtimeStatusByEnvironmentId?.get(owner))
      : null
  )
  useEffect(() => {
    if (!ready) {
      return
    }
    const refresh = (): void => {
      if (document.visibilityState !== 'hidden') {
        void useAppStore.getState().refreshWorkspaceView(owner)
      }
    }
    void useAppStore.getState().refreshWorkspaceView(owner)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [owner, ready, connection])
}
