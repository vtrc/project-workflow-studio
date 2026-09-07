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

export const orchestratorDefaults = {
  execution: 'sequential' as ExecutionMode,
  completion: 'all_required' as CompletionMode,
  delegation: 'inline' as DelegationMode,
  on_blocked: 'ask_user' as OnBlocked,
  invocation: 'compose' as InvocationMode,
  required: true,
  model: 'host_default',
  reasoning_effort: 'host_default',
  on_exists: 'fail' as OnExistsMode,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function absent(value: unknown): boolean {
  return value === undefined
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Campo inválido “${path}”: debe ser texto no vacío.`)
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  if (absent(value)) return undefined
  return requiredString(value, path)
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T | undefined {
  if (absent(value)) return undefined
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Campo inválido “${path}”: valor no permitido.`)
  }
  return value as T
}

function optionalStrings(value: unknown, path: string): string[] | undefined {
  if (absent(value)) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Campo inválido “${path}”: debe ser una lista de textos no vacíos.`)
  }
  return value
}

function parseSkill(value: unknown, index: number, stepIndex: number): SkillBinding {
  if (!isRecord(value)) throw new Error(`Campo inválido “steps[${stepIndex}].skills[${index}]”: debe ser un objeto.`)
  const path = `steps[${stepIndex}].skills[${index}]`
  const outputFile = optionalString(value.output_file, `${path}.output_file`)
  const artifact = optionalString(value.artifact, `${path}.artifact`)
  if (outputFile && !artifact) throw new Error(`Campo inválido “${path}.artifact”: es obligatorio cuando existe output_file.`)
  if (!absent(value.required) && typeof value.required !== 'boolean') {
    throw new Error(`Campo inválido “${path}.required”: debe ser true o false.`)
  }

  return {
    name: requiredString(value.name, `${path}.name`),
    role: optionalEnum(value.role, skillRoles, `${path}.role`) ?? (() => { throw new Error(`Campo obligatorio ausente “${path}.role”.`) })(),
    required: typeof value.required === 'boolean' ? value.required : undefined,
    invocation: optionalEnum(value.invocation, invocationModes, `${path}.invocation`),
    model: optionalString(value.model, `${path}.model`),
    reasoning_effort: optionalString(value.reasoning_effort, `${path}.reasoning_effort`),
    artifact,
    output_file: outputFile,
    on_exists: optionalEnum(value.on_exists, onExistsModes, `${path}.on_exists`),
  }
}

function parseStep(value: unknown, index: number): WorkflowStep {
  if (!isRecord(value)) throw new Error(`Campo inválido “steps[${index}]”: debe ser un objeto.`)
  if (!Array.isArray(value.skills)) throw new Error(`Campo obligatorio ausente “steps[${index}].skills”.`)
  return {
    id: requiredString(value.id, `steps[${index}].id`),
    execution: optionalEnum(value.execution, executionModes, `steps[${index}].execution`),
    completion: optionalEnum(value.completion, completionModes, `steps[${index}].completion`),
    model: optionalString(value.model, `steps[${index}].model`),
    reasoning_effort: optionalString(value.reasoning_effort, `steps[${index}].reasoning_effort`),
    delegation: optionalEnum(value.delegation, delegationModes, `steps[${index}].delegation`),
    inputs: optionalStrings(value.inputs, `steps[${index}].inputs`),
    outputs: optionalStrings(value.outputs, `steps[${index}].outputs`),
    on_success: requiredString(value.on_success, `steps[${index}].on_success`),
    on_blocked: optionalEnum(value.on_blocked, onBlockedModes, `steps[${index}].on_blocked`),
    skills: value.skills.map((skill, skillIndex) => parseSkill(skill, skillIndex, index)),
  }
}

export function resolveStep(recipe: WorkflowRecipe, step: WorkflowStep) {
  return {
    execution: step.execution ?? orchestratorDefaults.execution,
    completion: step.completion ?? orchestratorDefaults.completion,
    delegation: step.delegation ?? recipe.default_delegation ?? orchestratorDefaults.delegation,
    on_blocked: step.on_blocked ?? recipe.default_on_blocked ?? orchestratorDefaults.on_blocked,
    model: step.model ?? recipe.model ?? orchestratorDefaults.model,
    reasoning_effort: step.reasoning_effort ?? recipe.reasoning_effort ?? orchestratorDefaults.reasoning_effort,
    inputs: step.inputs ?? [],
    outputs: step.outputs ?? [],
  }
}

export function resolveSkill(recipe: WorkflowRecipe, step: WorkflowStep, skill: SkillBinding) {
  const resolvedStep = resolveStep(recipe, step)
  return {
    invocation: skill.invocation ?? recipe.default_invocation ?? orchestratorDefaults.invocation,
    required: skill.required ?? orchestratorDefaults.required,
    model: skill.model ?? resolvedStep.model,
    reasoning_effort: skill.reasoning_effort ?? resolvedStep.reasoning_effort,
    on_exists: skill.on_exists ?? orchestratorDefaults.on_exists,
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
      on_success: 'make-plan',
      inputs: ['user-request'],
      outputs: ['clarification'],
      skills: [{ name: 'grilling', role: 'primary', artifact: 'clarification', output_file: '.workflow/artifacts/clarification.md', on_exists: 'version' }],
    },
    {
      id: 'make-plan',
      on_success: 'complete',
      inputs: ['clarification'],
      outputs: ['plan'],
      skills: [{ name: 'writing-plans', role: 'primary', artifact: 'plan', output_file: '.workflow/artifacts/plan.md', on_exists: 'version' }],
    },
  ],
}

export function createEmptyStep(id: string): WorkflowStep {
  return { id, on_success: 'complete', skills: [] }
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
      if (nextStepIndex === -1) issues.push(`La transición de “${step.id}” apunta a una etapa que no existe.`)
      else if (nextStepIndex <= recipe.steps.indexOf(step)) issues.push(`La transición de “${step.id}” debe apuntar a una etapa posterior.`)
    }
    step.skills.forEach((skill) => {
      if (!skill.name.trim()) issues.push(`Una Skill de “${step.id}” no tiene nombre.`)
      if (skill.output_file && !skill.artifact) issues.push(`La Skill “${skill.name}” necesita un artefacto para su ruta de salida.`)
    })
  })
  return [...new Set(issues)]
}

export function workflowFromYaml(source: string): WorkflowRecipe {
  let parsed: unknown
  try { parsed = parse(source) } catch (error) {
    throw new Error(`YAML inválido: ${error instanceof Error ? error.message : 'error de sintaxis'}`)
  }
  if (!isRecord(parsed)) throw new Error('El archivo debe contener un objeto YAML de workflow.')
  if (!Array.isArray(parsed.steps)) throw new Error('El archivo YAML debe incluir una lista “steps”.')
  return {
    id: requiredString(parsed.id, 'id'),
    artifact_root: requiredString(parsed.artifact_root, 'artifact_root'),
    default_delegation: optionalEnum(parsed.default_delegation, delegationModes, 'default_delegation'),
    default_on_blocked: optionalEnum(parsed.default_on_blocked, onBlockedModes, 'default_on_blocked'),
    default_invocation: optionalEnum(parsed.default_invocation, invocationModes, 'default_invocation'),
    model: optionalString(parsed.model, 'model'),
    reasoning_effort: optionalString(parsed.reasoning_effort, 'reasoning_effort'),
    steps: parsed.steps.map(parseStep),
  }
}
