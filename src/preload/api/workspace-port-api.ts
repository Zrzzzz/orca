import type {
  LocalhostWorktreeLabelResult,
  LocalhostWorktreeLabelRoute
} from '../../shared/localhost-worktree-labels'
import type {
  WorkspacePortAdvertisedUrlChangedEvent,
  WorkspacePortKillRequest,
  WorkspacePortKillResult,
  WorkspacePortPageProbeRequest,
  WorkspacePortPageProbeResult,
  WorkspacePortScanRequest,
  WorkspacePortScanResult
} from '../../shared/workspace-ports'

export type WorkspacePortsApi = {
  /** Desktop-only: browser clients cannot bind a local TCP listener. */
  forward?: (args: {
    environmentId: string
    host: '127.0.0.1' | '::1'
    port: number
  }) => Promise<{ localPort: number }>
  scan: (args: WorkspacePortScanRequest) => Promise<WorkspacePortScanResult>
  kill: (args: WorkspacePortKillRequest) => Promise<WorkspacePortKillResult>
  probePage: (args: WorkspacePortPageProbeRequest) => Promise<WorkspacePortPageProbeResult>
  onAdvertisedUrlChanged: (
    callback: (event: WorkspacePortAdvertisedUrlChangedEvent) => void
  ) => () => void
}

export type LocalhostWorktreeLabelsApi = {
  register: (args: LocalhostWorktreeLabelRoute) => Promise<LocalhostWorktreeLabelResult>
}
