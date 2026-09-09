import { parse, stringify } from 'yaml'
import type { DelegationMode, SkillBinding, SkillRole, WorkflowRecipe, WorkflowStep } from './types'

const delegationModes: DelegationMode[] = ['inline', 'subagent', 'auto']
const skillRoles: SkillRole[] = ['primary', 'supporting', 'review']
const artifactRoot = '.workflow/artifacts'
const rootKeys = ['id', 'artifact_root', 'default_delegation', 'default_on_blocked', 'default_invocation', 'model', 'reasoning_effort', 'steps']
const stepKeys = ['id', 'prompt', 'execution', 'completion', 'model', 'reasoning_effort', 'delegation', 'inputs', 'outputs', 'on_success', 'on_blocked', 'skills']
const skillKeys = ['name', 'role', 'required', 'invocation', 'model', 'reasoning_effort', 'artifact', 'output_file', 'on_exists']

export const orchestratorDefaults = {
  delegation: 'subagent' as DelegationMode,
  model: 'host_default',
  reasoning_effort: 'host_default',
}

export function artifactIdForStep(step: Pick<WorkflowStep, 'id'>): string { return step.id }
export function artifactPathForStep(step: Pick<WorkflowStep, 'id'>): string { return `${artifactRoot}/${artifactIdForStep(step)}.md` }

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function absent(value: unknown): boolean { return value === undefined }
function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Campo inválido “${path}”: debe ser texto no vacío.`)
  return value
}
function optionalString(value: unknown, path: string): string | undefined { return absent(value) ? undefined : requiredString(value, path) }
function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T | undefined {
  if (absent(value)) return undefined
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new Error(`Campo inválido “${path}”: valor no permitido.`)
  return value as T
}
function requiredStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`Campo inválido “${path}”: debe ser una lista de textos no vacía.`)
  return [...value]
}
function optionalStrings(value: unknown, path: string): string[] | undefined { return absent(value) ? undefined : requiredStrings(value, path) }
function rejectRetiredField(path: string, detail: string): never { throw new Error(`Campo retirado “${path}”: ${detail}`) }
function assertAllowedKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const unexpectedKey = Object.keys(value).find((key) => !allowed.includes(key))
  if (unexpectedKey !== undefined) throw new Error(`Campo no permitido “${path ? `${path}.` : ''}${unexpectedKey}”.`)
}

function parseSkill(value: unknown, index: number, stepIndex: number, stepId: string): SkillBinding {
  if (!isRecord(value)) throw new Error(`Campo inválido “steps[${stepIndex}].skills[${index}]”: debe ser un objeto.`)
  const path = `steps[${stepIndex}].skills[${index}]`
  assertAllowedKeys(value, path, skillKeys)
  const artifact = optionalString(value.artifact, `${path}.artifact`)
  if (artifact !== undefined && artifact !== artifactIdForStep({ id: stepId })) rejectRetiredField(`${path}.artifact`, `debe coincidir con el id derivado “${artifactIdForStep({ id: stepId })}”.`)
  const outputFile = optionalString(value.output_file, `${path}.output_file`)
  if (outputFile !== undefined && outputFile !== artifactPathForStep({ id: stepId })) rejectRetiredField(`${path}.output_file`, `debe coincidir con la ruta derivada “${artifactPathForStep({ id: stepId })}”.`)
  if (!absent(value.on_exists)) rejectRetiredField(`${path}.on_exists`, 'la política de colisión pertenece al registro de ejecución.')
  for (const field of ['required', 'invocation', 'model', 'reasoning_effort']) if (!absent(value[field])) rejectRetiredField(`${path}.${field}`, 'la ejecución pertenece al Step runner y el campo no tiene semántica canónica.')
  if (value.role === 'fallback') rejectRetiredField(`${path}.role`, 'fallback ya no es un productor válido; use primary, supporting o review.')
  const role = optionalEnum(value.role, skillRoles, `${path}.role`)
  if (role === undefined) throw new Error(`Campo obligatorio ausente “${path}.role”.`)
  return { name: requiredString(value.name, `${path}.name`), role }
}

function parseStep(value: unknown, index: number): WorkflowStep {
  if (!isRecord(value)) throw new Error(`Campo inválido “steps[${index}]”: debe ser un objeto.`)
  const path = `steps[${index}]`
  assertAllowedKeys(value, path, stepKeys)
  const id = requiredString(value.id, `${path}.id`)
  if (!Array.isArray(value.skills)) throw new Error(`Campo obligatorio ausente “${path}.skills”.`)
  if (!Array.isArray(value.inputs)) throw new Error(`Campo obligatorio ausente “${path}.inputs”.`)
  const inputs = requiredStrings(value.inputs, `${path}.inputs`)
  const outputs = optionalStrings(value.outputs, `${path}.outputs`)
  if (outputs !== undefined && (outputs.length !== 1 || outputs[0] !== artifactIdForStep({ id }))) rejectRetiredField(`${path}.outputs`, `debe ser el id derivado “${artifactIdForStep({ id })}”.`)
  for (const field of ['execution', 'completion', 'on_success', 'on_blocked']) if (!absent(value[field])) rejectRetiredField(`${path}.${field}`, 'la disponibilidad se deriva de inputs y la ejecución la gestiona el Step runner.')
  const skills = value.skills.map((skill, skillIndex) => parseSkill(skill, skillIndex, index, id))
  if (inputs.includes('user-request')) {
    if (index === 0 && inputs.length === 1) inputs.length = 0
    else throw new Error(`Entrada heredada “user-request” en “${path}.inputs”: la migración solo se admite cuando es el único input del primer Step; este uso no tiene equivalente canónico y debe eliminarse.`)
  }
  return {
    id,
    prompt: optionalString(value.prompt, `${path}.prompt`),
    model: optionalString(value.model, `${path}.model`),
    reasoning_effort: optionalString(value.reasoning_effort, `${path}.reasoning_effort`),
    delegation: optionalEnum(value.delegation, delegationModes, `${path}.delegation`),
    inputs,
    skills,
  }
}

export function resolveStep(recipe: WorkflowRecipe, step: WorkflowStep) {
  return {
    delegation: step.delegation ?? recipe.default_delegation ?? orchestratorDefaults.delegation,
    model: step.model ?? recipe.model ?? orchestratorDefaults.model,
    reasoning_effort: step.reasoning_effort ?? recipe.reasoning_effort ?? orchestratorDefaults.reasoning_effort,
    inputs: step.inputs,
    artifactId: artifactIdForStep(step),
    artifactPath: artifactPathForStep(step),
  }
}

export function resolveSkill(_recipe: WorkflowRecipe, _step: WorkflowStep, skill: SkillBinding) { return { name: skill.name, role: skill.role } }

export const defaultWorkflow: WorkflowRecipe = {
  id: 'registration-flow', default_delegation: 'subagent', model: 'host_default', reasoning_effort: 'host_default',
  steps: [
    { id: 'clarify-request', inputs: [], skills: [{ name: 'grilling', role: 'primary' }] },
    { id: 'make-plan', inputs: ['clarify-request'], skills: [{ name: 'writing-plans', role: 'primary' }] },
  ],
}

export function createEmptyStep(id: string): WorkflowStep { return { id, inputs: [], skills: [] } }
export function nextAvailableId(steps: WorkflowStep[], base: string): string {
  const identifiers = new Set(steps.map((step) => step.id))
  if (!identifiers.has(base)) return base
  let index = 2
  while (identifiers.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}
export function insertStepAfterParent(steps: WorkflowStep[], nextStep: WorkflowStep, parentId?: string): WorkflowStep[] {
  const parentIndex = parentId === undefined ? -1 : steps.findIndex((step) => step.id === parentId)
  if (parentIndex < 0) return [...steps, nextStep]
  return [...steps.slice(0, parentIndex + 1), nextStep, ...steps.slice(parentIndex + 1)]
}
export function orderedInputsAfterToggle(preceding: readonly WorkflowStep[], currentInputs: readonly string[], inputId: string): string[] {
  const selected = new Set(currentInputs)
  if (selected.has(inputId)) selected.delete(inputId)
  else selected.add(inputId)
  return preceding.filter((candidate) => selected.has(candidate.id)).map((candidate) => candidate.id)
}
export function successorIdsForStep(recipe: WorkflowRecipe, stepId: string): string[] { return recipe.steps.filter((step) => step.inputs.includes(stepId)).map((step) => step.id) }
export function rootStepIds(recipe: WorkflowRecipe): string[] { return recipe.steps.filter((step) => step.inputs.length === 0).map((step) => step.id) }
export function readyStepIds(recipe: WorkflowRecipe, readyArtifactIds: ReadonlySet<string>): string[] {
  return recipe.steps.filter((step) => !readyArtifactIds.has(step.id) && step.inputs.every((input) => readyArtifactIds.has(input))).map((step) => step.id)
}

export function canConnectSteps(recipe: WorkflowRecipe, sourceId: string, targetId: string): boolean {
  if (!sourceId || !targetId || sourceId === targetId) return false
  const sourceIndex = recipe.steps.findIndex((step) => step.id === sourceId)
  const targetIndex = recipe.steps.findIndex((step) => step.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex >= targetIndex) return false

  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true
    if (seen.has(from)) return false
    seen.add(from)
    return successorIdsForStep(recipe, from).some((next) => reaches(next, target, seen))
  }

  return !reaches(targetId, sourceId)
}

export function validateWorkflow(recipe: WorkflowRecipe): string[] {
  const issues: string[] = []
  const ids = recipe.steps.map((step) => step.id)
  const idSet = new Set(ids)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length > 0) issues.push('Cada etapa necesita un identificador único.')
  if (recipe.steps.length === 0) issues.push('El workflow vacío no es ejecutable: añade al menos una etapa raíz con inputs: [].')
  else if (rootStepIds(recipe).length === 0) issues.push('El grafo necesita al menos una etapa raíz con inputs: [].')
  recipe.steps.forEach((step, stepIndex) => {
    if (!step.id.trim()) issues.push('Hay una etapa sin identificador.')
    if (!Array.isArray(step.inputs)) issues.push(`La etapa “${step.id || 'sin nombre'}” debe declarar inputs.`)
    const inputs = step.inputs ?? []
    if (new Set(inputs).size !== inputs.length) issues.push(`La etapa “${step.id || 'sin nombre'}” no puede repetir entradas.`)
    if (step.skills.length === 0) issues.push(`La etapa “${step.id || 'sin nombre'}” no tiene ninguna Skill.`)
    if (step.skills.filter((skill) => skill.role === 'primary').length !== 1) issues.push(`La etapa “${step.id || 'sin nombre'}” debe tener exactamente una Skill principal.`)
    inputs.forEach((input) => {
      if (!idSet.has(input)) issues.push(`La entrada “${input}” de “${step.id}” apunta a una etapa que no existe.`)
      else if (recipe.steps.findIndex((candidate) => candidate.id === input) >= stepIndex) issues.push(`La entrada “${input}” de “${step.id}” solo puede usar etapas anteriores.`)
    })
    step.skills.forEach((skill) => { if (!skill.name.trim()) issues.push(`Una Skill de “${step.id}” no tiene nombre.`) })
  })
  const visiting = new Set<string>(), visited = new Set<string>(), byId = new Map(recipe.steps.map((step) => [step.id, step]))
  const visit = (id: string): void => {
    if (visiting.has(id)) { issues.push('El grafo de etapas no puede contener ciclos.'); return }
    if (visited.has(id)) return
    visiting.add(id); byId.get(id)?.inputs.forEach(visit); visiting.delete(id); visited.add(id)
  }
  ids.forEach(visit)
  return [...new Set(issues)]
}

export function workflowFromYaml(source: string): WorkflowRecipe {
  let parsed: unknown
  try { parsed = parse(source) } catch (error) { throw new Error(`YAML inválido: ${error instanceof Error ? error.message : 'error de sintaxis'}`) }
  if (!isRecord(parsed)) throw new Error('El archivo debe contener un objeto YAML de workflow.')
  assertAllowedKeys(parsed, '', rootKeys)
  if (!Array.isArray(parsed.steps)) throw new Error('El archivo YAML debe incluir una lista “steps”.')
  const importedArtifactRoot = optionalString(parsed.artifact_root, 'artifact_root')
  if (importedArtifactRoot !== undefined && importedArtifactRoot !== artifactRoot) rejectRetiredField('artifact_root', `debe coincidir con la ruta derivada “${artifactRoot}”.`)
  for (const field of ['default_on_blocked', 'default_invocation']) if (!absent(parsed[field])) rejectRetiredField(field, 'el bloqueo siempre pregunta al usuario y las Skills se cargan dentro del Step runner.')
  return {
    id: requiredString(parsed.id, 'id'),
    default_delegation: optionalEnum(parsed.default_delegation, delegationModes, 'default_delegation'),
    model: optionalString(parsed.model, 'model'),
    reasoning_effort: optionalString(parsed.reasoning_effort, 'reasoning_effort'),
    steps: parsed.steps.map(parseStep),
  }
}

export function workflowToYaml(recipe: WorkflowRecipe): string {
  return stringify({
    id: recipe.id,
    ...(recipe.default_delegation === undefined ? {} : { default_delegation: recipe.default_delegation }),
    ...(recipe.model === undefined ? {} : { model: recipe.model }),
    ...(recipe.reasoning_effort === undefined ? {} : { reasoning_effort: recipe.reasoning_effort }),
    steps: recipe.steps.map((step) => ({
      id: step.id,
      ...(step.prompt === undefined ? {} : { prompt: step.prompt }),
      inputs: step.inputs,
      ...(step.model === undefined ? {} : { model: step.model }),
      ...(step.reasoning_effort === undefined ? {} : { reasoning_effort: step.reasoning_effort }),
      ...(step.delegation === undefined ? {} : { delegation: step.delegation }),
      skills: step.skills.map((skill) => ({ name: skill.name, role: skill.role })),
    })),
  })
}
