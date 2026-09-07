import { describe, expect, it } from 'vitest'
import { isWorkflowDirectoryName, SKILL_CATALOG_FILE_NAME, WORKFLOW_FILE_NAME } from '../workflowFolder'

describe('canonical workflow folder', () => {
  it('accepts only the .workflow directory handle', () => {
    expect(isWorkflowDirectoryName('.workflow')).toBe(true)
    expect(isWorkflowDirectoryName('project')).toBe(false)
    expect(isWorkflowDirectoryName('.workflow/')).toBe(false)
  })

  it('loads workflow and catalog from the same selected directory', () => {
    expect(WORKFLOW_FILE_NAME).toBe('workflow.yaml')
    expect(SKILL_CATALOG_FILE_NAME).toBe('skill-catalog.json')
  })
})
