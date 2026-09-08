import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Info, Plus, Trash2, X } from 'lucide-react'
import type {
  SkillBinding,
  SkillRole,
  WorkflowRecipe,
  WorkflowStep,
} from '../types'
import { orchestratorDefaults, resolveSkill, resolveStep } from '../workflow'
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

type HelpOption = {
  value: string
  description: string
}

type HelpContent = {
  title: string
  description: string
  options?: HelpOption[]
  note?: string
}

type PopoverPlacement = {
  side: 'bottom' | 'top'
  left: number
  maxHeight: number
  width: number
}

const fieldHelp = {
  workflowId: {
    title: 'Nombre del workflow',
    description: 'Es la identidad estable de esta receta. Se exporta como id en el YAML.',
  },
  artifactRoot: {
    title: 'Carpeta de resultados',
    description: 'Define la ruta relativa al proyecto donde el workflow espera registrar sus artefactos.',
    note: 'No crea una carpeta por sí sola; el cliente y las Skills deben poder escribir en ella.',
  },
  model: {
    title: 'Modelo',
    description: 'Es una intención para el cliente compatible, no una orden universal para cambiar de modelo.',
    options: [
      { value: 'inherit', description: 'No fija el modelo en este nivel y deja que se resuelva desde una configuración superior.' },
      { value: 'host_default', description: 'Solicita el modelo predeterminado configurado en el cliente.' },
      { value: 'Valor del cliente', description: 'Un nombre de modelo que el cliente de destino reconoce y permite usar.' },
    ],
  },
  reasoning: {
    title: 'Razonamiento',
    description: 'Indica el nivel de razonamiento que el cliente debería aplicar. El cliente decide si puede respetarlo.',
    options: [
      { value: 'inherit', description: 'No fija el razonamiento en este nivel y hereda el valor disponible.' },
      { value: 'host_default', description: 'Solicita el valor predeterminado del cliente.' },
      { value: 'Valor del cliente', description: 'Un nivel válido para ese cliente, por ejemplo uno que su host documente.' },
    ],
  },
  defaultDelegation: {
    title: 'Delegación predeterminada',
    description: 'Se aplica a las etapas que no declaran una delegación propia.',
    options: [
      { value: 'Agente actual', description: 'La realiza el agente que está ejecutando el workflow.' },
      { value: 'Subagente', description: 'Pide que la etapa se delegue en un subagente cuando el cliente lo permita.' },
      { value: 'Decide el cliente', description: 'Deja que la política del cliente decida cómo realizarla.' },
    ],
  },
  onBlocked: {
    title: 'Comportamiento al bloquearse',
    description: 'Define qué ocurre cuando una parte requerida no puede continuar.',
    options: [
      { value: 'Pide ayuda', description: 'Guarda el estado y solicita la información o decisión que falta.' },
      { value: 'Detiene el flujo', description: 'Detiene el workflow sin intentar continuar.' },
    ],
  },
  defaultInvocation: {
    title: 'Aplicación predeterminada de Skills',
    description: 'Se aplica a cada Skill que no declare una forma de invocación propia.',
    options: [
      { value: 'Componer en el workflow', description: 'El workflow aplica las instrucciones de la Skill local dentro del contexto activo.' },
      { value: 'Requiere al usuario', description: 'La Skill requiere una acción explícita del usuario y no sirve para un flujo totalmente automático.' },
      { value: 'Si el cliente lo permite', description: 'Solo se usa si el cliente puede demostrar que admite esa invocación.' },
    ],
  },
  stepId: {
    title: 'Nombre de la etapa',
    description: 'Es el identificador de esta etapa. Las transiciones posteriores lo usan para encontrarla.',
  },
  execution: {
    title: 'Ejecución',
    description: 'Define cómo se programan las Skills de esta etapa.',
    options: [
      { value: 'En orden', description: 'Aplica las Skills elegibles una tras otra, siguiendo el orden de la lista.' },
      { value: 'En paralelo', description: 'Puede iniciar las Skills elegibles a la vez si el cliente las admite y no dependen entre sí.' },
    ],
  },
  completion: {
    title: 'Finaliza cuando',
    description: 'Define qué resultado de las Skills obligatorias permite avanzar a la siguiente etapa.',
    options: [
      { value: 'Terminan todas', description: 'Espera a que todas las Skills obligatorias terminen correctamente.' },
      { value: 'Termina una correctamente', description: 'Avanza cuando una Skill obligatoria termina correctamente.' },
    ],
  },
  delegation: {
    title: 'Quién realiza la etapa',
    description: 'Es una preferencia para el cliente sobre quién debe ejecutar esta etapa.',
    options: [
      { value: 'Agente actual', description: 'La realiza el agente que está ejecutando el workflow.' },
      { value: 'Subagente', description: 'Pide que la etapa se delegue en un subagente cuando el cliente lo permita.' },
      { value: 'Decide el cliente', description: 'Deja que la política del cliente decida cómo realizarla.' },
    ],
  },
  inputs: {
    title: 'Entradas',
    description: 'Son identificadores de artefactos que esta etapa consume.',
    note: 'Solo pueden usarse artefactos ya preparados y registrados por una etapa anterior.',
  },
  outputs: {
    title: 'Salidas',
    description: 'Son identificadores de los artefactos que la etapa declara como resultado.',
    note: 'Una Skill concreta debe ser la propietaria clara de cada archivo que produzca.',
  },
  skillName: {
    title: 'Nombre de la Skill',
    description: 'Debe coincidir exactamente con el nombre del frontmatter de una Skill local disponible para el cliente.',
  },
  skillRole: {
    title: 'Papel de la Skill',
    description: 'Describe la responsabilidad de la Skill dentro de esta etapa; no escoge una metodología.',
    options: [
      { value: 'Principal', description: 'Realiza el trabajo principal de la etapa.' },
      { value: 'Apoyo', description: 'Aporta trabajo de apoyo al resultado principal.' },
      { value: 'Revisión', description: 'Revisa o evalúa el resultado de otras Skills.' },
      { value: 'Respaldo', description: 'Solo puede activarse en una etapa secuencial después de que falle una Skill obligatoria que no sea de respaldo.' },
    ],
  },
  skillInvocation: {
    title: 'Aplicación de esta Skill',
    description: 'Define cómo esta Skill concreta entra en el workflow y sustituye el valor predeterminado cuando lo indicas.',
    options: [
      { value: 'Componer en el workflow', description: 'El workflow aplica las instrucciones de la Skill local dentro del contexto activo.' },
      { value: 'Requiere al usuario', description: 'Exige una acción explícita del usuario; no permite un flujo totalmente automático.' },
      { value: 'Si el cliente lo permite', description: 'Solo se usa cuando el cliente demuestra que admite esa forma de invocación.' },
    ],
  },
  onExists: {
    title: 'Si ya existe el archivo',
    description: 'Define qué hace la Skill cuando la ruta de salida ya contiene un archivo.',
    options: [
      { value: 'Falla', description: 'Falla para evitar sobrescribir información existente.' },
      { value: 'Sobrescribe', description: 'Sobrescribe el archivo solo si esta Skill es su propietaria.' },
      { value: 'Crea una versión', description: 'Crea y registra una nueva versión del archivo.' },
    ],
  },
  nextStep: {
    title: 'Siguiente etapa',
    description: 'Define qué transición se sigue cuando esta etapa finaliza correctamente.',
    options: [
      { value: 'Completar el workflow', description: 'Termina el workflow.' },
      { value: 'Una etapa posterior', description: 'Continúa en una etapa que aparezca después en la receta.' },
    ],
  },
} satisfies Record<string, HelpContent>

