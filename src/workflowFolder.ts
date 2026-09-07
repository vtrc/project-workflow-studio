export const WORKFLOW_DIRECTORY_NAME = '.workflow'
export const WORKFLOW_FILE_NAME = 'workflow.yaml'
export const SKILL_CATALOG_FILE_NAME = 'skill-catalog.json'

export function isWorkflowDirectoryName(name: string): boolean {
  return name === WORKFLOW_DIRECTORY_NAME
}
