export type WorkflowOpenAction = 'folder' | 'file'

type PickerSupport = {
  directoryPicker: boolean
  filePicker: boolean
}

export type WorkflowOpenPlan = {
  picker: 'directory' | 'file-picker' | 'file-input'
  persistentHistory: boolean
  loadsCatalog: boolean
}

export function planWorkflowOpen(action: WorkflowOpenAction, support: PickerSupport): WorkflowOpenPlan {
  if (action === 'folder' && support.directoryPicker) {
    return { picker: 'directory', persistentHistory: true, loadsCatalog: true }
  }
  return {
    picker: support.filePicker ? 'file-picker' : 'file-input',
    persistentHistory: false,
    loadsCatalog: false,
  }
}