function FieldHelp({ content }: { content: HelpContent }) {
  const [isOpen, setIsOpen] = useState(false)
  const [placement, setPlacement] = useState<PopoverPlacement>({ side: 'bottom', left: 0, maxHeight: 0, width: 0 })
  const popoverId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLSpanElement>(null)

  const close = (restoreFocus = true) => {
    setIsOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!isOpen) return undefined

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      close(false)
    }

    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnPointerDown)
    closeRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnPointerDown)
    }
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) return undefined

    const trigger = triggerRef.current
    const popover = popoverRef.current
    const panel = trigger?.closest<HTMLElement>('.inspector-panel')
    if (!trigger || !popover || !panel) return undefined

    const updatePlacement = () => {
      const triggerRect = trigger.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const panelStyles = window.getComputedStyle(panel)
      const paddingLeft = Number.parseFloat(panelStyles.paddingLeft) || 0
      const paddingRight = Number.parseFloat(panelStyles.paddingRight) || 0
      const visibleTop = Math.max(panelRect.top, 0)
      const visibleBottom = Math.min(panelRect.bottom, window.innerHeight)
      const contentLeft = panelRect.left + paddingLeft
      const contentRight = panelRect.right - paddingRight
      const availableWidth = Math.max(0, contentRight - contentLeft)
      const width = Math.min(292, availableWidth)
      const horizontalLeft = Math.min(
        Math.max(triggerRect.left, contentLeft),
        Math.max(contentLeft, contentRight - width),
      )
      const gap = 7
      const below = Math.max(0, visibleBottom - triggerRect.bottom - gap)
      const above = Math.max(0, triggerRect.top - visibleTop - gap)
      const requiredHeight = popover.scrollHeight
      const side: PopoverPlacement['side'] = below >= requiredHeight || below >= above ? 'bottom' : 'top'
      const maxHeight = Math.floor(side === 'bottom' ? below : above)

      setPlacement((current) => {
        const next = {
          side,
          left: Math.round(horizontalLeft - triggerRect.left),
          maxHeight,
          width: Math.floor(width),
        }
        return current.side === next.side &&
          current.left === next.left &&
          current.maxHeight === next.maxHeight &&
          current.width === next.width
          ? current
          : next
      })
    }

    const frame = window.requestAnimationFrame(updatePlacement)
    const observer = new ResizeObserver(updatePlacement)
    observer.observe(panel)
    observer.observe(popover)
    panel.addEventListener('scroll', updatePlacement, { passive: true })
    window.addEventListener('resize', updatePlacement)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      panel.removeEventListener('scroll', updatePlacement)
      window.removeEventListener('resize', updatePlacement)
    }
  }, [isOpen])

  return (
    <span className="field-help">
      <button
        ref={triggerRef}
        className="field-help-trigger"
        type="button"
        aria-label={`Información sobre ${content.title}`}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {isOpen && (
        <span
          ref={popoverRef}
          className="field-help-popover"
          data-placement={placement.side}
          id={popoverId}
          role="dialog"
          aria-label={`Ayuda: ${content.title}`}
          style={{
            left: placement.left,
            width: placement.width || undefined,
            maxHeight: placement.maxHeight || undefined,
          }}
        >
          <span className="field-help-popover-header">
            <strong>{content.title}</strong>
            <button ref={closeRef} type="button" className="field-help-close" aria-label={`Cerrar ayuda sobre ${content.title}`} onClick={() => close()}>
              <X size={14} aria-hidden="true" />
            </button>
          </span>
          <span className="field-help-description">{content.description}</span>
          {content.options && (
            <span className="field-help-options">
              {content.options.map((option) => (
                <span className="field-help-option" key={option.value}>
                  <strong>{option.value}</strong>
                  <span>{option.description}</span>
                </span>
              ))}
            </span>
          )}
          {content.note && <span className="field-help-note">{content.note}</span>}
        </span>
      )}
    </span>
  )
}

