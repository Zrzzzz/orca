import type { WorkspacePort } from '../../../shared/workspace-ports'
import { browserUrlForPort } from './workspace-port-urls'

export async function openForwardedWorkspacePort(
  port: WorkspacePort,
  environmentId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const forward = window.api.workspacePorts.forward
    if (!forward) {
      return { ok: false, reason: 'Port forwarding requires the Orca desktop app.' }
    }
    if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(port.connectHost)) {
      return { ok: false, reason: 'Only loopback ports can be forwarded from Orca Server.' }
    }
    const forwarded = await forward({
      environmentId,
      host: port.connectHost === '::1' ? '::1' : '127.0.0.1',
      port: port.port
    })
    const protocol = new URL(browserUrlForPort(port)).protocol
    await window.api.shell.openUrl(`${protocol}//127.0.0.1:${forwarded.localPort}`)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Failed to forward port.' }
  }
}
