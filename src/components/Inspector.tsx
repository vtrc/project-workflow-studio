import { Copy, Info, Plus, Trash2 } from 'lucide-react'
import type { DelegationMode, SkillBinding, SkillRole, WorkflowRecipe, WorkflowStep } from '../types'
import { artifactIdForStep, artifactPathForStep, orchestratorDefaults, resolveStep } from '../workflow'
import { skillCatalogOptions, type SkillCatalog } from '../skillCatalog'

interface InspectorProps {
  workflow: WorkflowRecipe
  selectedStep: WorkflowStep | null
  validationIssues: string[]
  onWorkflowChange: (change: Partial<WorkflowRecipe>) => void
  onStepChange: (id: string, update: (step: WorkflowStep) => WorkflowStep) => void
  onDuplicateStep: (id: string) => void
  onDeleteStep: (id: string) => void
  skillCatalog: SkillCatalog | null
  onReloadSkills: () => void
  canReloadSkills: boolean
}

type Help = { title: string; description: string }
const help = {
  workflowId: { title: 'Nombre del workflow', description: 'Identidad estable de la receta.' },
  stepId: { title: 'Nombre de la etapa', description: 'Identificador estable usado por los artefactos y las entradas.' },
  prompt: { title: 'Prompt de la etapa', description: 'Contexto opcional entregado al Step runner.' },
  artifact: { title: 'Artefacto derivado', description: 'Cada etapa publica exactamente un artefacto derivado de su ID.' },
  inputs: { title: 'Entradas', description: 'Artefactos de etapas anteriores que deben estar listos antes de ejecutar esta etapa.' },
  delegation: { title: 'Delegación', description: 'Política sobre quién ejecuta la etapa y carga sus Skills.' },
  model: { title: 'Modelo', description: 'Intención de modelo para el cliente compatible.' },
  reasoning: { title: 'Razonamiento', description: 'Intención de nivel de razonamiento para el cliente compatible.' },
  skillName: { title: 'Nombre de la Skill', description: 'Nombre exacto de una Skill local.' },
  skillRole: { title: 'Papel de la Skill', description: 'primary publica el artefacto; supporting y review aportan contexto.' },
} satisfies Record<string, Help>

function FieldLabel({ htmlFor, label, content }: { htmlFor?: string; label: string; content: Help }) {
  return <div className="field-label-row"><label htmlFor={htmlFor}>{label}</label><span title={content.description} aria-label={`Información sobre ${content.title}`}><Info size={14} aria-hidden="true" /></span></div>
}

function InheritedTextField({ id, label, value, effective, content, onChange }: { id: string; label: string; value: string | undefined; effective: string; content: Help; onChange: (value: string | undefined) => void }) {
  return <div className="field"><FieldLabel htmlFor={id} label={label} content={content} /><input id={id} value={value ?? ''} placeholder={`Heredado: ${effective}`} onChange={(event) => onChange(event.target.value.trim() ? event.target.value : undefined)} />{value === undefined ? <p className="inheritance-note">Heredado: {effective}</p> : <button className="link-button" type="button" onClick={() => onChange(undefined)}>Volver a heredar ({effective})</button>}</div>
}

function InheritedSelect({ id, label, value, effective, content, onChange, options }: { id: string; label: string; value: DelegationMode | undefined; effective: DelegationMode; content: Help; onChange: (value: DelegationMode | undefined) => void; options: { value: DelegationMode; label: string }[] }) {
  return <div className="field"><FieldLabel htmlFor={id} label={label} content={content} /><select id={id} value={value ?? '__inherited__'} onChange={(event) => onChange(event.target.value === '__inherited__' ? undefined : event.target.value as DelegationMode)}><option value="__inherited__">Usar valor heredado: {effective}</option>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></div>
}

function InputsField({ workflow, step, onChange }: { workflow: WorkflowRecipe; step: WorkflowStep; onChange: (inputs: string[]) => void }) {
  const index = workflow.steps.findIndex((candidate) => candidate.id === step.id)
  const preceding = workflow.steps.slice(0, index)
  return <div className="field"><FieldLabel htmlFor="step-inputs" label="Entradas" content={help.inputs} /><p className="field-helper">Selecciona todos los artefactos de etapas anteriores que necesita esta etapa.</p><select id="step-inputs" multiple value={step.inputs} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))}>{preceding.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.id}</option>)}</select><p className="field-effect">{step.inputs.length === 0 ? 'Es una etapa raíz y no necesita artefactos anteriores.' : `Usará ${step.inputs.map((input) => `“${input}”`).join(', ')}.`}</p></div>
}

