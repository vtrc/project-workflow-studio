import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  FolderOpen,
  History,
  Plus,
  Redo2,
  Save,
  Settings2,
  Undo2,
  Upload,
  Workflow,
  X,
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
import {
  asPersistedManifest,
  cloneSnapshot,
  HISTORY_SCHEMA_VERSION,
  newHistory,
  newHistoryEntry,
  trimHistory,
  type DiagramPosition,
  type HistoryEntry,
  type PersistedHistoryManifest,
  type WorkflowHistory,
  type WorkflowSnapshot,
} from './history'
import './App.css'

type Position = DiagramPosition
type HandleSide = 'top' | 'right' | 'bottom' | 'left'

type LocalFileWritable = {
  write: (contents: string) => Promise<void>
  close: () => Promise<void>
}

type LocalFileHandle = {
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<LocalFileWritable>
}

type LocalDirectoryHandle = {
  name: string
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<LocalDirectoryHandle>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<LocalFileHandle>
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      excludeAcceptAllOption?: boolean
      multiple?: boolean
      types?: Array<{
        description: string
        accept: Record<string, string[]>
      }>
    }) => Promise<LocalFileHandle[]>
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<LocalDirectoryHandle>
  }
}

const nodeTypes = { workflowStep: WorkflowNode }
const nodeWidth = 254
const estimatedNodeHeight = 160
const verticalStepGap = 76
const yamlFileNamePattern = /^[^/\\]+\.(?:yaml|yml)$/i
const historyDirectoryName = '.workflow'
const studioHistoryDirectoryName = 'studio-history'

function getSafeRelativeFileHint(): string | null {
  const hintedPath = new URLSearchParams(window.location.search).get('path')
  if (!hintedPath) return null

  const normalized = hintedPath.trim().replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('~') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    !yamlFileNamePattern.test(normalized.split('/').at(-1) ?? '')
  ) {
    return null
  }

  return normalized
}

function assertYamlFileName(file: File): void {
  if (!yamlFileNamePattern.test(file.name)) {
    throw new Error('Selecciona un archivo YAML con extensión .yaml o .yml.')
  }
}

function snapshotFor(workflow: WorkflowRecipe, positions: Record<string, Position>): WorkflowSnapshot {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, workflow, positions }
}

function isPositionRecord(value: unknown): value is Record<string, Position> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value as Record<string, unknown>).every(
    (position) => Boolean(position) && typeof position === 'object' &&
      typeof (position as Position).x === 'number' && typeof (position as Position).y === 'number',
  )
}

function isSnapshot(value: unknown): value is WorkflowSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkflowSnapshot>
  return candidate.schemaVersion === HISTORY_SCHEMA_VERSION && Boolean(candidate.workflow) && isPositionRecord(candidate.positions)
}

function isManifest(value: unknown): value is PersistedHistoryManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedHistoryManifest>
  return candidate.schemaVersion === HISTORY_SCHEMA_VERSION &&
    typeof candidate.workflowPath === 'string' &&
    typeof candidate.cursor === 'number' &&
    Array.isArray(candidate.entries)
}

async function writeJsonFile(directory: LocalDirectoryHandle, name: string, value: unknown): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(value, null, 2))
  await writable.close()
}

async function readJsonFile(directory: LocalDirectoryHandle, name: string): Promise<unknown | null> {
  try {
    const handle = await directory.getFileHandle(name)
    return JSON.parse(await (await handle.getFile()).text()) as unknown
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    throw error
  }
}

