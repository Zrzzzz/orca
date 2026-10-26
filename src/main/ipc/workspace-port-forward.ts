import { app, ipcMain } from 'electron'
import { WorkspacePortForwardRequest } from '../../shared/rpc-contract/workspace-ports-params'
import { getPreferredPairedRuntimeConnection } from '../../shared/runtime-environments'
import { resolveManagedRuntimeEnvironment } from './runtime-environments/runtime-environment-managed-tunnel'
import { isRuntimeEnvironmentManuallyDisconnected } from './runtime-environments/runtime-environment-manual-disconnect'
import {
  ensureWorkspacePortForward,
  closeWorkspacePortForwardsForOwner
} from '../ports/workspace-port-forward-registry'

export function registerWorkspacePortForwardHandler(): void {
  const owners = new Set<number>()
  ipcMain.removeHandler('workspacePorts:forward')
  ipcMain.handle('workspacePorts:forward', async (event, rawArgs: unknown) => {
    const args = WorkspacePortForwardRequest.parse(rawArgs)
    if (isRuntimeEnvironmentManuallyDisconnected(args.environmentId)) {
      throw new Error('Connect to Orca Server before opening this port.')
    }
    const environment = await resolveManagedRuntimeEnvironment(
      app.getPath('userData'),
      args.environmentId
    )
    if (event.sender.isDestroyed() || isRuntimeEnvironmentManuallyDisconnected(environment.id)) {
      throw new Error('Port forward cancelled')
    }
    const ownerId = event.sender.id
    if (!owners.has(ownerId)) {
      owners.add(ownerId)
      event.sender.once('destroyed', () => {
        owners.delete(ownerId)
        closeWorkspacePortForwardsForOwner(ownerId)
      })
    }
    const localPort = await ensureWorkspacePortForward({
      ...args,
      environmentId: environment.id,
      ownerId,
      connection: getPreferredPairedRuntimeConnection(environment)
    })
    return { localPort }
  })
}
