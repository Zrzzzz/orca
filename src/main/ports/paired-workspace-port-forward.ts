import { createServer, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { PairedRuntimeConnection } from '../../shared/paired-runtime-connection'
import {
  subscribeRemoteRuntimeRequest,
  type RemoteRuntimeSubscription
} from '../../shared/remote-runtime-client'
import { BrowserNetworkTunnelEvent } from '../../shared/browser-client-host-protocol'
import { WORKSPACE_PORT_FORWARD_RUNTIME_CAPABILITY } from '../../shared/workspace-ports-runtime-capabilities'
import { BrowserNetworkTunnelClient } from '../browser/browser-network-tunnel-client'
import { BrowserNetworkTunnelOutboundMemoryBudgetRegistry } from '../browser/browser-network-tunnel-outbound-memory-budget'
import { pipeUpstreamToClient } from '../browser/remote-browser-socks-upstream'

const memoryBudgets = new BrowserNetworkTunnelOutboundMemoryBudgetRegistry()

export type PairedWorkspacePortForward = {
  localPort: number
  close: () => Promise<void>
}

export async function startPairedWorkspacePortForward(options: {
  connection: PairedRuntimeConnection
  host: '127.0.0.1' | '::1'
  port: number
  signal?: AbortSignal
  onClose?: () => void
}): Promise<PairedWorkspacePortForward> {
  const memory = memoryBudgets.acquire(options.connection.hostPublicKeyB64)
  if (!memory) {
    throw new Error('Too many active port forwards.')
  }
  const sockets = new Set<Socket>()
  let tunnel: BrowserNetworkTunnelClient | null = null
  let subscription: RemoteRuntimeSubscription | null = null
  let closed = false
  let resolveReady = (): void => {}
  let rejectReady = (_error: Error): void => {}
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  void ready.catch(() => {})
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket)
    socket.pause()
    socket.on('error', () => socket.destroy())
    socket.once('close', () => sockets.delete(socket))
    void connectSocket(socket)
  })
  server.maxConnections = 128
  const close = async (): Promise<void> => {
    if (closed) {
      return
    }
    closed = true
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    rejectReady(new Error('Port forward disconnected. Open the port again to reconnect.'))
    for (const socket of sockets) {
      socket.destroy()
    }
    tunnel?.close(new Error('Port forward closed'))
    subscription?.close()
    memory.release()
    options.onClose?.()
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  const fail = (error: Error): void => {
    rejectReady(error)
    void close()
  }
  const abort = (): void => fail(new Error('Port forward cancelled'))
  const timer = setTimeout(() => fail(new Error('Timed out opening port forward')), 15_000)
  server.on('error', fail)

  async function connectSocket(socket: Socket): Promise<void> {
    let upstream: Duplex | undefined
    try {
      if (closed || !tunnel) {
        throw new Error('Port forward unavailable')
      }
      upstream = await tunnel.open({ host: options.host, port: options.port })
      if (closed || socket.destroyed) {
        upstream.destroy()
        return
      }
      const stream = upstream
      socket.once('close', () => stream.destroy())
      stream.once('error', () => socket.destroy())
      stream.once('close', () => socket.destroy())
      pipeUpstreamToClient(stream, socket)
      socket.pipe(stream)
      socket.resume()
    } catch {
      upstream?.destroy()
      socket.destroy()
    }
  }

  try {
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) {
      throw new Error('Port forward cancelled')
    }
    const connected = await subscribeRemoteRuntimeRequest(
      options.connection,
      'workspacePorts.forward',
      { host: options.host, port: options.port },
      15_000,
      {
        onResponse: (response) => {
          if (closed) {
            return
          }
          if (!response.ok) {
            fail(
              new Error(
                response.error.code === 'method_not_found'
                  ? 'Update Orca Server to use port forwarding.'
                  : response.error.message
              )
            )
            return
          }
          const parsed = BrowserNetworkTunnelEvent.safeParse(response.result)
          if (!parsed.success || parsed.data.type !== 'ready' || tunnel) {
            fail(new Error('Invalid port forward response'))
            return
          }
          tunnel = new BrowserNetworkTunnelClient({
            tunnelGeneration: parsed.data.tunnelGeneration,
            sendBinary: (bytes) => subscription?.sendBinary(bytes) ?? false,
            outboundMemory: memory,
            onClosed: fail
          })
          resolveReady()
        },
        onBinary: (bytes) => tunnel?.handleBinary(bytes),
        onError: fail,
        onClose: () => fail(new Error('Port forward disconnected'))
      },
      {
        signal: options.signal,
        clientCapabilities: [WORKSPACE_PORT_FORWARD_RUNTIME_CAPABILITY],
        perMessageDeflate: false,
        outboundMemoryBudget: memory,
        outboundQueue: {
          softCapBytes: 1024 * 1024,
          maxQueuedBytes: 7 * 1024 * 1024,
          maxQueuedFrames: 2048,
          maxDrainFramesPerTurn: 4
        }
      }
    )
    subscription = connected
    if (closed) {
      connected.close()
      throw new Error('Port forward closed during startup')
    }
    await ready
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (closed || !address || typeof address === 'string') {
      server.close()
      throw new Error('Port forward closed during startup')
    }
    clearTimeout(timer)
    return { localPort: address.port, close }
  } catch (error) {
    await close()
    throw error
  }
}
