export type DelegationMode = 'inline' | 'subagent' | 'auto'
export type SkillRole = 'primary' | 'supporting' | 'review'

export interface SkillBinding {
  name: string
  role: SkillRole
}

/** Raw YAML shape. Optional properties stay absent until a person overrides a default. */
export interface WorkflowStep {
  id: string
  prompt?: string
  model?: string
  reasoning_effort?: string
  delegation?: DelegationMode
  inputs: string[]
  skills: SkillBinding[]
}

export interface WorkflowRecipe {
  id: string
  default_delegation?: DelegationMode
  model?: string
  reasoning_effort?: string
  steps: WorkflowStep[]
}
