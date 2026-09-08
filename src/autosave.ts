export const AUTOSAVE_DELAY_MS = 650

export type AutosaveGuard = {
  hasWritableSource: boolean
  hasLoadedWorkflow: boolean
  changeRevision: number
  savedRevision: number
}

/** Prevents persistence until a user-selected source has loaded, and skips saved revisions. */
export function shouldScheduleAutosave({ hasWritableSource, hasLoadedWorkflow, changeRevision, savedRevision }: AutosaveGuard): boolean {
  return hasWritableSource && hasLoadedWorkflow && changeRevision > savedRevision
}

/** A completion may update UI state only for the source generation that started it. */
export function isCurrentAutosaveSource(taskGeneration: number, activeGeneration: number): boolean {
  return taskGeneration === activeGeneration
}
