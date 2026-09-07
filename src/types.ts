export type ExecutionMode = 'sequential' | 'parallel'
export type CompletionMode = 'all_required' | 'any_success'
export type DelegationMode = 'inline' | 'subagent' | 'auto'
export type OnBlocked = 'ask_user' | 'stop'
export type InvocationMode = 'compose' | 'user_explicit' | 'host_permitted'
export type OnExistsMode = 'fail' | 'overwrite' | 'version'
export type SkillRole = 'primary' | 'supporting' | 'review' | 'fallback'

export interface SkillBinding {
  name: string
  role: SkillRole
  required?: boolean
  invocation?: InvocationMode
  model?: string
  reasoning_effort?: string
  artifact?: string
  output_file?: string
  on_exists?: OnExistsMode
}

export interface WorkflowStep {
  id: string
  execution: ExecutionMode
  completion: CompletionMode
  delegation: DelegationMode
  inputs: string[]
  outputs: string[]
  on_success: string
  on_blocked: OnBlocked
  skills: SkillBinding[]
}

export interface WorkflowRecipe {
  id: string
  artifact_root: string
  default_delegation: DelegationMode
  default_on_blocked: OnBlocked
  default_invocation: InvocationMode
  model: string
  reasoning_effort: string
  steps: WorkflowStep[]
}