async function resolveFile(root: LocalDirectoryHandle, relativePath: string): Promise<LocalFileHandle> {
  const segments = relativePath.split('/')
  const fileName = segments.pop()
  if (!fileName || !yamlFileNamePattern.test(fileName)) throw new Error('La ruta sugerida no apunta a un YAML válido.')
  let directory = root
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment)
  return directory.getFileHandle(fileName)
}

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
  const expectedFileHint = useMemo(() => getSafeRelativeFileHint(), [])
  const [notice, setNotice] = useState(
    expectedFileHint
      ? `Selecciona ${expectedFileHint} con el selector del navegador para abrirlo.`
      : 'Selecciona workflow.yaml para editarlo y guardarlo en el mismo archivo',
  )
  const [importError, setImportError] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<LocalFileHandle | null>(null)
  const [sourceFileName, setSourceFileName] = useState<string | null>(null)
  const [history, setHistory] = useState<WorkflowHistory>(() =>
    newHistory('sesión-sin-carpeta', snapshotFor(defaultWorkflow, initialPositions(defaultWorkflow)), 'Versión inicial'),
  )
  const [historyEnabled, setHistoryEnabled] = useState(false)
  const [historyPath, setHistoryPath] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const historyCloseRef = useRef<HTMLButtonElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node<WorkflowNodeData>, Edge> | null>(null)
  const workflowRef = useRef(workflow)
  const positionsRef = useRef(positions)
  const historyRef = useRef(history)
  const historyDirectoryRef = useRef<LocalDirectoryHandle | null>(null)
  const historyTimerRef = useRef<number | null>(null)
  const lastHistoryChangeRef = useRef(0)

  useEffect(() => { workflowRef.current = workflow }, [workflow])
  useEffect(() => { positionsRef.current = positions }, [positions])
  useEffect(() => { historyRef.current = history }, [history])
  useEffect(() => () => {
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
  }, [])

  const closeHistory = useCallback(() => {
    setIsHistoryOpen(false)
    window.setTimeout(() => historyTriggerRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    if (!isHistoryOpen) return

    historyCloseRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeHistory()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeHistory, isHistoryOpen])

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

  const persistHistory = useCallback(async () => {
    const directory = historyDirectoryRef.current
    if (!directory) return
    const current = historyRef.current
    try {
      const snapshots = await directory.getDirectoryHandle('snapshots', { create: true })
      const previousManifest = await readJsonFile(directory, 'manifest.json')
      await Promise.all(current.entries.map((entry) =>
        writeJsonFile(snapshots, `${entry.id}.json`, entry.snapshot),
      ))
      await writeJsonFile(directory, 'manifest.json', asPersistedManifest(current))
      if (isManifest(previousManifest) && snapshots.removeEntry) {
        const activeIds = new Set(current.entries.map((entry) => entry.id))
        await Promise.all(previousManifest.entries
          .filter((entry) => typeof entry?.id === 'string' && !activeIds.has(entry.id))
          .map((entry) => snapshots.removeEntry?.(`${entry.id}.json`)),
        )
      }
    } catch (error) {
      setImportError(
        error instanceof Error
          ? `No se ha podido guardar el historial local: ${error.message}`
          : 'No se ha podido guardar el historial local.',
      )
    }
  }, [])

  const scheduleHistoryPersistence = useCallback(() => {
    if (!historyDirectoryRef.current) return
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null
      void persistHistory()
    }, 700)
  }, [persistHistory])

  const replaceHistory = useCallback((next: WorkflowHistory, persist = true) => {
    historyRef.current = next
    setHistory(next)
    if (persist) scheduleHistoryPersistence()
  }, [scheduleHistoryPersistence])

  const recordHistory = useCallback((nextWorkflow: WorkflowRecipe, nextPositions: Record<string, Position>, label: string) => {
    const current = historyRef.current
    const now = Date.now()
    const snapshot = snapshotFor(nextWorkflow, nextPositions)
    const shouldCoalesce = now - lastHistoryChangeRef.current < 700 && current.cursor === current.entries.length - 1
    const retained = current.entries.slice(0, current.cursor + 1)
    const entry = newHistoryEntry(snapshot, label)
    const next = trimHistory({
      ...current,
      cursor: shouldCoalesce ? retained.length - 1 : retained.length,
      entries: shouldCoalesce ? [...retained.slice(0, -1), entry] : [...retained, entry],
    })
    lastHistoryChangeRef.current = now
    replaceHistory(next)
  }, [replaceHistory])

  const applyChange = useCallback((nextWorkflow: WorkflowRecipe, nextPositions: Record<string, Position>, message?: string) => {
    workflowRef.current = nextWorkflow
    positionsRef.current = nextPositions
    setWorkflow(nextWorkflow)
    setPositions(nextPositions)
    setNotice(message ?? 'Cambios guardados en el modelo YAML')
    setImportError(null)
    recordHistory(nextWorkflow, nextPositions, message ?? 'Edición del workflow')
  }, [recordHistory])

  const updateWorkflow = useCallback((next: WorkflowRecipe, message?: string) => {
    applyChange(next, positionsRef.current, message)
  }, [applyChange])

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
        const { [stepId]: oldPosition, ...rest } = positionsRef.current
        positionsRef.current = { ...rest, [changed.id]: oldPosition ?? { x: 0, y: 0 } }
        setSelectedStepId(changed.id)
      }

      applyChange({ ...workflow, steps }, positionsRef.current)
    },
    [applyChange, workflow],
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

    const placement = positionBelow(parent?.id, positionsRef.current)
    const nextPositions = { ...positionsRef.current, ...placement.shiftedPositions, [id]: placement.position }
    setSelectedStepId(id)
    applyChange({ ...workflow, steps }, nextPositions, 'Nueva etapa añadida')
    fitDiagram()
  }, [applyChange, fitDiagram, selectedStepId, workflow])

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
      const placement = positionBelow(source.id, positionsRef.current)
      const nextPositions = { ...positionsRef.current, ...placement.shiftedPositions, [id]: placement.position }
      setSelectedStepId(id)
      applyChange({ ...workflow, steps }, nextPositions, 'Etapa duplicada')
      fitDiagram()
    },
    [applyChange, fitDiagram, workflow],
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
      const { [stepId]: _, ...nextPositions } = positionsRef.current
      setSelectedStepId(steps[0]?.id ?? null)
      applyChange({ ...workflow, steps }, nextPositions, 'Etapa eliminada y transiciones actualizadas')
    },
    [applyChange, workflow],
  )

  const handleNodeChanges = useCallback((changes: NodeChange[]) => {
    const positionChanges = changes.filter(
      (change): change is Extract<NodeChange, { type: 'position' }> =>
        change.type === 'position' && Boolean(change.position),
    )
    if (positionChanges.length === 0) return

    const next = { ...positionsRef.current }
    positionChanges.forEach((change) => {
      if (change.position) next[change.id] = change.position
    })
    applyChange(workflowRef.current, next, 'Posición del diagrama ajustada')
  }, [applyChange])

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
    setNotice('Copia de workflow.yaml preparada para descargar')
  }, [serializedYaml])

  const restoreHistoryEntry = useCallback((index: number) => {
    const current = historyRef.current
    const entry = current.entries[index]
    if (!entry) return
    const restored = cloneSnapshot(entry.snapshot)
    const next = { ...current, cursor: index }
    replaceHistory(next)
    workflowRef.current = restored.workflow
    positionsRef.current = restored.positions
    setWorkflow(restored.workflow)
    setPositions(restored.positions)
    setSelectedStepId(restored.workflow.steps[0]?.id ?? null)
    setNotice(`Restaurada la versión: ${entry.label}`)
    setImportError(null)
    fitDiagram()
  }, [fitDiagram, replaceHistory])

  const loadStoredHistory = useCallback(async (
    directory: LocalDirectoryHandle,
    workflowPath: string,
  ): Promise<WorkflowHistory | null> => {
    try {
      const rawManifest = await readJsonFile(directory, 'manifest.json')
      if (!isManifest(rawManifest) || rawManifest.workflowPath !== workflowPath) return null
      const snapshots = await directory.getDirectoryHandle('snapshots')
      const entries: HistoryEntry[] = []
      for (const item of rawManifest.entries) {
        if (
          !item || typeof item.id !== 'string' || !/^snapshot-[A-Za-z0-9-]+$/.test(item.id) ||
          typeof item.timestamp !== 'string' || typeof item.label !== 'string'
        ) continue
        const rawSnapshot = await readJsonFile(snapshots, `${item.id}.json`)
        if (!isSnapshot(rawSnapshot)) continue
        entries.push({ id: item.id, timestamp: item.timestamp, label: item.label, snapshot: rawSnapshot })
      }
      if (entries.length === 0) return null
      return trimHistory({
        schemaVersion: HISTORY_SCHEMA_VERSION,
        workflowPath,
        cursor: Math.min(Math.max(0, rawManifest.cursor), entries.length - 1),
        entries,
      })
    } catch {
      return null
    }
  }, [])

  const loadWorkflowFile = useCallback(
    async (file: File, handle?: LocalFileHandle, historyDirectory?: LocalDirectoryHandle, workflowPath?: string) => {
      assertYamlFileName(file)
      const source = await file.text()
      const imported = workflowFromYaml(source)
      const initial = initialPositions(imported)
      const path = workflowPath ?? file.name
      historyDirectoryRef.current = historyDirectory ?? null
      setHistoryEnabled(Boolean(historyDirectory))
      setHistoryPath(historyDirectory ? path : null)
      const restoredHistory = historyDirectory ? await loadStoredHistory(historyDirectory, path) : null
      const nextHistory = restoredHistory ?? newHistory(path, snapshotFor(imported, initial), 'Versión inicial')
      const activeSnapshot = cloneSnapshot(nextHistory.entries[nextHistory.cursor].snapshot)
      replaceHistory(nextHistory, false)
      workflowRef.current = activeSnapshot.workflow
      positionsRef.current = activeSnapshot.positions
      setWorkflow(activeSnapshot.workflow)
      setPositions(activeSnapshot.positions)
      setNotice(restoredHistory ? `Historial local recuperado para ${file.name}` : `Abierto ${file.name}`)
      setImportError(null)
      setSelectedStepId(activeSnapshot.workflow.steps[0]?.id ?? null)
      setSourceFile(handle ?? null)
      setSourceFileName(file.name)
      if (historyDirectory && !restoredHistory) scheduleHistoryPersistence()
    },
    [loadStoredHistory, replaceHistory, scheduleHistoryPersistence],
  )

  const openProjectFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      setImportError('Este navegador no permite seleccionar una carpeta. Usa “Abrir workflow”.')
      return
    }
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' })
      const workflowPath = expectedFileHint ?? 'workflow.yaml'
      const handle = await resolveFile(root, workflowPath)
      const historyParent = await root.getDirectoryHandle(historyDirectoryName, { create: true })
      const historyDirectory = await historyParent.getDirectoryHandle(studioHistoryDirectoryName, { create: true })
      await loadWorkflowFile(await handle.getFile(), handle, historyDirectory, workflowPath)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setImportError(
        error instanceof Error
          ? `No se ha podido abrir la carpeta del proyecto: ${error.message}`
          : 'No se ha podido abrir la carpeta del proyecto.',
      )
    }
  }, [expectedFileHint, loadWorkflowFile])

  const openWorkflowFile = useCallback(async () => {
    if (!window.showOpenFilePicker) {
      importInputRef.current?.click()
      return
    }

    try {
      const [handle] = await window.showOpenFilePicker({
        excludeAcceptAllOption: true,
        multiple: false,
        types: [
          {
            description: 'Workflow YAML',
            accept: {
              'application/x-yaml': ['.yaml', '.yml'],
              'text/yaml': ['.yaml', '.yml'],
            },
          },
        ],
      })
      if (!handle) return
      await loadWorkflowFile(await handle.getFile(), handle)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setImportError(error instanceof Error ? error.message : 'No se ha podido abrir el archivo YAML.')
    }
  }, [loadWorkflowFile])

  const saveWorkflowFile = useCallback(async () => {
    if (!sourceFile) return

    try {
      const writable = await sourceFile.createWritable()
      await writable.write(serializedYaml)
      await writable.close()
      setNotice(`Cambios guardados en ${sourceFileName ?? sourceFile.name}`)
      setImportError(null)
    } catch (error) {
      setImportError(
        error instanceof Error
          ? `No se ha podido guardar ${sourceFileName ?? sourceFile.name}: ${error.message}`
          : 'No se ha podido guardar el archivo YAML.',
      )
    }
  }, [serializedYaml, sourceFile, sourceFileName])

  const importYaml = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        await loadWorkflowFile(file)
      } catch (error) {
        setImportError(
          error instanceof Error ? error.message : 'No se ha podido leer el archivo YAML.',
        )
      } finally {
        event.target.value = ''
      }
    },
    [loadWorkflowFile],
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
          {expectedFileHint && <span className="file-hint" title={expectedFileHint}>Esperado: {expectedFileHint}</span>}
        </div>

        <div className="toolbar" aria-label="Acciones del workflow">
          <input
            ref={importInputRef}
            id="yaml-import"
            className="visually-hidden"
            type="file"
            accept=".yaml,.yml,application/x-yaml,text/yaml"
            onChange={importYaml}
          />
          <div className="toolbar-group" aria-label="Archivo">
            <button
              className="icon-button"
              type="button"
              onClick={openProjectFolder}
              disabled={!window.showDirectoryPicker}
              aria-label="Seleccionar carpeta del proyecto"
              title={window.showDirectoryPicker ? 'Seleccionar carpeta del proyecto y habilitar el historial local' : 'Este navegador no admite el acceso a carpetas'}
            >
              <FolderOpen size={16} aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              onClick={openWorkflowFile}
              aria-label="Abrir archivo YAML"
              title="Abrir solo un archivo YAML; el historial no se guardará en la carpeta"
            >
              <Upload size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="toolbar-group" aria-label="Edición">
            <button className="icon-button" type="button" onClick={() => restoreHistoryEntry(history.cursor - 1)} disabled={history.cursor === 0} aria-label="Deshacer" title="Deshacer">
              <Undo2 size={15} aria-hidden="true" />
            </button>
            <button className="icon-button" type="button" onClick={() => restoreHistoryEntry(history.cursor + 1)} disabled={history.cursor >= history.entries.length - 1} aria-label="Rehacer" title="Rehacer">
              <Redo2 size={15} aria-hidden="true" />
            </button>
          </div>
          <button
            ref={historyTriggerRef}
            className="button button-quiet button-history"
            type="button"
            onClick={() => setIsHistoryOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isHistoryOpen}
            aria-controls="history-drawer"
            aria-label="Abrir historial de versiones"
            title="Abrir historial de versiones"
          >
            <History size={16} aria-hidden="true" /> Historial
          </button>
          <div className="toolbar-group toolbar-group-primary" aria-label="Guardar y exportar">
            <button
              className="button button-primary"
              type="button"
              onClick={saveWorkflowFile}
              disabled={!sourceFile}
              aria-label="Guardar cambios"
              title={sourceFile ? `Guardar en ${sourceFileName}` : 'Abre un workflow desde el selector del navegador para habilitar el guardado directo'}
            >
              <Save size={16} aria-hidden="true" /> Guardar
            </button>
            <button className="icon-button" type="button" onClick={exportYaml} aria-label="Exportar YAML" title="Exportar YAML">
              <Download size={16} aria-hidden="true" />
            </button>
          </div>
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
            {expectedFileHint && (
              <span className="file-hint-copy">Ruta sugerida: {expectedFileHint}. El navegador no la abrirá automáticamente.</span>
            )}
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

      {isHistoryOpen && (
        <div className="history-drawer-layer">
          <div
            id="history-drawer"
            className="history-drawer"
            role="dialog"
            aria-modal="false"
            aria-labelledby="history-drawer-title"
            aria-describedby="history-drawer-note"
          >
            <div className="history-drawer-header">
              <div className="history-heading">
                <span className="inspector-heading-icon" aria-hidden="true"><History size={17} /></span>
                <div>
                  <h2 id="history-drawer-title">Historial</h2>
                  <p>Versiones del workflow</p>
                </div>
              </div>
              <button
                ref={historyCloseRef}
                className="icon-button"
                type="button"
                onClick={closeHistory}
                aria-label="Cerrar historial"
                title="Cerrar historial (Escape)"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p id="history-drawer-note" className="history-note">
              {historyEnabled
                ? `Se guarda solo en .workflow/studio-history/${historyPath ? ` (${historyPath})` : ''}.`
                : 'Historial temporal. Selecciona la carpeta del proyecto para conservarlo al reiniciar.'}
            </p>
            <div className="history-actions" aria-label="Navegar por el historial">
              <button className="button button-secondary button-small" type="button" onClick={() => restoreHistoryEntry(history.cursor - 1)} disabled={history.cursor === 0}>
                <Undo2 size={14} aria-hidden="true" /> Deshacer
              </button>
              <button className="button button-secondary button-small" type="button" onClick={() => restoreHistoryEntry(history.cursor + 1)} disabled={history.cursor >= history.entries.length - 1}>
                <Redo2 size={14} aria-hidden="true" /> Rehacer
              </button>
            </div>
            <ol className="history-list" aria-label="Versiones disponibles">
              {[...history.entries].reverse().map((entry, reverseIndex) => {
                const index = history.entries.length - reverseIndex - 1
                const isCurrent = index === history.cursor
                return (
                  <li key={entry.id}>
                    <button
                      className={`history-entry${isCurrent ? ' is-current' : ''}`}
                      type="button"
                      onClick={() => restoreHistoryEntry(index)}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={`Restaurar versión ${entry.label}, ${new Date(entry.timestamp).toLocaleString('es-ES')}`}
                      title="Restaurar esta versión, incluidas las posiciones del diagrama"
                    >
                      <span>{entry.label}</span>
                      <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString('es-ES')}</time>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
