import {
  requestDesktopBrowserBridgeReconcile,
  resetDesktopBrowserBridgeEnvironment
} from '../desktop-browser-bridge-reconcile'
import { closeWorkspacePortForwardsForEnvironment } from '../../ports/workspace-port-forward-registry'

const manuallyDisconnectedEnvironmentIds = new Set<string>()

export const RUNTIME_MANUALLY_DISCONNECTED_MESSAGE = 'Runtime environment is manually disconnected.'

export function markRuntimeEnvironmentManuallyDisconnected(environmentId: string): void {
  closeWorkspacePortForwardsForEnvironment(environmentId)
  manuallyDisconnectedEnvironmentIds.add(environmentId)
  // Disconnect must revoke the server's desktop browser access immediately.
  resetDesktopBrowserBridgeEnvironment(environmentId)
}

export function clearRuntimeEnvironmentManualDisconnect(environmentId: string): void {
  manuallyDisconnectedEnvironmentIds.delete(environmentId)
  requestDesktopBrowserBridgeReconcile()
}

export function isRuntimeEnvironmentManuallyDisconnected(environmentId: string): boolean {
  return manuallyDisconnectedEnvironmentIds.has(environmentId)
}
