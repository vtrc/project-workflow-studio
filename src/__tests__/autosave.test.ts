import { describe, expect, it } from 'vitest'
import { isCurrentAutosaveSource, shouldScheduleAutosave } from '../autosave'

describe('autosave guard', () => {
  it('never schedules before a workflow has loaded from a writable handle', () => {
    expect(shouldScheduleAutosave({ hasWritableSource: true, hasLoadedWorkflow: false, changeRevision: 1, savedRevision: 0 })).toBe(false)
    expect(shouldScheduleAutosave({ hasWritableSource: false, hasLoadedWorkflow: true, changeRevision: 1, savedRevision: 0 })).toBe(false)
  })

  it('schedules only newer user changes', () => {
    expect(shouldScheduleAutosave({ hasWritableSource: true, hasLoadedWorkflow: true, changeRevision: 1, savedRevision: 0 })).toBe(true)
    expect(shouldScheduleAutosave({ hasWritableSource: true, hasLoadedWorkflow: true, changeRevision: 1, savedRevision: 1 })).toBe(false)
  })
})


describe('autosave source generation', () => {
  it('rejects an in-flight source completion after the user opens another source', () => {
    const sourceA = 4
    const sourceB = 5
    expect(isCurrentAutosaveSource(sourceA, sourceA)).toBe(true)
    expect(isCurrentAutosaveSource(sourceA, sourceB)).toBe(false)
  })
})
