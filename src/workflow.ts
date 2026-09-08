import { parse, stringify } from 'yaml'
import type {
  CompletionMode,
  DelegationMode,
  ExecutionMode,
  InvocationMode,
  OnBlocked,
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
const skillRoles: SkillRole[] = ['primary', 'supporting', 'review']
const legacyArtifactRoot = '.workflow/artifacts'

export const orchestratorDefaults = {
  execution: 'sequential' as ExecutionMode,
  completion: 'all_required' as CompletionMode,
  delegation: 'inline' as DelegationMode,
  on_blocked: 'ask_user' as OnBlocked,
  invocation: 'compose' as InvocationMode,
  required: true,
  model: 'host_default',
  reasoning_effort: 'host_default',
}

export function artifactIdForStep(step: Pick<WorkflowStep, 'id'>): string {
  return step.id
}

export function artifactPathForStep(step: Pick<WorkflowStep, 'id'>): string {
  return `${legacyArtifactRoot}/${artifactIdForStep(step)}.md`
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

function rejectRetiredField(path: string, detail: string): never {
  throw new Error(`Campo retirado “${path}”: ${detail}`)
}

function parseSkill(value: unknown, index: number, stepIndex: number, stepId: string): SkillBinding {
  if (!isRecord(value)) throw new Error(`Campo inválido “steps[${stepIndex}].skills[${index}]”: debe ser un objeto.`)
  const path = `steps[${stepIndex}].skills[${index}]`
  const artifact = optionalString(value.artifact, `${path}.artifact`)
  if (artifact !== undefined && artifact !== artifactIdForStep({ id: stepId })) {
    rejectRetiredField(`${path}.artifact`, `debe coincidir con el id derivado “${artifactIdForStep({ id: stepId })}”.`)
  }
  const outputFile = optionalString(value.output_file, `${path}.output_file`)
  if (outputFile !== undefined && outputFile !== artifactPathForStep({ id: stepId })) {
    rejectRetiredField(`${path}.output_file`, `debe coincidir con la ruta derivada “${artifactPathForStep({ id: stepId })}”.`)
  }
  if (!absent(value.on_exists)) {
    rejectRetiredField(`${path}.on_exists`, 'la política de colisión pertenece al registro de ejecución.')
  }
  if (!absent(value.required) && typeof value.required !== 'boolean') {
    throw new Error(`Campo inválido “${path}.required”: debe ser true o false.`)
  }

  if (value.role === 'fallback') {
    rejectRetiredField(`${path}.role`, 'fallback ya no es un productor válido; use primary, supporting o review.')
  }
  const role = optionalEnum(value.role, skillRoles, `${path}.role`)
  if (role === undefined) throw new Error(`Campo obligatorio ausente “${path}.role”.`)
  return {
    name: requiredString(value.name, `${path}.name`),
    role,
    required: typeof value.required === 'boolean' ? value.required : undefined,
    invocation: optionalEnum(value.invocation, invocationModes, `${path}.invocation`),
    model: optionalString(value.model, `${path}.model`),
    reasoning_effort: optionalString(value.reasoning_effort, `${path}.reasoning_effort`),
  }
}

function parseStep(value: unknown, index: number): WorkflowStep {
  if (!isRecord(value)) throw new Error(`Campo inválido “steps[${index}]”: debe ser un objeto.`)
  if (!Array.isArray(value.skills)) throw new Error(`Campo obligatorio ausente “steps[${index}].skills”.`)
  const id = requiredString(value.id, `steps[${index}].id`)
  const outputs = optionalStrings(value.outputs, `steps[${index}].outputs`)
  if (outputs !== undefined && (outputs.length !== 1 || outputs[0] !== artifactIdForStep({ id }))) {
    rejectRetiredField(`steps[${index}].outputs`, `debe ser el id derivado “${artifactIdForStep({ id })}”.`)
  }
  return {
    id,
    prompt: optionalString(value.prompt, `steps[${index}].prompt`),
    execution: optionalEnum(value.execution, executionModes, `steps[${index}].execution`),
    completion: optionalEnum(value.completion, completionModes, `steps[${index}].completion`),
    model: optionalString(value.model, `steps[${index}].model`),
    reasoning_effort: optionalString(value.reasoning_effort, `steps[${index}].reasoning_effort`),
    delegation: optionalEnum(value.delegation, delegationModes, `steps[${index}].delegation`),
    inputs: optionalStrings(value.inputs, `steps[${index}].inputs`),
    on_success: requiredString(value.on_success, `steps[${index}].on_success`),
    on_blocked: optionalEnum(value.on_blocked, onBlockedModes, `steps[${index}].on_blocked`),
    skills: value.skills.map((skill, skillIndex) => parseSkill(skill, skillIndex, index, id)),
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
    outputs: [artifactIdForStep(step)],
  }
}

export function resolveSkill(recipe: WorkflowRecipe, step: WorkflowStep, skill: SkillBinding) {
  const resolvedStep = resolveStep(recipe, step)
  return {
    invocation: skill.invocation ?? recipe.default_invocation ?? orchestratorDefaults.invocation,
    required: skill.required ?? orchestratorDefaults.required,
    model: skill.model ?? resolvedStep.model,
    reasoning_effort: skill.reasoning_effort ?? resolvedStep.reasoning_effort,
  }
}

export const defaultWorkflow: WorkflowRecipe = {
  id: 'registration-flow',
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
      skills: [{ name: 'grilling', role: 'primary' }],
    },
    {
      id: 'make-plan',
      on_success: 'complete',
      inputs: ['clarify-request'],
      skills: [{ name: 'writing-plans', role: 'primary' }],
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
    const primaryCount = step.skills.filter((skill) => skill.role === 'primary').length
    if (primaryCount !== 1) issues.push(`La etapa “${step.id || 'sin nombre'}” debe tener exactamente una Skill principal.`)
    const stepIndex = recipe.steps.indexOf(step)
    step.inputs?.forEach((input) => {
      if (input !== 'user-request' && !recipe.steps.slice(0, stepIndex).some((candidate) => candidate.id === input)) {
        issues.push(`La entrada “${input}” de “${step.id}” solo puede usar user-request o etapas anteriores.`)
      }
    })
    if (step.on_success !== 'complete') {
      const nextStepIndex = recipe.steps.findIndex((candidate) => candidate.id === step.on_success)
      if (nextStepIndex === -1) issues.push(`La transición de “${step.id}” apunta a una etapa que no existe.`)
      else if (nextStepIndex <= recipe.steps.indexOf(step)) issues.push(`La transición de “${step.id}” debe apuntar a una etapa posterior.`)
    }
    step.skills.forEach((skill) => {
      if (!skill.name.trim()) issues.push(`Una Skill de “${step.id}” no tiene nombre.`)
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
  const artifactRoot = optionalString(parsed.artifact_root, 'artifact_root')
  if (artifactRoot !== undefined && artifactRoot !== legacyArtifactRoot) {
    rejectRetiredField('artifact_root', `debe coincidir con la ruta derivada “${legacyArtifactRoot}”.`)
  }
  return {
    id: requiredString(parsed.id, 'id'),
    default_delegation: optionalEnum(parsed.default_delegation, delegationModes, 'default_delegation'),
    default_on_blocked: optionalEnum(parsed.default_on_blocked, onBlockedModes, 'default_on_blocked'),
    default_invocation: optionalEnum(parsed.default_invocation, invocationModes, 'default_invocation'),
    model: optionalString(parsed.model, 'model'),
    reasoning_effort: optionalString(parsed.reasoning_effort, 'reasoning_effort'),
    steps: parsed.steps.map(parseStep),
  }
}

/** Produces the canonical authored format, omitting compatible legacy import fields. */
export function workflowToYaml(recipe: WorkflowRecipe): string {
  return stringify({
    id: recipe.id,
    default_delegation: recipe.default_delegation,
    default_on_blocked: recipe.default_on_blocked,
    default_invocation: recipe.default_invocation,
    model: recipe.model,
    reasoning_effort: recipe.reasoning_effort,
    steps: recipe.steps.map((step) => ({
      id: step.id,
      prompt: step.prompt,
      execution: step.execution,
      completion: step.completion,
      model: step.model,
      reasoning_effort: step.reasoning_effort,
      delegation: step.delegation,
      inputs: step.inputs,
      on_success: step.on_success,
      on_blocked: step.on_blocked,
      skills: step.skills.map((skill) => ({
        name: skill.name,
        role: skill.role,
        required: skill.required,
        invocation: skill.invocation,
        model: skill.model,
        reasoning_effort: skill.reasoning_effort,
      })),
    })),
  })
}
