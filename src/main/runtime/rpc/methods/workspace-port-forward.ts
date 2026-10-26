import { connect } from 'node:net'
import { BrowserNetworkTunnelSession } from '../../../browser/browser-network-tunnel-session'
import { BrowserNetworkTunnelOutboundMemoryBudgetRegistry } from '../../../browser/browser-network-tunnel-outbound-memory-budget'
import { WorkspacePortForwardParams } from '../../../../shared/rpc-contract/workspace-ports-params'
import { WORKSPACE_PORT_FORWARD_RUNTIME_CAPABILITY } from '../../../../shared/workspace-ports-runtime-capabilities'
import { defineStreamingMethod } from '../core'

const memoryBudgets = new BrowserNetworkTunnelOutboundMemoryBudgetRegistry()

export const WORKSPACE_PORT_FORWARD_METHODS = [
  defineStreamingMethod({
    name: 'workspacePorts.forward',
    permission: 'host-admin',
    params: WorkspacePortForwardParams,
    handler: async (params, context, emit) => {
      const {
        runtime,
        connectionId,
        pairedDeviceId,
        clientKind,
        clientCapabilities,
        sendBinary,
        registerBinaryMessageHandler,
        signal
      } = context
      if (
        clientKind !== 'runtime' ||
        !connectionId ||
        !pairedDeviceId ||
        !sendBinary ||
        !registerBinaryMessageHandler ||
        !clientCapabilities?.includes(WORKSPACE_PORT_FORWARD_RUNTIME_CAPABILITY)
      ) {
        throw new Error('authenticated_port_forward_required')
      }
      if (signal?.aborted) {
        return
      }
      const memory = memoryBudgets.acquire(pairedDeviceId)
      if (!memory) {
        throw new Error('port_forward_limit_exceeded')
      }
      let resolveClosed = (): void => {}
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve
      })
      // Each subscription has its own authenticated binary channel.
      const tunnelGeneration = 1
      const session = new BrowserNetworkTunnelSession({
        tunnelGeneration,
        connect: (target) => {
          if (target.host !== params.host || target.port !== params.port) {
            throw new Error('port_forward_target_mismatch')
          }
          return connect({ host: params.host, port: params.port, allowHalfOpen: true })
        },
        sendBinary: (bytes) => sendBinary(bytes) !== false,
        claimAggregateRetainedBytes: memory.claimApplicationBytes,
        onClose: resolveClosed
      })
      let unregister = (): void => {}
      let cleaned = false
      const cleanup = (): void => {
        if (cleaned) {
          return
        }
        cleaned = true
        unregister()
        session.close()
        memory.release()
      }
      try {
        unregister = registerBinaryMessageHandler((bytes) => session.handleBinary(bytes))
        runtime.registerSubscriptionCleanup(`port-forward:${connectionId}`, cleanup, connectionId)
        signal?.addEventListener('abort', cleanup, { once: true })
        if (signal?.aborted) {
          return
        }
        emit({ type: 'ready', tunnelGeneration })
        await closed
      } finally {
        signal?.removeEventListener('abort', cleanup)
        cleanup()
      }
    }
  })
]
