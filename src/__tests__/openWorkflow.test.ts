import { describe, expect, it } from 'vitest'
import { planWorkflowOpen } from '../openWorkflow'

describe('workflow opening plans', () => {
  it('uses a project-root folder only for the folder action', () => {
    expect(planWorkflowOpen('folder', { directoryPicker: true, filePicker: true })).toEqual({
      picker: 'directory',
      persistentHistory: true,
      loadsCatalog: true,
    })
  })

  it('uses the file picker for direct YAML even when directory picking exists', () => {
    expect(planWorkflowOpen('file', { directoryPicker: true, filePicker: true })).toEqual({
      picker: 'file-picker',
      persistentHistory: false,
      loadsCatalog: false,
    })
  })

  it('keeps the file-input fallback when File System Access is unavailable', () => {
    expect(planWorkflowOpen('file', { directoryPicker: false, filePicker: false })).toEqual({
      picker: 'file-input',
      persistentHistory: false,
      loadsCatalog: false,
    })
  })
})
