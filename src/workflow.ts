import { parse } from 'yaml'
import type {
  CompletionMode,
  DelegationMode,
  ExecutionMode,
  InvocationMode,
  OnBlocked,
  OnExistsMode,
  SkillBinding,
  SkillRole,
  WorkflowRecipe,
  WorkflowStep,
} from './types'

const executionModes: ExecutionMode[] = ['sequential', 'parallel']
const completionModes: CompletionMode[] = ['all_required', 'any_success']
const delegationModes: DelegationMode[] = ['inline', 'subagent', 'auto']
const onBlockedModes: OnBlocked[] = ['ask_user', 'stop']
const invocationModes: InvocationMode[] = ['compose', 'user_explicit', 'host_permitted']
const onExistsModes: OnExistsMode[] = ['fail', 'overwrite', 'version']
const skillRoles: SkillRole[] = ['primary', 'supporting', 'review', 'fallback']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function parseSkill(value: unknown): SkillBinding {
  const source = isRecord(value) ? value : {}
  return {
    name: asString(source.name, 'unnamed-skill'),
    role: asEnum(source.role, skillRoles, 'primary'),
    required: typeof source.required === 'boolean' ? source.required : true,
    invocation: asEnum(source.invocation, invocationModes, 'compose'),
    model: typeof source.model === 'string' ? source.model : undefined,
    reasoning_effort:
      typeof source.reasoning_effort === 'string' ? source.reasoning_effort : undefined,
    artifact: typeof source.artifact === 'string' ? source.artifact : undefined,
    output_file: typeof source.output_file === 'string' ? source.output_file : undefined,
    on_exists: asEnum(source.on_exists, onExistsModes, 'fail'),
  }
}

function parseStep(value: unknown, index: number): WorkflowStep {
  const source = isRecord(value) ? value : {}
  return {
    id: asString(source.id, `step-${index + 1}`),
    execution: asEnum(source.execution, executionModes, 'sequential'),
    completion: asEnum(source.completion, completionModes, 'all_required'),
    delegation: asEnum(source.delegation, delegationModes, 'inline'),
    inputs: asStrings(source.inputs),
    outputs: asStrings(source.outputs),
    on_success: asString(source.on_success, 'complete'),
    on_blocked: asEnum(source.on_blocked, onBlockedModes, 'ask_user'),
    skills: Array.isArray(source.skills) ? source.skills.map(parseSkill) : [],
  }
}

export const defaultWorkflow: WorkflowRecipe = {
  id: 'registration-flow',
  artifact_root: '.workflow/artifacts',
  default_delegation: 'inline',
  default_on_blocked: 'ask_user',
  default_invocation: 'compose',
  model: 'host_default',
  reasoning_effort: 'host_default',
  steps: [
    {
      id: 'clarify-request',
      execution: 'sequential',
      completion: 'all_required',
      delegation: 'inline',
      inputs: ['user-request'],
      outputs: ['clarification'],
      on_success: 'make-plan',
      on_blocked: 'ask_user',
      skills: [
        {
          name: 'grilling',
          role: 'primary',
          required: true,
          invocation: 'compose',
          artifact: 'clarification',
          output_file: '.workflow/artifacts/clarification.md',
          on_exists: 'version',
        },
      ],
    },
    {
      id: 'make-plan',
      execution: 'sequential',
      completion: 'all_required',
      delegation: 'inline',
      inputs: ['clarification'],
      outputs: ['plan'],
      on_success: 'complete',
      on_blocked: 'ask_user',
      skills: [
        {
          name: 'writing-plans',
          role: 'primary',
          required: true,
          invocation: 'compose',
          artifact: 'plan',
          output_file: '.workflow/artifacts/plan.md',
          on_exists: 'version',
        },
      ],
    },
  ],
}

export function createEmptyStep(id: string): WorkflowStep {
  return {
    id,
    execution: 'sequential',
    completion: 'all_required',
    delegation: 'inline',
    inputs: [],
    outputs: [],
    on_success: 'complete',
    on_blocked: 'ask_user',
    skills: [],
  }
}

export function nextAvailableId(steps: WorkflowStep[], base: string): string {
  const identifiers = new Set(steps.map((step) => step.id))
  if (!identifiers.has(base)) return base
  let index = 2
  while (identifiers.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

export function validateWorkflow(recipe: WorkflowRecipe): string[] {
  const issues: string[] = []
  const ids = recipe.steps.map((step) => step.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length > 0) issues.push('Cada etapa necesita un identificador único.')

  recipe.steps.forEach((step) => {
    if (!step.id.trim()) issues.push('Hay una etapa sin identificador.')
    if (step.skills.length === 0) issues.push(`La etapa “${step.id || 'sin nombre'}” no tiene ninguna Skill.`)
    if (step.on_success !== 'complete') {
      const nextStepIndex = recipe.steps.findIndex((candidate) => candidate.id === step.on_success)
      if (nextStepIndex === -1) {
        issues.push(`La transición de “${step.id}” apunta a una etapa que no existe.`)
      } else if (nextStepIndex <= recipe.steps.indexOf(step)) {
        issues.push(`La transición de “${step.id}” debe apuntar a una etapa posterior.`)
      }
    }
    step.skills.forEach((skill) => {
      if (!skill.name.trim()) issues.push(`Una Skill de “${step.id}” no tiene nombre.`)
    })
  })

  return [...new Set(issues)]
}

export function workflowFromYaml(source: string): WorkflowRecipe {
  let parsed: unknown
  try {
    parsed = parse(source)
  } catch (error) {
    throw new Error(`YAML inválido: ${error instanceof Error ? error.message : 'error de sintaxis'}`)
  }

  if (!isRecord(parsed)) {
    throw new Error('El archivo debe contener un objeto YAML de workflow.')
  }

  if (!Array.isArray(parsed.steps)) {
    throw new Error('El archivo YAML debe incluir una lista “steps”.')
  }

  return {
    id: asString(parsed.id, 'untitled-workflow'),
    artifact_root: asString(parsed.artifact_root, '.workflow/artifacts'),
    default_delegation: asEnum(parsed.default_delegation, delegationModes, 'inline'),
    default_on_blocked: asEnum(parsed.default_on_blocked, onBlockedModes, 'ask_user'),
    default_invocation: asEnum(parsed.default_invocation, invocationModes, 'compose'),
    model: asString(parsed.model, 'host_default'),
    reasoning_effort: asString(parsed.reasoning_effort, 'host_default'),
    steps: parsed.steps.map(parseStep),
  }
}