function StepInspector({ workflow, step, onChange, onDuplicate, onDelete, skillCatalog, onReloadSkills, canReloadSkills }: { workflow: WorkflowRecipe; step: WorkflowStep; onChange: (update: (current: WorkflowStep) => WorkflowStep) => void; onDuplicate: () => void; onDelete: () => void; skillCatalog: SkillCatalog | null; onReloadSkills: () => void; canReloadSkills: boolean }) {
  const resolved = resolveStep(workflow, step)
  const catalogOptions = skillCatalogOptions(skillCatalog)
  const updateSkill = (index: number, patch: Partial<SkillBinding>) => onChange((current) => ({ ...current, skills: current.skills.map((skill, skillIndex) => skillIndex === index ? { ...skill, ...patch } : skill) }))
  return <div className="inspector-form">
    <section className="field-group">
      <div className="field-group-header"><h3>Nombre de etapa</h3></div>
      <div className="field"><FieldLabel htmlFor="step-id" label="Nombre" content={help.stepId} /><input id="step-id" value={step.id} onChange={(event) => onChange((current) => ({ ...current, id: event.target.value }))} /><p className="field-effect">{step.id.trim() ? `La etapa se exportará con el identificador “${step.id}”.` : 'Escribe un identificador único.'}</p></div>
      <div className="field"><FieldLabel htmlFor="step-prompt" label="Prompt" content={help.prompt} /><textarea id="step-prompt" value={step.prompt ?? ''} onChange={(event) => onChange((current) => ({ ...current, prompt: event.target.value.trim() || undefined }))} /><p className="field-effect">Contexto opcional para el Step runner.</p></div>
    </section>
    <section className="field-group">
      <div className="field-group-header"><h3>Artefacto de la etapa</h3></div>
      <div className="two-fields"><div className="field"><FieldLabel htmlFor="step-artifact-id" label="Identificador" content={help.artifact} /><input id="step-artifact-id" value={artifactIdForStep(step)} readOnly /></div><div className="field"><FieldLabel htmlFor="step-artifact-path" label="Ruta" content={help.artifact} /><input id="step-artifact-path" value={artifactPathForStep(step)} readOnly /></div></div>
      <p className="field-effect">La Skill primary es la única productora pública.</p>
    </section>
    <section className="field-group">
      <div className="field-group-header"><h3>Dependencias</h3></div>
      <InputsField workflow={workflow} step={step} onChange={(inputs) => onChange((current) => ({ ...current, inputs }))} />
    </section>
    <section className="field-group">
      <div className="field-group-header"><h3>Skills</h3><div className="skill-section-actions"><button className="button button-secondary button-small" type="button" onClick={onReloadSkills} disabled={!canReloadSkills}>Actualizar Skills</button><button className="button button-secondary button-small" type="button" onClick={() => onChange((current) => ({ ...current, skills: [...current.skills, { name: catalogOptions[0]?.name ?? 'new-skill', role: 'primary' }] }))}><Plus size={14} aria-hidden="true" /> Añadir</button></div></div>
      {step.skills.length === 0 ? <div className="empty-skills">Aún no has añadido ninguna Skill.</div> : step.skills.map((skill, index) => <div className="skill-row" key={`${skill.name}-${index}`}>
        <div className="skill-row-top"><span>Skill {index + 1}</span><button className="icon-button remove-skill" type="button" aria-label={`Eliminar Skill ${skill.name}`} onClick={() => onChange((current) => ({ ...current, skills: current.skills.filter((_, skillIndex) => skillIndex !== index) }))}><Trash2 size={14} aria-hidden="true" /></button></div>
        <div className="field"><FieldLabel htmlFor={`skill-name-${index}`} label="Nombre" content={help.skillName} />{catalogOptions.length > 0 ? <select id={`skill-name-${index}`} value={skill.name} onChange={(event) => updateSkill(index, { name: event.target.value })}>{catalogOptions.map((option) => <option key={`${option.origin}:${option.name}`} value={option.name}>{option.name} — {option.description}</option>)}</select> : <input id={`skill-name-${index}`} value={skill.name} onChange={(event) => updateSkill(index, { name: event.target.value })} />}</div>
        <div className="field"><FieldLabel htmlFor={`skill-role-${index}`} label="Papel" content={help.skillRole} /><select id={`skill-role-${index}`} value={skill.role} onChange={(event) => updateSkill(index, { role: event.target.value as SkillRole })}><option value="primary">Principal</option><option value="supporting">Apoyo</option><option value="review">Revisión</option></select></div>
      </div>)}
    </section>
    <details className="advanced-section"><summary>Política de ejecución</summary><div className="advanced-section-content">
      <InheritedSelect id="delegation" label="Quién la realiza" content={help.delegation} value={step.delegation} effective={resolved.delegation} options={[{ value: 'inline', label: 'Agente actual' }, { value: 'subagent', label: 'Subagente' }, { value: 'auto', label: 'Decide el cliente' }]} onChange={(delegation) => onChange((current) => ({ ...current, delegation }))} />
      <InheritedTextField id="step-model" label="Modelo" content={help.model} value={step.model} effective={resolved.model} onChange={(model) => onChange((current) => ({ ...current, model }))} />
      <InheritedTextField id="step-reasoning" label="Razonamiento" content={help.reasoning} value={step.reasoning_effort} effective={resolved.reasoning_effort} onChange={(reasoning_effort) => onChange((current) => ({ ...current, reasoning_effort }))} />
    </div></details>
    <div className="inspector-actions"><button className="button button-secondary" type="button" onClick={onDuplicate}><Copy size={15} aria-hidden="true" /> Duplicar</button><button className="button button-danger" type="button" onClick={onDelete}><Trash2 size={15} aria-hidden="true" /> Eliminar</button></div>
  </div>
}

