import { z } from 'zod'
import { OptionalString, requiredNumber, requiredString } from './rpc-param-primitives'

export const WorkspacePortForwardParams = z.object({
  host: z.enum(['127.0.0.1', '::1']),
  port: z.number().int().min(1).max(65535)
})

export const WorkspacePortForwardRequest = WorkspacePortForwardParams.extend({
  environmentId: z.string().min(1)
})

export const WorkspacePortScanParams = z.object({
  repoId: OptionalString
})

export const WorkspacePortKillParams = z.object({
  repoId: OptionalString,
  pid: requiredNumber('Missing process id'),
  port: requiredNumber('Missing port')
})

export const WorkspacePortProbePageParams = z.object({
  host: requiredString('Missing host'),
  port: requiredNumber('Missing port'),
  protocol: z.enum(['http', 'https'])
})

export const WorkspacePortScanHostParams = z.object({
  worktree: requiredString('Missing worktree selector')
})

export const WorkspacePortKillHostParams = z.object({
  worktree: requiredString('Missing worktree selector'),
  executionHostId: requiredString('Missing execution host'),
  pid: requiredNumber('Missing process id'),
  port: requiredNumber('Missing port')
})
