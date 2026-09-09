import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { WorkflowRecipe, WorkflowStep } from '../types'
import { artifactIdForStep, artifactPathForStep, resolveStep } from '../workflow'

export interface WorkflowNodeData {
  [key: string]: unknown
  step: WorkflowStep
  workflow: WorkflowRecipe
  index: number
  isSelected: boolean
  activeSourceHandle?: string
  activeTargetHandles: string[]
}

function conciseList(values: string[]): string {
  if (values.length === 0) return 'Sin definir'
  if (values.length === 1) return values[0]
  return `${values[0]} +${values.length - 1}`
}

export function WorkflowNode({ data }: NodeProps) {
  const nodeData = data as WorkflowNodeData
  const { step, workflow, index, isSelected, activeSourceHandle, activeTargetHandles } = nodeData
  const resolved = resolveStep(workflow, step)
  const artifactId = artifactIdForStep(step)
  const artifactPath = artifactPathForStep(step)
  const targetClass = (handleId: string) =>
    `workflow-handle workflow-handle-target${activeTargetHandles.includes(handleId) ? ' is-active' : ''}`
  const sourceClass = (handleId: string) =>
    `workflow-handle workflow-handle-source${activeSourceHandle === handleId ? ' is-active' : ''}`

  return (
    <article className={`workflow-node ${isSelected ? 'is-selected' : ''}`}>
      <Handle className={targetClass('top-target')} id="top-target" type="target" position={Position.Top} aria-label={`Entrada superior de ${step.id}`} />
      <Handle className={targetClass('right-target')} id="right-target" type="target" position={Position.Right} aria-label={`Entrada derecha de ${step.id}`} />
      <Handle className={targetClass('bottom-target')} id="bottom-target" type="target" position={Position.Bottom} aria-label={`Entrada inferior de ${step.id}`} />
      <Handle className={targetClass('left-target')} id="left-target" type="target" position={Position.Left} aria-label={`Entrada izquierda de ${step.id}`} />
      <div className="workflow-node-head">
        <span className="node-index">{index + 1}</span>
        <div>
          <h3>{step.id}</h3>
          <p className="node-meta">{resolved.delegation === 'subagent' ? 'Subagente' : resolved.delegation === 'auto' ? 'Decide el cliente' : 'Agente actual'}</p>
        </div>
      </div>

      <div className="node-skills">
        {step.skills.length > 0 ? step.skills.map((skill) => (
          <span className="skill-chip" key={`${skill.name}-${skill.role}`}>{skill.name}</span>
        )) : <span className="skill-chip empty">Sin Skills</span>}
      </div>

      <div className="node-io">
        <div>
          <span>RECIBE</span>
          <strong title={resolved.inputs.join(', ')}>{conciseList(resolved.inputs)}</strong>
        </div>
        <div>
          <span>PRODUCE</span>
          <strong title={artifactPath}>{artifactId}</strong>
        </div>
      </div>
      <Handle className={sourceClass('top-source')} id="top-source" type="source" position={Position.Top} aria-label={`Salida superior de ${step.id}`} />
      <Handle className={sourceClass('right-source')} id="right-source" type="source" position={Position.Right} aria-label={`Salida derecha de ${step.id}`} />
      <Handle className={sourceClass('bottom-source')} id="bottom-source" type="source" position={Position.Bottom} aria-label={`Salida inferior de ${step.id}`} />
      <Handle className={sourceClass('left-source')} id="left-source" type="source" position={Position.Left} aria-label={`Salida izquierda de ${step.id}`} />
    </article>
  )
}
