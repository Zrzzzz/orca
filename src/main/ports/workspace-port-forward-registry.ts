import type { PairedRuntimeConnection } from '../../shared/paired-runtime-connection'
import {
  startPairedWorkspacePortForward,
  type PairedWorkspacePortForward
} from './paired-workspace-port-forward'

type ForwardEntry = {
  environmentId: string
  ownerId: number
  abort: AbortController
  ready: Promise<PairedWorkspacePortForward>
}

const forwards = new Map<string, ForwardEntry>()

export async function ensureWorkspacePortForward(args: {
  environmentId: string
  ownerId: number
  connection: PairedRuntimeConnection
  host: '127.0.0.1' | '::1'
  port: number
}): Promise<number> {
  const key = JSON.stringify([
    args.ownerId,
    args.environmentId,
    args.connection.endpoint,
    args.connection.hostPublicKeyB64,
    args.connection.credential.deviceToken,
    args.host,
    args.port
  ])
  let entry = forwards.get(key)
  if (!entry) {
    const abort = new AbortController()
    const remove = (): void => {
      if (forwards.get(key)?.abort === abort) {
        forwards.delete(key)
      }
    }
    entry = {
      environmentId: args.environmentId,
      ownerId: args.ownerId,
      abort,
      ready: startPairedWorkspacePortForward({
        ...args,
        signal: abort.signal,
        onClose: remove
      }).catch((error: unknown) => {
        remove()
        throw error
      })
    }
    forwards.set(key, entry)
  }
  return (await entry.ready).localPort
}

export function closeWorkspacePortForwardsForEnvironment(environmentId: string): void {
  for (const entry of forwards.values()) {
    if (entry.environmentId === environmentId) {
      entry.abort.abort()
    }
  }
}

export function closeWorkspacePortForwardsForOwner(ownerId: number): void {
  for (const entry of forwards.values()) {
    if (entry.ownerId === ownerId) {
      entry.abort.abort()
    }
  }
}
