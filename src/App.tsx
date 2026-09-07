import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  Position as FlowPosition,
  ReactFlow,
  type ReactFlowInstance,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Check,
  Download,
  FileOutput,
  Plus,
  Settings2,
  Upload,
  Workflow,
} from 'lucide-react'
import { stringify } from 'yaml'
import { Inspector } from './components/Inspector'
import { WorkflowNode, type WorkflowNodeData } from './components/WorkflowNode'
import {
  createEmptyStep,
  defaultWorkflow,
  nextAvailableId,
  validateWorkflow,
  workflowFromYaml,
} from './workflow'
import type { WorkflowRecipe, WorkflowStep } from './types'
import './App.css'

type Position = { x: number; y: number }
type HandleSide = 'top' | 'right' | 'bottom' | 'left'

const nodeTypes = { workflowStep: WorkflowNode }
const nodeWidth = 254
const estimatedNodeHeight = 160
const verticalStepGap = 76

const flowPositionBySide: Record<HandleSide, FlowPosition> = {
  top: FlowPosition.Top,
  right: FlowPosition.Right,
  bottom: FlowPosition.Bottom,
  left: FlowPosition.Left,
}

function getEdgeSides(source: Position, target: Position): {
  source: HandleSide
  target: HandleSide
} {
  const deltaX = target.x - source.x
  const deltaY = target.y - source.y

  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return deltaY >= 0
      ? { source: 'bottom', target: 'top' }
      : { source: 'top', target: 'bottom' }
  }

  return deltaX >= 0
    ? { source: 'right', target: 'left' }
    : { source: 'left', target: 'right' }
}

type StepPlacement = {
  position: Position
  shiftedPositions: Record<string, Position>
}

function positionBelow(
  parentId: string | undefined,
  positions: Record<string, Position>,
): StepPlacement {
  const parentPosition = parentId ? positions[parentId] : undefined
  const origin = parentPosition ?? { x: 0, y: 120 }
  const position = { x: origin.x, y: origin.y + estimatedNodeHeight + verticalStepGap }
  const rowHeight = estimatedNodeHeight + verticalStepGap
  const shiftedPositions = Object.fromEntries(
    Object.entries(positions)
      .filter(([, current]) =>
        Math.abs(current.x - position.x) < nodeWidth - 32 &&
        current.y >= position.y - estimatedNodeHeight / 2,
      )
      .map(([id, current]) => [id, { ...current, y: current.y + rowHeight }]),
  )

  return { position, shiftedPositions }
}

function initialPositions(recipe: WorkflowRecipe): Record<string, Position> {
  return Object.fromEntries(
    recipe.steps.map((step, index) => [
      step.id,
      { x: 0, y: 120 + index * (estimatedNodeHeight + verticalStepGap) },
    ]),
  )
}

