import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Info, Plus, Trash2, X } from 'lucide-react'
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
} from '../types'

interface InspectorProps {
  workflow: WorkflowRecipe
  selectedStep: WorkflowStep | null
  validationIssues: string[]
  onWorkflowChange: (change: Partial<WorkflowRecipe>) => void
  onStepChange: (id: string, update: (step: WorkflowStep) => WorkflowStep) => void
  onDuplicateStep: (id: string) => void
  onDeleteStep: (id: string) => void
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

  const close = () => {
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!isOpen) return undefined

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('keydown', closeOnEscape)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', closeOnEscape)
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
            <button ref={closeRef} type="button" className="field-help-close" aria-label={`Cerrar ayuda sobre ${content.title}`} onClick={close}>
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

function describeHostIntent(value: string, kind: 'model' | 'reasoning') {
  if (value === 'inherit') {
    return kind === 'model'
      ? 'No fija el modelo aquí; el cliente resolverá el valor heredado.'
      : 'No fija el razonamiento aquí; el cliente resolverá el valor heredado.'
  }

  if (value === 'host_default') {
    return kind === 'model'
      ? 'Usará el modelo predeterminado del cliente.'
      : 'Usará el razonamiento predeterminado del cliente.'
  }

  return value.trim()
    ? `Solicita “${value}”; el cliente debe admitir ese valor.`
    : 'Escribe inherit, host_default o un valor válido para el cliente.'
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

function StepInspector({
  workflow,
  step,
  onChange,
  onDuplicate,
  onDelete,
}: {
  workflow: WorkflowRecipe
  step: WorkflowStep
  onChange: (update: (current: WorkflowStep) => WorkflowStep) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const updateSkill = (index: number, patch: Partial<SkillBinding>) => {
    onChange((current) => ({
      ...current,
      skills: current.skills.map((skill, skillIndex) =>
        skillIndex === index ? { ...skill, ...patch } : skill,
      ),
    }))
  }
  const stepIndex = workflow.steps.findIndex((candidate) => candidate.id === step.id)
  const laterSteps = workflow.steps.slice(stepIndex + 1)

  return (
    <div className="inspector-form">
      <section className="field-group">
        <div className="field-group-header"><h3>Identidad</h3></div>
        <div className="field">
          <FieldLabel htmlFor="step-id" label="Nombre de la etapa" help={fieldHelp.stepId} />
          <input
            id="step-id"
            value={step.id}
            onChange={(event) => onChange((current) => ({ ...current, id: event.target.value }))}
          />
          <FieldEffect>{step.id.trim() ? `La etapa se exportará con el identificador “${step.id}”.` : 'Escribe un identificador único para esta etapa.'}</FieldEffect>
        </div>
      </section>

      <section className="field-group">
        <div className="field-group-header"><h3>Comportamiento</h3></div>
        <div className="two-fields">
          <div className="field">
            <FieldLabel htmlFor="execution" label="Ejecución" help={fieldHelp.execution} />
            <select
              id="execution"
              value={step.execution}
              onChange={(event) => onChange((current) => ({ ...current, execution: event.target.value as ExecutionMode }))}
            >
              <option value="sequential">En orden</option>
              <option value="parallel">En paralelo</option>
            </select>
            <FieldEffect>{step.execution === 'sequential' ? 'Las Skills se aplicarán una detrás de otra.' : 'Las Skills podrán iniciarse a la vez si el cliente lo permite.'}</FieldEffect>
          </div>
          <div className="field">
            <FieldLabel htmlFor="completion" label="Finaliza cuando" help={fieldHelp.completion} />
            <select
              id="completion"
              value={step.completion}
              onChange={(event) => onChange((current) => ({ ...current, completion: event.target.value as CompletionMode }))}
            >
              <option value="all_required">Terminan todas</option>
              <option value="any_success">Termina una correctamente</option>
            </select>
            <FieldEffect>{step.completion === 'all_required' ? 'No avanzará hasta que terminen todas las Skills obligatorias.' : 'Avanzará cuando una Skill obligatoria termine correctamente.'}</FieldEffect>
          </div>
        </div>
        <div className="two-fields">
          <div className="field">
            <FieldLabel htmlFor="delegation" label="Quién la realiza" help={fieldHelp.delegation} />
            <select
              id="delegation"
              value={step.delegation}
              onChange={(event) => onChange((current) => ({ ...current, delegation: event.target.value as DelegationMode }))}
            >
              <option value="inline">Agente actual</option>
              <option value="subagent">Subagente</option>
              <option value="auto">Decide el cliente</option>
            </select>
            <FieldEffect>{step.delegation === 'inline' ? 'La realizará el agente actual.' : step.delegation === 'subagent' ? 'Se pedirá delegarla en un subagente.' : 'El cliente decidirá cómo realizarla.'}</FieldEffect>
          </div>
          <div className="field">
            <FieldLabel htmlFor="blocked" label="Si se bloquea" help={fieldHelp.onBlocked} />
            <select
              id="blocked"
              value={step.on_blocked}
              onChange={(event) => onChange((current) => ({ ...current, on_blocked: event.target.value as OnBlocked }))}
            >
              <option value="ask_user">Pide ayuda</option>
              <option value="stop">Detiene el flujo</option>
            </select>
            <FieldEffect>{step.on_blocked === 'ask_user' ? 'Guardará el estado y pedirá lo que falta.' : 'Detendrá el workflow cuando no pueda continuar.'}</FieldEffect>
          </div>
        </div>
      </section>

      <section className="field-group">
        <div className="field-group-header"><h3>Datos</h3></div>
        <TokenField
          label="Entradas"
          helper="Resultados que esta etapa necesita recibir."
          help={fieldHelp.inputs}
          values={step.inputs}
          emptyEffect="Esta etapa no necesita artefactos de etapas anteriores."
          valuesEffect={(values) => `Usará ${values.length === 1 ? 'el artefacto' : 'los artefactos'} ${values.map((value) => `“${value}”`).join(', ')}.`}
          onChange={(inputs) => onChange((current) => ({ ...current, inputs }))}
        />
        <TokenField
          label="Salidas"
          helper="Resultados que esta etapa deja preparados para las siguientes."
          help={fieldHelp.outputs}
          values={step.outputs}
          emptyEffect="Esta etapa no declara artefactos de salida."
          valuesEffect={(values) => `Declarará ${values.length === 1 ? 'el artefacto' : 'los artefactos'} ${values.map((value) => `“${value}”`).join(', ')} como salida.`}
          onChange={(outputs) => onChange((current) => ({ ...current, outputs }))}
        />
      </section>

      <section className="field-group">
        <div className="field-group-header">
          <h3>Skills</h3>
          <button
            className="button button-secondary button-small"
            type="button"
            onClick={() => onChange((current) => ({
              ...current,
              skills: [...current.skills, { name: 'new-skill', role: 'primary', required: true, invocation: 'compose' }],
            }))}
          >
            <Plus size={14} aria-hidden="true" /> Añadir
          </button>
        </div>
        <p className="field-helper">Las Skills ya existen; aquí solo indicas cuáles deben participar en esta etapa.</p>
        {step.skills.length === 0 ? (
          <div className="empty-skills">Aún no has añadido ninguna Skill a esta etapa.</div>
        ) : (
          step.skills.map((skill, index) => (
            <div className="skill-row" key={`${skill.name}-${index}`}>
              <div className="skill-row-top">
                <span>Skill {index + 1}</span>
                <button
                  className="icon-button remove-skill"
                  type="button"
                  aria-label={`Eliminar Skill ${skill.name}`}
                  onClick={() => onChange((current) => ({
                    ...current,
                    skills: current.skills.filter((_, skillIndex) => skillIndex !== index),
                  }))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              <div className="field">
                <FieldLabel htmlFor={`skill-name-${index}`} label="Nombre" help={fieldHelp.skillName} />
                <input
                  id={`skill-name-${index}`}
                  value={skill.name}
                  onChange={(event) => updateSkill(index, { name: event.target.value })}
                />
                <FieldEffect>{skill.name.trim() ? `Buscará la Skill local “${skill.name}”.` : 'Escribe el nombre exacto de una Skill local disponible.'}</FieldEffect>
              </div>
              <div className="field">
                <FieldLabel htmlFor={`skill-role-${index}`} label="Papel" help={fieldHelp.skillRole} />
                <select
                  id={`skill-role-${index}`}
                  value={skill.role}
                  onChange={(event) => updateSkill(index, { role: event.target.value as SkillRole })}
                >
                  <option value="primary">Principal</option>
                  <option value="supporting">Apoyo</option>
                  <option value="review">Revisión</option>
                  <option value="fallback">Respaldo</option>
                </select>
                <FieldEffect>{skill.role === 'primary' ? 'Realizará el trabajo principal de esta etapa.' : skill.role === 'supporting' ? 'Aportará trabajo de apoyo al resultado principal.' : skill.role === 'review' ? 'Revisará el resultado de las demás Skills.' : 'Solo podrá usarse como alternativa de respaldo en una etapa en orden.'}</FieldEffect>
              </div>
              <div className="field">
                <FieldLabel htmlFor={`skill-invocation-${index}`} label="Aplicación" help={fieldHelp.skillInvocation} />
                <select
                  id={`skill-invocation-${index}`}
                  value={skill.invocation ?? workflow.default_invocation}
                  onChange={(event) => updateSkill(index, { invocation: event.target.value as InvocationMode })}
                >
                  <option value="compose">Componer en el workflow</option>
                  <option value="user_explicit">Requiere al usuario</option>
                  <option value="host_permitted">Si el cliente lo permite</option>
                </select>
                <FieldEffect>{(skill.invocation ?? workflow.default_invocation) === 'compose' ? 'El workflow aplicará sus instrucciones en el contexto activo.' : (skill.invocation ?? workflow.default_invocation) === 'user_explicit' ? 'El workflow se detendrá hasta que el usuario la invoque.' : 'Solo se aplicará si el cliente confirma que admite esta invocación.'}</FieldEffect>
              </div>
              <div className="field">
                <FieldLabel htmlFor={`skill-on-exists-${index}`} label="Si ya existe el archivo" help={fieldHelp.onExists} />
                <select
                  id={`skill-on-exists-${index}`}
                  value={skill.on_exists ?? 'fail'}
                  onChange={(event) => updateSkill(index, { on_exists: event.target.value as OnExistsMode })}
                >
                  <option value="fail">Falla</option>
                  <option value="overwrite">Sobrescribe</option>
                  <option value="version">Crea una versión</option>
                </select>
                <FieldEffect>{(skill.on_exists ?? 'fail') === 'fail' ? 'No sobrescribirá un archivo existente.' : (skill.on_exists ?? 'fail') === 'overwrite' ? 'Sobrescribirá solo un artefacto que esta Skill posea.' : 'Registrará una ruta distinta para conservar la versión anterior.'}</FieldEffect>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="field-group">
        <div className="field-group-header"><h3>Siguiente etapa</h3></div>
        <div className="field">
          <FieldLabel htmlFor="next-step" label="Cuando termine correctamente" help={fieldHelp.nextStep} />
          <select
            id="next-step"
            value={step.on_success}
            onChange={(event) => onChange((current) => ({ ...current, on_success: event.target.value }))}
          >
            <option value="complete">Completar el workflow</option>
            {laterSteps.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>{candidate.id}</option>
            ))}
          </select>
          <FieldEffect>{step.on_success === 'complete' ? 'Esta etapa terminará el workflow.' : `Después continuará en la etapa “${step.on_success}”.`}</FieldEffect>
        </div>
      </section>

      <div className="inspector-actions">
        <button className="button button-secondary" type="button" onClick={onDuplicate}>
          <Copy size={15} aria-hidden="true" /> Duplicar
        </button>
        <button className="button button-danger" type="button" onClick={onDelete}>
          <Trash2 size={15} aria-hidden="true" /> Eliminar
        </button>
      </div>
    </div>
  )
}

function WorkflowInspector({ workflow, validationIssues, onChange }: {
  workflow: WorkflowRecipe
  validationIssues: string[]
  onChange: (change: Partial<WorkflowRecipe>) => void
}) {
  return (
    <div className="inspector-form">
      <section className="field-group">
        <div className="field-group-header"><h3>Workflow</h3></div>
        <div className="field">
          <FieldLabel htmlFor="workflow-id" label="Nombre" help={fieldHelp.workflowId} />
          <input id="workflow-id" value={workflow.id} onChange={(event) => onChange({ id: event.target.value })} />
          <FieldEffect>{workflow.id.trim() ? `El YAML se exportará con el identificador “${workflow.id}”.` : 'Escribe un identificador estable para el workflow.'}</FieldEffect>
        </div>
        <div className="field">
          <FieldLabel htmlFor="artifact-root" label="Carpeta de resultados" help={fieldHelp.artifactRoot} />
          <input id="artifact-root" value={workflow.artifact_root} onChange={(event) => onChange({ artifact_root: event.target.value })} />
          <FieldEffect>{workflow.artifact_root.trim() ? `Los artefactos se esperan bajo “${workflow.artifact_root}”.` : 'Indica una ruta relativa al proyecto para los artefactos.'}</FieldEffect>
        </div>
      </section>

      <section className="field-group">
        <div className="field-group-header"><h3>Valores por defecto</h3></div>
        <div className="field">
          <FieldLabel htmlFor="workflow-model" label="Modelo" help={fieldHelp.model} />
          <input id="workflow-model" value={workflow.model} onChange={(event) => onChange({ model: event.target.value })} />
          <FieldEffect>{describeHostIntent(workflow.model, 'model')}</FieldEffect>
        </div>
        <div className="field">
          <FieldLabel htmlFor="reasoning-effort" label="Razonamiento" help={fieldHelp.reasoning} />
          <input id="reasoning-effort" value={workflow.reasoning_effort} onChange={(event) => onChange({ reasoning_effort: event.target.value })} />
          <FieldEffect>{describeHostIntent(workflow.reasoning_effort, 'reasoning')}</FieldEffect>
        </div>
        <div className="two-fields">
          <div className="field">
            <FieldLabel htmlFor="default-delegation" label="Delegación" help={fieldHelp.defaultDelegation} />
            <select id="default-delegation" value={workflow.default_delegation} onChange={(event) => onChange({ default_delegation: event.target.value as DelegationMode })}>
              <option value="inline">Agente actual</option>
              <option value="subagent">Subagente</option>
              <option value="auto">Decide el cliente</option>
            </select>
            <FieldEffect>{workflow.default_delegation === 'inline' ? 'Las etapas sin ajuste propio las realizará el agente actual.' : workflow.default_delegation === 'subagent' ? 'Las etapas sin ajuste propio pedirán un subagente.' : 'El cliente decidirá la delegación de cada etapa sin ajuste propio.'}</FieldEffect>
          </div>
          <div className="field">
            <FieldLabel htmlFor="default-blocked" label="Si se bloquea" help={fieldHelp.onBlocked} />
            <select id="default-blocked" value={workflow.default_on_blocked} onChange={(event) => onChange({ default_on_blocked: event.target.value as OnBlocked })}>
              <option value="ask_user">Pide ayuda</option>
              <option value="stop">Detiene el flujo</option>
            </select>
            <FieldEffect>{workflow.default_on_blocked === 'ask_user' ? 'Las etapas sin ajuste propio pedirán al usuario lo que falte.' : 'Las etapas sin ajuste propio detendrán el workflow.'}</FieldEffect>
          </div>
        </div>
        <div className="field">
          <FieldLabel htmlFor="default-invocation" label="Aplicación de Skills" help={fieldHelp.defaultInvocation} />
          <select id="default-invocation" value={workflow.default_invocation} onChange={(event) => onChange({ default_invocation: event.target.value as InvocationMode })}>
            <option value="compose">Componer en el workflow</option>
            <option value="user_explicit">Requiere al usuario</option>
            <option value="host_permitted">Si el cliente lo permite</option>
          </select>
          <FieldEffect>{workflow.default_invocation === 'compose' ? 'Las Skills sin ajuste propio se aplicarán dentro del workflow.' : workflow.default_invocation === 'user_explicit' ? 'Las Skills sin ajuste propio requerirán una acción del usuario.' : 'Las Skills sin ajuste propio dependerán de que el cliente admita la invocación.'}</FieldEffect>
        </div>
      </section>

      <section className="field-group">
        <div className="field-group-header"><h3>Estado</h3></div>
        <div className="workflow-settings-note">
          Al hacer clic en una etapa del diagrama volverás a editar sus opciones. El YAML sigue siendo el formato de origen: exporta el archivo cuando termines.
        </div>
        {validationIssues.length > 0 && (
          <ul className="validation-list" aria-label="Avisos de validación">
            {validationIssues.map((issue) => <li key={issue}>• {issue}</li>)}
          </ul>
        )}
      </section>
    </div>
  )
}

export function Inspector({
  workflow,
  selectedStep,
  validationIssues,
  onWorkflowChange,
  onStepChange,
  onDuplicateStep,
  onDeleteStep,
}: InspectorProps) {
  if (!selectedStep) {
    return <WorkflowInspector workflow={workflow} validationIssues={validationIssues} onChange={onWorkflowChange} />
  }

  return (
    <StepInspector
      workflow={workflow}
      step={selectedStep}
      onChange={(update) => onStepChange(selectedStep.id, update)}
      onDuplicate={() => onDuplicateStep(selectedStep.id)}
      onDelete={() => onDeleteStep(selectedStep.id)}
    />
  )
}
