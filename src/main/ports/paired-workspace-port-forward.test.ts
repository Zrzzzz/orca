import '../runtime/rpc/unused-default-rpc-methods.test-fixture'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { WORKSPACE_PORT_FORWARD_METHODS } from '../runtime/rpc/methods/workspace-port-forward'
import { parsePairingCode } from '../../shared/pairing'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { sendRemoteRuntimeRequest } from '../../shared/remote-runtime-client'
import { WORKSPACE_PORT_FORWARD_RUNTIME_CAPABILITY } from '../../shared/workspace-ports-runtime-capabilities'
import { startPairedWorkspacePortForward } from './paired-workspace-port-forward'
import {
  ensureWorkspacePortForward,
  closeWorkspacePortForwardsForOwner,
  closeWorkspacePortForwardsForEnvironment
} from './workspace-port-forward-registry'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup()
  }
})

async function pairedServer(methods = WORKSPACE_PORT_FORWARD_METHODS) {
  const userDataPath = await mkdtemp(join(tmpdir(), 'orca-port-forward-'))
  cleanups.push(() => rm(userDataPath, { recursive: true, force: true }))
  const runtime = new OrcaRuntimeService()
  const rpc = new OrcaRuntimeRpcServer({
    runtime,
    userDataPath,
    enableWebSocket: true,
    wsPort: 0,
    methods
  })
  await rpc.start()
  cleanups.push(() => rpc.stop())
  const offer = rpc.createPairingOffer({ name: 'port-forward-test', scope: 'runtime' })
  if (!offer.available) {
    throw new Error('Pairing unavailable')
  }
  const pairing = parsePairingCode(offer.pairingUrl)
  if (!pairing) {
    throw new Error('Invalid pairing')
  }
  return { connection: pairedRuntimeConnectionFromOffer(pairing), rpc }
}

describe('paired workspace port forwarding', () => {
  it.each(['cancel', 'server-stop'] as const)(
    'serves HTTP and WebSocket and closes on %s',
    async (ending) => {
      const payload = 'x'.repeat(2 * 1024 * 1024)
      const http = createServer((_request, response) => response.end(payload))
      const ws = new WebSocketServer({ server: http })
      ws.on('connection', (socket) => socket.on('message', (data) => socket.send(data)))
      http.listen(0, '127.0.0.1')
      await once(http, 'listening')
      cleanups.push(async () => {
        for (const socket of ws.clients) {
          socket.terminate()
        }
        ws.close()
        http.closeAllConnections()
        await new Promise<void>((resolve) => http.close(() => resolve()))
      })
      const address = http.address()
      if (!address || typeof address === 'string') {
        throw new Error('No server address')
      }
      const { connection, rpc } = await pairedServer()
      const abort = new AbortController()
      const forward = await startPairedWorkspacePortForward({
        connection,
        host: '127.0.0.1',
        port: address.port,
        signal: abort.signal
      })
      cleanups.push(forward.close)
      const response = await fetch(`http://127.0.0.1:${forward.localPort}`)
      expect(await response.text()).toBe(payload)
      const socket = new WebSocket(`ws://127.0.0.1:${forward.localPort}`)
      cleanups.push(() => socket.terminate())
      await once(socket, 'open')
      const echoed = once(socket, 'message')
      socket.send('hot reload')
      expect(String((await echoed)[0])).toBe('hot reload')
      const disconnected = once(socket, 'close')
      if (ending === 'cancel') {
        abort.abort()
      } else {
        await rpc.stop()
      }
      await disconnected
      await expect(fetch(`http://127.0.0.1:${forward.localPort}`)).rejects.toThrow()
    }
  )

  it('rejects non-loopback destinations and missing client capability', async () => {
    const { connection } = await pairedServer()
    const nonLoopback = await sendRemoteRuntimeRequest(
      connection,
      'workspacePorts.forward',
      { host: '192.0.2.1', port: 8080 },
      5000,
      undefined,
      undefined,
      [WORKSPACE_PORT_FORWARD_RUNTIME_CAPABILITY]
    )
    expect(nonLoopback.ok).toBe(false)
    const noCapability = await sendRemoteRuntimeRequest(
      connection,
      'workspacePorts.forward',
      { host: '127.0.0.1', port: 8080 },
      5000
    )
    expect(noCapability).toMatchObject({
      ok: false,
      error: { message: 'authenticated_port_forward_required' }
    })
  })

  it('reuses concurrent opens and retires forwards on window or environment removal', async () => {
    const http = createServer((_request, response) => response.end('alive'))
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    cleanups.push(async () => {
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    })
    const address = http.address()
    if (!address || typeof address === 'string') {
      throw new Error('No HTTP address')
    }
    const { connection } = await pairedServer()
    const args = {
      connection,
      ownerId: 123,
      environmentId: 'paired',
      host: '127.0.0.1' as const,
      port: address.port
    }
    cleanups.push(() => closeWorkspacePortForwardsForEnvironment(args.environmentId))
    const [a, b] = await Promise.all([
      ensureWorkspacePortForward(args),
      ensureWorkspacePortForward(args)
    ])
    expect(a).toBe(b)
    expect(await (await fetch(`http://127.0.0.1:${a}`)).text()).toBe('alive')
    closeWorkspacePortForwardsForOwner(args.ownerId)
    await expect(fetch(`http://127.0.0.1:${a}`)).rejects.toThrow()
    const reopened = await ensureWorkspacePortForward(args)
    expect(await (await fetch(`http://127.0.0.1:${reopened}`)).text()).toBe('alive')
    closeWorkspacePortForwardsForEnvironment(args.environmentId)
    await expect(fetch(`http://127.0.0.1:${reopened}`)).rejects.toThrow()
  })

  it('reports an upgrade requirement for an older server without forwarding', async () => {
    const { connection } = await pairedServer([])
    await expect(
      startPairedWorkspacePortForward({ connection, host: '127.0.0.1', port: 8080 })
    ).rejects.toThrow('Update Orca Server')
  })
})