function FieldLabel({ htmlFor, label, help }: { htmlFor?: string; label: string; help: HelpContent }) {
  return (
    <div className="field-label-row">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="field-label">{label}</span>}
      <FieldHelp content={help} />
    </div>
  )
}

function FieldEffect({ children }: { children: string }) {
  return <p className="field-effect" aria-live="polite">{children}</p>
}

interface TokensFieldProps {
  label: string
  helper: string
  values: string[]
  help: HelpContent
  emptyEffect: string
  valuesEffect: (values: string[]) => string
  onChange: (values: string[]) => void
}

function TokenField({ label, helper, values, help, emptyEffect, valuesEffect, onChange }: TokensFieldProps) {
  const [draft, setDraft] = useState('')
  const addValue = () => {
    const nextValue = draft.trim()
    if (!nextValue || values.includes(nextValue)) return
    onChange([...values, nextValue])
    setDraft('')
  }

  return (
    <div className="field">
      <FieldLabel label={label} help={help} />
      <p className="field-helper">{helper}</p>
      {values.length > 0 && (
        <div className="token-list" aria-label={label}>
          {values.map((value) => (
            <span className="token" key={value}>
              {value}
              <button
                type="button"
                aria-label={`Eliminar ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="inline-add">
        <input
          value={draft}
          placeholder="Añadir elemento"
          aria-label={`Añadir a ${label}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addValue()
            }
          }}
        />
        <button className="icon-button" type="button" aria-label={`Añadir a ${label}`} onClick={addValue}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
      <FieldEffect>{values.length > 0 ? valuesEffect(values) : emptyEffect}</FieldEffect>
    </div>
  )
}

const inheritedValue = '__inherited__'

function InheritanceNote({ source }: { source: string }) {
  return <p className="inheritance-note">Heredado de {source}</p>
}

function InheritedSelect<T extends string>({
  id,
  label,
  help,
  value,
  effective,
  source,
  options,
  onChange,
}: {
  id: string
  label: string
  help: HelpContent
  value: T | undefined
  effective: T
  source: string
  options: { value: T; label: string }[]
  onChange: (value: T | undefined) => void
}) {
  return (
    <div className="field">
      <FieldLabel htmlFor={id} label={label} help={help} />
      <select id={id} value={value ?? inheritedValue} onChange={(event) => onChange(event.target.value === inheritedValue ? undefined : event.target.value as T)}>
        <option value={inheritedValue}>Usar {source}: {options.find((option) => option.value === effective)?.label ?? effective}</option>
        {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
      {value === undefined ? <InheritanceNote source={source} /> : <FieldEffect>Configurado explícitamente en este nivel.</FieldEffect>}
    </div>
  )
}

function InheritedTextField({
  id,
  label,
  help,
  value,
  effective,
  source,
  onChange,
}: {
  id: string
  label: string
  help: HelpContent
  value: string | undefined
  effective: string
  source: string
  onChange: (value: string | undefined) => void
}) {
  return (
    <div className="field">
      <FieldLabel htmlFor={id} label={label} help={help} />
      <input id={id} value={value ?? ''} placeholder={`Heredado: ${effective}`} onChange={(event) => onChange(event.target.value.trim() ? event.target.value : undefined)} />
      {value === undefined ? <InheritanceNote source={source} /> : <button className="link-button" type="button" onClick={() => onChange(undefined)}>Volver a heredar ({effective})</button>}
    </div>
  )
}

function StepInspector({ workflow, step, onChange, onDuplicate, onDelete, skillCatalog, onReloadSkills, canReloadSkills }: {
  workflow: WorkflowRecipe
  step: WorkflowStep
  onChange: (update: (current: WorkflowStep) => WorkflowStep) => void
  onDuplicate: () => void
  onDelete: () => void
  skillCatalog: SkillCatalog | null
  onReloadSkills: () => void
  canReloadSkills: boolean
}) {
  const updateSkill = (index: number, patch: Partial<SkillBinding>) => onChange((current) => ({
    ...current,
    skills: current.skills.map((skill, skillIndex) => skillIndex === index ? { ...skill, ...patch } : skill),
  }))
  const stepIndex = workflow.steps.findIndex((candidate) => candidate.id === step.id)
  const laterSteps = workflow.steps.slice(stepIndex + 1)
  const resolved = resolveStep(workflow, step)
  const rootDelegationSource = workflow.default_delegation === undefined ? 'el default del orquestador' : 'los valores del workflow'
  const rootBlockedSource = workflow.default_on_blocked === undefined ? 'el default del orquestador' : 'los valores del workflow'
  const catalogOptions = skillCatalogOptions(skillCatalog)

  return (
    <div className="inspector-form">
      <section className="field-group">
        <div className="field-group-header"><h3>Nombre de etapa</h3></div>
        <div className="field">
          <FieldLabel htmlFor="step-id" label="Nombre" help={fieldHelp.stepId} />
          <input id="step-id" value={step.id} onChange={(event) => onChange((current) => ({ ...current, id: event.target.value }))} />
          <FieldEffect>{step.id.trim() ? `La etapa se exportará con el identificador “${step.id}”.` : 'Escribe un identificador único para esta etapa.'}</FieldEffect>
        </div>
      </section>

      <section className="field-group">
        <div className="field-group-header">
          <h3>Skills</h3>
          <div className="skill-section-actions">
            <button className="button button-secondary button-small button-refresh-skills" type="button" onClick={onReloadSkills} disabled={!canReloadSkills} aria-label="Actualizar Skills locales desde el catálogo" title="Recargar las Skills locales desde skill-catalog.json">
              Actualizar Skills
            </button>
            <button className="button button-secondary button-small" type="button" onClick={() => onChange((current) => ({ ...current, skills: [...current.skills, { name: catalogOptions[0]?.name ?? 'new-skill', role: 'primary' }] }))}>
              <Plus size={14} aria-hidden="true" /> Añadir
            </button>
          </div>
        </div>
        <p className="field-helper">Indica las Skills que participan en esta etapa. Sus opciones poco frecuentes están disponibles al desplegar cada una.</p>
        {step.skills.length === 0 ? <div className="empty-skills">Aún no has añadido ninguna Skill a esta etapa.</div> : step.skills.map((skill, index) => {
          const skillResolved = resolveSkill(workflow, step, skill)
          const invocationSource = workflow.default_invocation === undefined ? 'el default del orquestador' : 'los valores del workflow'
          return (
            <div className="skill-row" key={`${skill.name}-${index}`}>
              <div className="skill-row-top"><span>Skill {index + 1}</span><button className="icon-button remove-skill" type="button" aria-label={`Eliminar Skill ${skill.name}`} onClick={() => onChange((current) => ({ ...current, skills: current.skills.filter((_, skillIndex) => skillIndex !== index) }))}><Trash2 size={14} aria-hidden="true" /></button></div>
              <div className="field"><FieldLabel htmlFor={`skill-name-${index}`} label="Nombre" help={fieldHelp.skillName} />{catalogOptions.length > 0 ? <select id={`skill-name-${index}`} value={skill.name} onChange={(event) => updateSkill(index, { name: event.target.value })} aria-label={`Nombre de la Skill ${index + 1} desde el catálogo local`}><option value="" disabled>Selecciona una Skill</option>{skill.name && !catalogOptions.some((option) => option.name === skill.name) && <option value={skill.name}>{skill.name} — No incluida en el catálogo actual</option>}{catalogOptions.map((option) => <option key={`${option.origin}:${option.name}`} value={option.name}>{option.name} — {option.description}</option>)}</select> : <input id={`skill-name-${index}`} value={skill.name} onChange={(event) => updateSkill(index, { name: event.target.value })} />}<FieldEffect>{catalogOptions.length > 0 ? 'Selecciona una Skill del catálogo local; el nombre se guardará en la receta.' : skill.name.trim() ? `Buscará la Skill local “${skill.name}”.` : 'Escribe el nombre exacto de una Skill local disponible.'}</FieldEffect></div>
              <div className="field"><FieldLabel htmlFor={`skill-role-${index}`} label="Papel" help={fieldHelp.skillRole} /><select id={`skill-role-${index}`} value={skill.role} onChange={(event) => updateSkill(index, { role: event.target.value as SkillRole })}><option value="primary">Principal</option><option value="supporting">Apoyo</option><option value="review">Revisión</option><option value="fallback">Respaldo</option></select></div>
              <details className="advanced-disclosure">
                <summary>Opciones de esta Skill</summary>
                <InheritedSelect id={`skill-required-${index}`} label="Participación" help={fieldHelp.skillRole} value={skill.required === undefined ? undefined : String(skill.required) as 'true' | 'false'} effective={String(skillResolved.required) as 'true' | 'false'} source="el default del orquestador" options={[{ value: 'true', label: 'Obligatoria' }, { value: 'false', label: 'Opcional' }]} onChange={(value) => updateSkill(index, { required: value === undefined ? undefined : value === 'true' })} />
                <InheritedSelect id={`skill-invocation-${index}`} label="Aplicación" help={fieldHelp.skillInvocation} value={skill.invocation} effective={skillResolved.invocation} source={invocationSource} options={[{ value: 'compose', label: 'Componer en el workflow' }, { value: 'user_explicit', label: 'Requiere al usuario' }, { value: 'host_permitted', label: 'Si el cliente lo permite' }]} onChange={(invocation) => updateSkill(index, { invocation })} />
                <InheritedTextField id={`skill-model-${index}`} label="Modelo" help={fieldHelp.model} value={skill.model} effective={skillResolved.model} source="la etapa o el workflow" onChange={(model) => updateSkill(index, { model })} />
                <InheritedTextField id={`skill-reasoning-${index}`} label="Razonamiento" help={fieldHelp.reasoning} value={skill.reasoning_effort} effective={skillResolved.reasoning_effort} source="la etapa o el workflow" onChange={(reasoning_effort) => updateSkill(index, { reasoning_effort })} />
                <div className="two-fields"><div className="field"><FieldLabel htmlFor={`skill-artifact-${index}`} label="Artefacto" help={fieldHelp.outputs} /><input id={`skill-artifact-${index}`} value={skill.artifact ?? ''} onChange={(event) => updateSkill(index, { artifact: event.target.value.trim() || undefined })} /></div><div className="field"><FieldLabel htmlFor={`skill-output-${index}`} label="Archivo de salida" help={fieldHelp.artifactRoot} /><input id={`skill-output-${index}`} value={skill.output_file ?? ''} onChange={(event) => updateSkill(index, { output_file: event.target.value.trim() || undefined })} /></div></div>
                <InheritedSelect id={`skill-on-exists-${index}`} label="Si ya existe el archivo" help={fieldHelp.onExists} value={skill.on_exists} effective={skillResolved.on_exists} source="el default del orquestador" options={[{ value: 'fail', label: 'Falla' }, { value: 'overwrite', label: 'Sobrescribe' }, { value: 'version', label: 'Crea una versión' }]} onChange={(on_exists) => updateSkill(index, { on_exists })} />
              </details>
            </div>
          )
        })}
      </section>

      <section className="field-group">
        <div className="field-group-header"><h3>Comportamiento</h3></div>
        <div className="two-fields">
          <InheritedSelect id="execution" label="Ejecución" help={fieldHelp.execution} value={step.execution} effective={resolved.execution} source="el default del orquestador" options={[{ value: 'sequential', label: 'En orden' }, { value: 'parallel', label: 'En paralelo' }]} onChange={(execution) => onChange((current) => ({ ...current, execution }))} />
          <InheritedSelect id="completion" label="Finaliza cuando" help={fieldHelp.completion} value={step.completion} effective={resolved.completion} source="el default del orquestador" options={[{ value: 'all_required', label: 'Terminan todas' }, { value: 'any_success', label: 'Termina una correctamente' }]} onChange={(completion) => onChange((current) => ({ ...current, completion }))} />
        </div>
        <div className="field"><FieldLabel htmlFor="next-step" label="Siguiente etapa" help={fieldHelp.nextStep} /><select id="next-step" value={step.on_success} onChange={(event) => onChange((current) => ({ ...current, on_success: event.target.value }))}><option value="complete">Completar el workflow</option>{laterSteps.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.id}</option>)}</select><FieldEffect>{step.on_success === 'complete' ? 'Esta etapa terminará el workflow.' : `Después continuará en la etapa “${step.on_success}”.`}</FieldEffect></div>
      </section>

      <details className="advanced-section">
        <summary>Ajustes avanzados</summary>
        <div className="advanced-section-content">
          <div className="two-fields">
            <InheritedSelect id="delegation" label="Quién la realiza" help={fieldHelp.delegation} value={step.delegation} effective={resolved.delegation} source={rootDelegationSource} options={[{ value: 'inline', label: 'Agente actual' }, { value: 'subagent', label: 'Subagente' }, { value: 'auto', label: 'Decide el cliente' }]} onChange={(delegation) => onChange((current) => ({ ...current, delegation }))} />
            <InheritedSelect id="blocked" label="Si se bloquea" help={fieldHelp.onBlocked} value={step.on_blocked} effective={resolved.on_blocked} source={rootBlockedSource} options={[{ value: 'ask_user', label: 'Pide ayuda' }, { value: 'stop', label: 'Detiene el flujo' }]} onChange={(on_blocked) => onChange((current) => ({ ...current, on_blocked }))} />
          </div>
          <InheritedTextField id="step-model" label="Modelo" help={fieldHelp.model} value={step.model} effective={resolved.model} source={workflow.model === undefined ? 'el default del orquestador' : 'los valores del workflow'} onChange={(model) => onChange((current) => ({ ...current, model }))} />
          <InheritedTextField id="step-reasoning" label="Razonamiento" help={fieldHelp.reasoning} value={step.reasoning_effort} effective={resolved.reasoning_effort} source={workflow.reasoning_effort === undefined ? 'el default del orquestador' : 'los valores del workflow'} onChange={(reasoning_effort) => onChange((current) => ({ ...current, reasoning_effort }))} />
          <TokenField label="Entradas" helper="Resultados que esta etapa necesita recibir." help={fieldHelp.inputs} values={resolved.inputs} emptyEffect="Esta etapa no necesita artefactos de etapas anteriores." valuesEffect={(values) => `Usará ${values.length === 1 ? 'el artefacto' : 'los artefactos'} ${values.map((value) => `“${value}”`).join(', ')}.`} onChange={(inputs) => onChange((current) => ({ ...current, inputs }))} />
          <TokenField label="Salidas" helper="Resultados que esta etapa deja preparados para las siguientes." help={fieldHelp.outputs} values={resolved.outputs} emptyEffect="Esta etapa no declara artefactos de salida." valuesEffect={(values) => `Declarará ${values.length === 1 ? 'el artefacto' : 'los artefactos'} ${values.map((value) => `“${value}”`).join(', ')} como salida.`} onChange={(outputs) => onChange((current) => ({ ...current, outputs }))} />
        </div>
      </details>

      <div className="inspector-actions"><button className="button button-secondary" type="button" onClick={onDuplicate}><Copy size={15} aria-hidden="true" /> Duplicar</button><button className="button button-danger" type="button" onClick={onDelete}><Trash2 size={15} aria-hidden="true" /> Eliminar</button></div>
    </div>
  )
}

function WorkflowInspector({ workflow, validationIssues, onChange }: { workflow: WorkflowRecipe; validationIssues: string[]; onChange: (change: Partial<WorkflowRecipe>) => void }) {
  return (
    <div className="inspector-form">
      <section className="field-group"><div className="field-group-header"><h3>Workflow</h3></div><div className="field"><FieldLabel htmlFor="workflow-id" label="Nombre" help={fieldHelp.workflowId} /><input id="workflow-id" value={workflow.id} onChange={(event) => onChange({ id: event.target.value })} /></div><div className="field"><FieldLabel htmlFor="artifact-root" label="Carpeta de resultados" help={fieldHelp.artifactRoot} /><input id="artifact-root" value={workflow.artifact_root} onChange={(event) => onChange({ artifact_root: event.target.value })} /></div></section>
      <details className="advanced-section"><summary>Valores por defecto del workflow</summary><div className="advanced-section-content"><InheritedTextField id="workflow-model" label="Modelo" help={fieldHelp.model} value={workflow.model} effective={orchestratorDefaults.model} source="el default del orquestador" onChange={(model) => onChange({ model })} /><InheritedTextField id="reasoning-effort" label="Razonamiento" help={fieldHelp.reasoning} value={workflow.reasoning_effort} effective={orchestratorDefaults.reasoning_effort} source="el default del orquestador" onChange={(reasoning_effort) => onChange({ reasoning_effort })} /><InheritedSelect id="default-delegation" label="Delegación" help={fieldHelp.defaultDelegation} value={workflow.default_delegation} effective={orchestratorDefaults.delegation} source="el default del orquestador" options={[{ value: 'inline', label: 'Agente actual' }, { value: 'subagent', label: 'Subagente' }, { value: 'auto', label: 'Decide el cliente' }]} onChange={(default_delegation) => onChange({ default_delegation })} /><InheritedSelect id="default-blocked" label="Si se bloquea" help={fieldHelp.onBlocked} value={workflow.default_on_blocked} effective={orchestratorDefaults.on_blocked} source="el default del orquestador" options={[{ value: 'ask_user', label: 'Pide ayuda' }, { value: 'stop', label: 'Detiene el flujo' }]} onChange={(default_on_blocked) => onChange({ default_on_blocked })} /><InheritedSelect id="default-invocation" label="Aplicación de Skills" help={fieldHelp.defaultInvocation} value={workflow.default_invocation} effective={orchestratorDefaults.invocation} source="el default del orquestador" options={[{ value: 'compose', label: 'Componer en el workflow' }, { value: 'user_explicit', label: 'Requiere al usuario' }, { value: 'host_permitted', label: 'Si el cliente lo permite' }]} onChange={(default_invocation) => onChange({ default_invocation })} /></div></details>
      <section className="field-group"><div className="field-group-header"><h3>Estado</h3></div><div className="workflow-settings-note">El YAML sigue siendo el formato de origen: los valores heredados no se escribirán hasta que los configures explícitamente.</div>{validationIssues.length > 0 && <ul className="validation-list" aria-label="Avisos de validación">{validationIssues.map((issue) => <li key={issue}>• {issue}</li>)}</ul>}</section>
    </div>
  )
}

export function Inspector({ workflow, selectedStep, validationIssues, onWorkflowChange, onStepChange, onDuplicateStep, onDeleteStep, skillCatalog, onReloadSkills, canReloadSkills }: InspectorProps) {
  if (!selectedStep) return <WorkflowInspector workflow={workflow} validationIssues={validationIssues} onChange={onWorkflowChange} />
  return <StepInspector workflow={workflow} step={selectedStep} onChange={(update) => onStepChange(selectedStep.id, update)} onDuplicate={() => onDuplicateStep(selectedStep.id)} onDelete={() => onDeleteStep(selectedStep.id)} skillCatalog={skillCatalog} onReloadSkills={onReloadSkills} canReloadSkills={canReloadSkills} />
}