function App() {
  const [workflow, setWorkflow] = useState<WorkflowRecipe>(defaultWorkflow)
  const [positions, setPositions] = useState<Record<string, Position>>(() =>
    initialPositions(defaultWorkflow),
  )
  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    defaultWorkflow.steps[0]?.id ?? null,
  )
  const [notice, setNotice] = useState('Cambios guardados en el modelo YAML')
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node<WorkflowNodeData>, Edge> | null>(null)

  const selectedStep =
    workflow.steps.find((step) => step.id === selectedStepId) ?? null
  const validationIssues = useMemo(() => validateWorkflow(workflow), [workflow])
  const serializedYaml = useMemo(() => stringify(workflow), [workflow])

  const nodes = useMemo<Node<WorkflowNodeData>[]>(
    () =>
      workflow.steps.map((step, index) => ({
        id: step.id,
        type: 'workflowStep',
        position: positions[step.id] ?? { x: index * 356, y: 160 },
        data: {
          step,
          isSelected: step.id === selectedStepId,
          index,
          activeSourceHandle: step.on_success && step.on_success !== 'complete'
            ? `${getEdgeSides(
                positions[step.id] ?? { x: 0, y: 0 },
                positions[step.on_success] ?? { x: 0, y: 0 },
              ).source}-source`
            : undefined,
          activeTargetHandles: workflow.steps
            .filter((candidate) => candidate.on_success === step.id)
            .map((candidate) => `${getEdgeSides(
              positions[candidate.id] ?? { x: 0, y: 0 },
              positions[step.id] ?? { x: 0, y: 0 },
            ).target}-target`),
        },
      })),
    [positions, selectedStepId, workflow.steps],
  )

  const edges = useMemo<Edge[]>(
    () =>
      workflow.steps.flatMap((step) => {
        if (
          !step.on_success ||
          step.on_success === 'complete' ||
          !workflow.steps.some((candidate) => candidate.id === step.on_success)
        ) {
          return []
        }

        const sourcePosition = positions[step.id] ?? { x: 0, y: 0 }
        const targetPosition = positions[step.on_success] ?? { x: 0, y: 0 }
        const sides = getEdgeSides(sourcePosition, targetPosition)

        return [
          {
            id: `${step.id}-${step.on_success}`,
            source: step.id,
            target: step.on_success,
            sourceHandle: `${sides.source}-source`,
            targetHandle: `${sides.target}-target`,
            sourcePosition: flowPositionBySide[sides.source],
            targetPosition: flowPositionBySide[sides.target],
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
            animated: step.id === selectedStepId,
          },
        ]
      }),
    [positions, selectedStepId, workflow.steps],
  )

  const fitDiagram = useCallback(() => {
    window.setTimeout(() => {
      flowInstanceRef.current?.fitView({ padding: 0.38, maxZoom: 1.1, duration: 180 })
    }, 80)
  }, [])

  const updateWorkflow = useCallback((next: WorkflowRecipe, message?: string) => {
    setWorkflow(next)
    setNotice(message ?? 'Cambios guardados en el modelo YAML')
    setImportError(null)
  }, [])

  const updateStep = useCallback(
    (stepId: string, update: (step: WorkflowStep) => WorkflowStep) => {
      const original = workflow.steps.find((step) => step.id === stepId)
      if (!original) return

      const changed = update(original)
      let steps = workflow.steps.map((step) => (step.id === stepId ? changed : step))

      if (changed.id !== stepId) {
        steps = steps.map((step) =>
          step.on_success === stepId ? { ...step, on_success: changed.id } : step,
        )
        setPositions((current) => {
          const { [stepId]: oldPosition, ...rest } = current
          return { ...rest, [changed.id]: oldPosition ?? { x: 0, y: 0 } }
        })
        setSelectedStepId(changed.id)
      }

      updateWorkflow({ ...workflow, steps })
    },
    [updateWorkflow, workflow],
  )

  const addStep = useCallback(() => {
    const id = nextAvailableId(workflow.steps, 'new-step')
    const parent = workflow.steps.find((step) => step.id === selectedStepId) ?? workflow.steps.at(-1)
    const nextStep: WorkflowStep = {
      ...createEmptyStep(id),
      on_success: parent?.on_success ?? 'complete',
    }
    const parentIndex = parent ? workflow.steps.findIndex((step) => step.id === parent.id) : -1
    const steps = parent
      ? [
          ...workflow.steps.slice(0, parentIndex),
          { ...parent, on_success: id },
          nextStep,
          ...workflow.steps.slice(parentIndex + 1),
        ]
      : [nextStep]

    setPositions((current) => {
      const placement = positionBelow(parent?.id, current)
      return { ...current, ...placement.shiftedPositions, [id]: placement.position }
    })
    setSelectedStepId(id)
    updateWorkflow({ ...workflow, steps }, 'Nueva etapa añadida')
    fitDiagram()
  }, [fitDiagram, selectedStepId, updateWorkflow, workflow])

  const duplicateStep = useCallback(
    (stepId: string) => {
      const sourceIndex = workflow.steps.findIndex((step) => step.id === stepId)
      const source = workflow.steps[sourceIndex]
      if (!source) return

      const id = nextAvailableId(workflow.steps, `${source.id}-copy`)
      const copy: WorkflowStep = {
        ...source,
        id,
        outputs: source.outputs.map((output) => `${output}-copy`),
        skills: source.skills.map((skill) => ({
          ...skill,
          artifact: skill.artifact ? `${skill.artifact}-copy` : undefined,
          output_file: skill.output_file
            ? skill.output_file.replace(/(\.md)?$/, '-copy$1')
            : undefined,
        })),
      }
      const steps = [...workflow.steps]
      steps[sourceIndex] = { ...source, on_success: id }
      steps.splice(sourceIndex + 1, 0, copy)
      setPositions((current) => {
        const placement = positionBelow(source.id, current)
        return { ...current, ...placement.shiftedPositions, [id]: placement.position }
      })
      setSelectedStepId(id)
      updateWorkflow({ ...workflow, steps }, 'Etapa duplicada')
      fitDiagram()
    },
    [fitDiagram, updateWorkflow, workflow],
  )

  const deleteStep = useCallback(
    (stepId: string) => {
      const deleted = workflow.steps.find((step) => step.id === stepId)
      if (!deleted) return

      const replacement = deleted.on_success ?? 'complete'
      const steps = workflow.steps
        .filter((step) => step.id !== stepId)
        .map((step) =>
          step.on_success === stepId ? { ...step, on_success: replacement } : step,
        )
      setPositions((current) => {
        const { [stepId]: _, ...rest } = current
        return rest
      })
      setSelectedStepId(steps[0]?.id ?? null)
      updateWorkflow({ ...workflow, steps }, 'Etapa eliminada y transiciones actualizadas')
    },
    [updateWorkflow, workflow],
  )

  const handleNodeChanges = useCallback((changes: NodeChange[]) => {
    const positionChanges = changes.filter(
      (change): change is Extract<NodeChange, { type: 'position' }> =>
        change.type === 'position' && Boolean(change.position),
    )
    if (positionChanges.length === 0) return

    setPositions((current) => {
      const next = { ...current }
      positionChanges.forEach((change) => {
        if (change.position) next[change.id] = change.position
      })
      return next
    })
  }, [])

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return
      updateStep(connection.source, (step) => ({ ...step, on_success: connection.target! }))
    },
    [updateStep],
  )

  const exportYaml = useCallback(() => {
    const blob = new Blob([serializedYaml], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'workflow.yaml'
    link.click()
    URL.revokeObjectURL(url)
    setNotice('workflow.yaml preparado para descargar')
  }, [serializedYaml])

  const importYaml = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const source = await file.text()
        const imported = workflowFromYaml(source)
        updateWorkflow(imported, `Importado ${file.name}`)
        setPositions(initialPositions(imported))
        setSelectedStepId(imported.steps[0]?.id ?? null)
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : 'No se ha podido leer el archivo YAML.',
        )
      } finally {
        event.target.value = ''
      }
    },
    [updateWorkflow],
  )

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand" aria-label="Project Workflow Studio">
          <span className="brand-mark" aria-hidden="true"><Workflow size={18} /></span>
          <span>Project Workflow</span>
          <span className="brand-subtitle">Studio</span>
        </div>

        <div className="workflow-title">
          <span className="source-status"><Check size={14} aria-hidden="true" /> YAML</span>
          <strong>{workflow.id}</strong>
        </div>

        <div className="toolbar" aria-label="Acciones del workflow">
          <input
            ref={importInputRef}
            id="yaml-import"
            className="visually-hidden"
            type="file"
            accept=".yaml,.yml,text/yaml,application/x-yaml"
            onChange={importYaml}
          />
          <button className="button button-quiet" type="button" onClick={() => importInputRef.current?.click()}>
            <Upload size={16} aria-hidden="true" /> Importar
          </button>
          <button className="button button-primary" type="button" onClick={exportYaml}>
            <Download size={16} aria-hidden="true" /> Exportar YAML
          </button>
        </div>
      </header>

      <section className="editor-layout" aria-label="Editor visual de workflow">
        <div className="canvas-panel">
          <div className="canvas-toolbar">
            <div>
              <p className="section-kicker">DIAGRAMA</p>
              <h1>Etapas del workflow</h1>
            </div>
            <button className="button button-secondary" type="button" onClick={addStep}>
              <Plus size={16} aria-hidden="true" /> Añadir etapa
            </button>
          </div>

          <div className="canvas-help" role="status">
            <span><span className="status-dot" /> {notice}</span>
            {validationIssues.length > 0 && (
              <span className="validation-warning">Revisa {validationIssues.length} aviso{validationIssues.length === 1 ? '' : 's'} en el inspector.</span>
            )}
          </div>

          <div className="flow-wrapper">
            {workflow.steps.length === 0 ? (
              <div className="empty-canvas">
                <div className="empty-icon"><FileOutput size={22} aria-hidden="true" /></div>
                <h2>No hay etapas todavía</h2>
                <p>Añade una etapa para empezar a definir el flujo.</p>
                <button className="button button-primary" type="button" onClick={addStep}>
                  <Plus size={16} aria-hidden="true" /> Añadir primera etapa
                </button>
              </div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={handleNodeChanges}
                onConnect={handleConnect}
                onNodeClick={(_, node) => setSelectedStepId(node.id)}
                onPaneClick={() => setSelectedStepId(null)}
                onInit={(instance) => {
                  flowInstanceRef.current = instance
                  fitDiagram()
                }}
                fitView
                fitViewOptions={{ padding: 0.38, maxZoom: 1.1 }}
                minZoom={0.35}
                maxZoom={1.6}
                defaultEdgeOptions={{ type: 'smoothstep' }}
                aria-label="Diagrama de etapas del workflow"
              >
                <Background gap={20} size={1} color="#d9dfdc" />
                <Controls showInteractive={false} />
              </ReactFlow>
            )}
          </div>
        </div>

        <aside className="inspector-panel" aria-label="Inspector de configuración">
          <div className="inspector-heading">
            <div className="inspector-heading-icon" aria-hidden="true">
              {selectedStep ? <Settings2 size={17} /> : <Workflow size={17} />}
            </div>
            <div>
              <p className="section-kicker">{selectedStep ? 'ETAPA SELECCIONADA' : 'WORKFLOW'}</p>
              <h2>{selectedStep ? selectedStep.id : 'Configuración general'}</h2>
            </div>
          </div>

          {importError && <p className="import-error" role="alert">{importError}</p>}

          <Inspector
            workflow={workflow}
            selectedStep={selectedStep}
            validationIssues={validationIssues}
            onWorkflowChange={(change) => updateWorkflow({ ...workflow, ...change })}
            onStepChange={updateStep}
            onDuplicateStep={duplicateStep}
            onDeleteStep={deleteStep}
          />
        </aside>
      </section>
    </main>
  )
}

export default App
