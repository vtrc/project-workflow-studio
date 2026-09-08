export type ExecutionMode = 'sequential' | 'parallel'
export type CompletionMode = 'all_required' | 'any_success'
export type DelegationMode = 'inline' | 'subagent' | 'auto'
export type OnBlocked = 'ask_user' | 'stop'
export type InvocationMode = 'compose' | 'user_explicit' | 'host_permitted'
export type SkillRole = 'primary' | 'supporting' | 'review'

export interface SkillBinding {
  name: string
  role: SkillRole
  required?: boolean
  invocation?: InvocationMode
  model?: string
  reasoning_effort?: string
}

/** Raw YAML shape. Optional properties stay absent until a person overrides a default. */
export interface WorkflowStep {
  id: string
  prompt?: string
  execution?: ExecutionMode
  completion?: CompletionMode
  model?: string
  reasoning_effort?: string
  delegation?: DelegationMode
  inputs?: string[]
  on_success: string
  on_blocked?: OnBlocked
  skills: SkillBinding[]
}

export interface WorkflowRecipe {
  id: string
  default_delegation?: DelegationMode
  default_on_blocked?: OnBlocked
  default_invocation?: InvocationMode
  model?: string
  reasoning_effort?: string
  steps: WorkflowStep[]
}
