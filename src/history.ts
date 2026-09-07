import type { WorkflowRecipe } from './types'

export type DiagramPosition = { x: number; y: number }

export type WorkflowSnapshot = {
  schemaVersion: 1
  workflow: WorkflowRecipe
  positions: Record<string, DiagramPosition>
}

export type HistoryEntry = {
  id: string
  timestamp: string
  label: string
  snapshot: WorkflowSnapshot
}

export type WorkflowHistory = {
  schemaVersion: 1
  workflowPath: string
  cursor: number
  entries: HistoryEntry[]
}

export type HistoryManifest = Omit<HistoryEntry, 'snapshot'> & {
  snapshotFile: string
}

export type PersistedHistoryManifest = {
  schemaVersion: 1
  workflowPath: string
  cursor: number
  entries: HistoryManifest[]
}

export const HISTORY_SCHEMA_VERSION = 1 as const
export const HISTORY_MAX_ENTRIES = 30
export const HISTORY_MAX_BYTES = 2_000_000

export function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as WorkflowSnapshot
}

export function newHistory(
  workflowPath: string,
  snapshot: WorkflowSnapshot,
  label: string,
): WorkflowHistory {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    workflowPath,
    cursor: 0,
    entries: [newHistoryEntry(snapshot, label)],
  }
}

export function newHistoryEntry(snapshot: WorkflowSnapshot, label: string): HistoryEntry {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id: `snapshot-${randomPart}`,
    timestamp: new Date().toISOString(),
    label,
    snapshot: cloneSnapshot(snapshot),
  }
}

export function trimHistory(history: WorkflowHistory): WorkflowHistory {
  let entries = history.entries
  let cursor = history.cursor
  while (
    entries.length > HISTORY_MAX_ENTRIES ||
    entries.reduce((total, entry) => total + JSON.stringify(entry.snapshot).length, 0) > HISTORY_MAX_BYTES
  ) {
    if (entries.length <= 1) break
    entries = entries.slice(1)
    cursor = Math.max(0, cursor - 1)
  }
  return { ...history, entries, cursor }
}

export function asPersistedManifest(history: WorkflowHistory): PersistedHistoryManifest {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    workflowPath: history.workflowPath,
    cursor: history.cursor,
    entries: history.entries.map(({ id, timestamp, label }) => ({
      id,
      timestamp,
      label,
      snapshotFile: `snapshots/${id}.json`,
    })),
  }
}