function WorkflowInspector({ workflow, validationIssues, onChange }: { workflow: WorkflowRecipe; validationIssues: string[]; onChange: (change: Partial<WorkflowRecipe>) => void }) {
  return <div className="inspector-form"><section className="field-group"><div className="field-group-header"><h3>Workflow</h3></div><div className="field"><FieldLabel htmlFor="workflow-id" label="Nombre" content={help.workflowId} /><input id="workflow-id" value={workflow.id} onChange={(event) => onChange({ id: event.target.value })} /></div></section><details className="advanced-section"><summary>Política del workflow</summary><div className="advanced-section-content"><InheritedTextField id="workflow-model" label="Modelo" content={help.model} value={workflow.model} effective={orchestratorDefaults.model} onChange={(model) => onChange({ model })} /><InheritedTextField id="reasoning-effort" label="Razonamiento" content={help.reasoning} value={workflow.reasoning_effort} effective={orchestratorDefaults.reasoning_effort} onChange={(reasoning_effort) => onChange({ reasoning_effort })} /><InheritedSelect id="default-delegation" label="Delegación" content={help.delegation} value={workflow.default_delegation} effective={orchestratorDefaults.delegation} options={[{ value: 'inline', label: 'Agente actual' }, { value: 'subagent', label: 'Subagente' }, { value: 'auto', label: 'Decide el cliente' }]} onChange={(default_delegation) => onChange({ default_delegation })} /></div></details><section className="field-group"><div className="field-group-header"><h3>Estado</h3></div><div className="workflow-settings-note">La disponibilidad se deriva de inputs. Un Step bloqueado siempre conserva el estado y pregunta al usuario.</div>{validationIssues.length > 0 && <ul className="validation-list" aria-label="Avisos de validación">{validationIssues.map((issue) => <li key={issue}>• {issue}</li>)}</ul>}</section></div>
}

export function Inspector({ workflow, selectedStep, validationIssues, onWorkflowChange, onStepChange, onDuplicateStep, onDeleteStep, skillCatalog, onReloadSkills, canReloadSkills }: InspectorProps) {
  if (!selectedStep) return <WorkflowInspector workflow={workflow} validationIssues={validationIssues} onChange={onWorkflowChange} />
  return <StepInspector workflow={workflow} step={selectedStep} onChange={(update) => onStepChange(selectedStep.id, update)} onDuplicate={() => onDuplicateStep(selectedStep.id)} onDelete={() => onDeleteStep(selectedStep.id)} skillCatalog={skillCatalog} onReloadSkills={onReloadSkills} canReloadSkills={canReloadSkills} />
}
