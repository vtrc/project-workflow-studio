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
  Moon,
  Plus,
  Redo2,
  Save,
  Settings2,
  SunMedium,
  Undo2,
  Workflow,
  X,
} from 'lucide-react'
import { Inspector } from './components/Inspector'
import { SkillCatalogPanel } from './components/SkillCatalogPanel'
import { WorkflowNode, type WorkflowNodeData } from './components/WorkflowNode'
import {
  createEmptyStep,
  defaultWorkflow,
  nextAvailableId,
  successorIdsForStep,
  validateWorkflow,
  workflowFromYaml,
  workflowToYaml,
} from './workflow'
import type { WorkflowRecipe, WorkflowStep } from './types'
import { catalogFreshness, validateSkillCatalog, type SkillCatalog } from './skillCatalog'
import { isWorkflowDirectoryName, SKILL_CATALOG_FILE_NAME, WORKFLOW_FILE_NAME } from './workflowFolder'
import { AUTOSAVE_DELAY_MS, isCurrentAutosaveSource, shouldScheduleAutosave } from './autosave'
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
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<LocalDirectoryHandle>
  }
}

const nodeTypes = { workflowStep: WorkflowNode }
const themeStorageKey = 'project-workflow-studio-theme'

type ThemeMode = 'light' | 'dark' | 'system'

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function getResolvedTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}


const nodeWidth = 254
const estimatedNodeHeight = 160
const verticalStepGap = 76
const yamlFileNamePattern = /^[^/\\]+\.(?:yaml|yml)$/i
const studioHistoryDirectoryName = 'studio-history'

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
  const [notice, setNotice] = useState(
    window.showDirectoryPicker
      ? 'Abre la carpeta .workflow para editar workflow.yaml y guardar el historial local.'
      : 'Este navegador no permite seleccionar la carpeta .workflow requerida.',
  )
  const [importError, setImportError] = useState<string | null>(null)
  const [sourceFile, setSourceFile] = useState<LocalFileHandle | null>(null)
  const [sourceFileName, setSourceFileName] = useState<string | null>(null)
  const [skillCatalog, setSkillCatalog] = useState<SkillCatalog | null>(null)
  const [skillCatalogState, setSkillCatalogState] = useState<'unavailable' | 'missing' | 'invalid' | 'current' | 'stale'>('unavailable')
  const [skillCatalogError, setSkillCatalogError] = useState<string | null>(null)
  const [history, setHistory] = useState<WorkflowHistory>(() =>
    newHistory('sesión-sin-carpeta', snapshotFor(defaultWorkflow, initialPositions(defaultWorkflow)), 'Versión inicial'),
  )
  const [historyEnabled, setHistoryEnabled] = useState(false)
  const [historyPath, setHistoryPath] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system'
    const stored = window.localStorage.getItem(themeStorageKey)
    return isThemeMode(stored) ? stored : 'system'
  })
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const historyCloseRef = useRef<HTMLButtonElement>(null)
  const themeTriggerRef = useRef<HTMLButtonElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<Node<WorkflowNodeData>, Edge> | null>(null)
  const workflowRef = useRef(workflow)
  const positionsRef = useRef(positions)
  const historyRef = useRef(history)
  const historyDirectoryRef = useRef<LocalDirectoryHandle | null>(null)
  const skillCatalogRootRef = useRef<LocalDirectoryHandle | null>(null)
  const historyTimerRef = useRef<number | null>(null)
  const lastHistoryChangeRef = useRef(0)
  const autosaveTimerRef = useRef<number | null>(null)
  const autosaveQueueRef = useRef(Promise.resolve())
  const autosaveRevisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  const loadedSourceRef = useRef(false)
  const sourceFileRef = useRef<LocalFileHandle | null>(null)
  const sourceFileNameRef = useRef<string | null>(null)
  const sourceGenerationRef = useRef(0)

  useEffect(() => { workflowRef.current = workflow }, [workflow])
  useEffect(() => { positionsRef.current = positions }, [positions])
  useEffect(() => { historyRef.current = history }, [history])
  useEffect(() => () => {
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const resolvedTheme = getResolvedTheme(theme)
    root.dataset.theme = resolvedTheme
    root.classList.toggle('theme-light', resolvedTheme === 'light')
    root.classList.toggle('theme-dark', resolvedTheme === 'dark')
    root.classList.remove('theme-system')
    if (theme === 'system') {
      window.localStorage.removeItem(themeStorageKey)
    } else {
      window.localStorage.setItem(themeStorageKey, theme)
    }
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const syncSystemTheme = () => {
      const root = document.documentElement
      const resolvedTheme = mediaQuery.matches ? 'dark' : 'light'
      root.dataset.theme = resolvedTheme
      root.classList.toggle('theme-light', resolvedTheme === 'light')
      root.classList.toggle('theme-dark', resolvedTheme === 'dark')
    }

    mediaQuery.addEventListener?.('change', syncSystemTheme)
    return () => mediaQuery.removeEventListener?.('change', syncSystemTheme)
  }, [theme])

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
  const serializedYaml = useMemo(() => workflowToYaml(workflow), [workflow])
  const resolvedTheme = useMemo(() => getResolvedTheme(theme), [theme])

  const nodes = useMemo<Node<WorkflowNodeData>[]>(
    () =>
      workflow.steps.map((step, index) => ({
        id: step.id,
        type: 'workflowStep',
        position: positions[step.id] ?? { x: index * 356, y: 160 },
        data: {
          step,
          workflow,
          isSelected: step.id === selectedStepId,
          index,
          activeSourceHandle: successorIdsForStep(workflow, step.id)[0]
            ? `${getEdgeSides(
                positions[step.id] ?? { x: 0, y: 0 },
                positions[successorIdsForStep(workflow, step.id)[0]!] ?? { x: 0, y: 0 },
              ).source}-source`
            : undefined,
          activeTargetHandles: step.inputs
            .filter((input) => workflow.steps.some((candidate) => candidate.id === input))
            .map((input) => `${getEdgeSides(
              positions[input] ?? { x: 0, y: 0 },
              positions[step.id] ?? { x: 0, y: 0 },
            ).target}-target`),
        },
      })),
    [positions, selectedStepId, workflow],
  )

  const edges = useMemo<Edge[]>(
    () =>
      workflow.steps.flatMap((target) => target.inputs.flatMap((sourceId) => {
        if (!workflow.steps.some((candidate) => candidate.id === sourceId)) return []
        const sourcePosition = positions[sourceId] ?? { x: 0, y: 0 }
        const targetPosition = positions[target.id] ?? { x: 0, y: 0 }
        const sides = getEdgeSides(sourcePosition, targetPosition)
        return [{
          id: `${sourceId}-${target.id}`,
          source: sourceId,
          target: target.id,
          sourceHandle: `${sides.source}-source`,
          targetHandle: `${sides.target}-target`,
          sourcePosition: flowPositionBySide[sides.source],
          targetPosition: flowPositionBySide[sides.target],
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          animated: sourceId === selectedStepId || target.id === selectedStepId,
        }]
      })),
    [positions, selectedStepId, workflow],
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

  const queueWorkflowSave = useCallback((contents: string, revision: number, mode: 'auto' | 'manual') => {
    const handle = sourceFileRef.current
    const fileName = sourceFileNameRef.current ?? handle?.name
    const sourceGeneration = sourceGenerationRef.current
    if (!handle || !loadedSourceRef.current) return Promise.resolve()

    autosaveQueueRef.current = autosaveQueueRef.current.catch(() => undefined).then(async () => {
      if (sourceFileRef.current !== handle || !loadedSourceRef.current || !isCurrentAutosaveSource(sourceGeneration, sourceGenerationRef.current)) return
      try {
        const writable = await handle.createWritable()
        await writable.write(contents)
        await writable.close()
        if (sourceFileRef.current !== handle || !isCurrentAutosaveSource(sourceGeneration, sourceGenerationRef.current)) return
        savedRevisionRef.current = Math.max(savedRevisionRef.current, revision)
        if (revision === autosaveRevisionRef.current) {
          setNotice(mode === 'auto' ? `Cambios guardados automáticamente en ${fileName}` : `Cambios guardados en ${fileName}`)
          setImportError(null)
        }
      } catch (error) {
        if (sourceFileRef.current !== handle || !isCurrentAutosaveSource(sourceGeneration, sourceGenerationRef.current)) return
        setImportError(error instanceof Error ? `No se ha podido guardar ${fileName}: ${error.message}` : 'No se ha podido guardar el archivo YAML.')
      }
    })
    return autosaveQueueRef.current
  }, [])

  const scheduleAutosave = useCallback(() => {
    if (!shouldScheduleAutosave({
      hasWritableSource: Boolean(sourceFileRef.current),
      hasLoadedWorkflow: loadedSourceRef.current,
      changeRevision: autosaveRevisionRef.current,
      savedRevision: savedRevisionRef.current,
    })) return
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null
      const revision = autosaveRevisionRef.current
      void queueWorkflowSave(workflowToYaml(workflowRef.current), revision, 'auto')
    }, AUTOSAVE_DELAY_MS)
  }, [queueWorkflowSave])

  const applyChange = useCallback((nextWorkflow: WorkflowRecipe, nextPositions: Record<string, Position>, message?: string) => {
    workflowRef.current = nextWorkflow
    positionsRef.current = nextPositions
    setWorkflow(nextWorkflow)
    setPositions(nextPositions)
    setNotice(message ?? 'Cambios pendientes de guardado automático')
    setImportError(null)
    recordHistory(nextWorkflow, nextPositions, message ?? 'Edición del workflow')
    autosaveRevisionRef.current += 1
    scheduleAutosave()
  }, [recordHistory, scheduleAutosave])

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
        steps = steps.map((step) => step.inputs.includes(stepId)
          ? { ...step, inputs: step.inputs.map((input) => input === stepId ? changed.id : input) }
          : step)
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
    const nextStep: WorkflowStep = { ...createEmptyStep(id), inputs: parent ? [parent.id] : [] }
    const parentIndex = parent ? workflow.steps.findIndex((step) => step.id === parent.id) : -1
    const steps = parent
      ? [
          ...workflow.steps.slice(0, parentIndex),
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
      const copy: WorkflowStep = { ...source, id, skills: source.skills.map((skill) => ({ ...skill })) }
      const steps = [...workflow.steps]
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

      const steps = workflow.steps
        .filter((step) => step.id !== stepId)
        .map((step) => step.inputs.includes(stepId)
          ? { ...step, inputs: [...new Set([...step.inputs.filter((input) => input !== stepId), ...deleted.inputs])] }
          : step)
      const { [stepId]: _, ...nextPositions } = positionsRef.current
      setSelectedStepId(steps[0]?.id ?? null)
      applyChange({ ...workflow, steps }, nextPositions, 'Etapa eliminada y entradas actualizadas')
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
      const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
        if (from === target) return true
        if (seen.has(from)) return false
        seen.add(from)
        return successorIdsForStep(workflowRef.current, from).some((next) => reaches(next, target, seen))
      }
      if (reaches(connection.target, connection.source)) return
      updateStep(connection.target, (step) => step.inputs.includes(connection.source!)
        ? step
        : { ...step, inputs: [...step.inputs, connection.source!] })
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
      sourceGenerationRef.current += 1
      sourceFileRef.current = handle ?? null
      sourceFileNameRef.current = file.name
      loadedSourceRef.current = Boolean(handle)
      autosaveRevisionRef.current = 0
      savedRevisionRef.current = 0
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
      setSourceFile(handle ?? null)
      setSourceFileName(file.name)
      if (historyDirectory && !restoredHistory) scheduleHistoryPersistence()
    },
    [loadStoredHistory, replaceHistory, scheduleHistoryPersistence],
  )

  const loadSkillCatalog = useCallback(async (root: LocalDirectoryHandle) => {
    skillCatalogRootRef.current = root
    try {
      const rawCatalog = await readJsonFile(root, SKILL_CATALOG_FILE_NAME)
      if (!rawCatalog) {
        setSkillCatalog(null)
        setSkillCatalogState('missing')
        setSkillCatalogError(null)
        return
      }
      const result = validateSkillCatalog(rawCatalog)
      setSkillCatalog(result.catalog)
      setSkillCatalogError(result.error)
      setSkillCatalogState(result.catalog ? catalogFreshness(result.catalog) : 'invalid')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        setSkillCatalog(null)
        setSkillCatalogState('missing')
        setSkillCatalogError(null)
        return
      }
      setSkillCatalog(null)
      setSkillCatalogState('invalid')
      setSkillCatalogError(error instanceof Error ? error.message : 'No se ha podido leer el catálogo local.')
    }
  }, [])

  const reloadSkillCatalog = useCallback(() => {
    const root = skillCatalogRootRef.current
    if (!root) return
    void loadSkillCatalog(root)
  }, [loadSkillCatalog])

  const openWorkflowFromFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) return
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' })
      if (!isWorkflowDirectoryName(root.name)) throw new Error('Selecciona exactamente la carpeta .workflow.')
      const handle = await root.getFileHandle(WORKFLOW_FILE_NAME)
      const historyDirectory = await root.getDirectoryHandle(studioHistoryDirectoryName, { create: true })
      await loadWorkflowFile(await handle.getFile(), handle, historyDirectory, WORKFLOW_FILE_NAME)
      await loadSkillCatalog(root)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setImportError(
        error instanceof Error
          ? `No se ha podido abrir la carpeta del proyecto: ${error.message}`
          : 'No se ha podido abrir la carpeta del proyecto.',
      )
    }
  }, [loadSkillCatalog, loadWorkflowFile])

  const openWorkflow = useCallback(() => {
    void openWorkflowFromFolder()
  }, [openWorkflowFromFolder])

  const saveWorkflowFile = useCallback(async () => {
    if (!sourceFileRef.current || !loadedSourceRef.current) return
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    const revision = autosaveRevisionRef.current
    await queueWorkflowSave(workflowToYaml(workflowRef.current), revision, 'manual')
  }, [queueWorkflowSave])


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
          <div className="toolbar-group" aria-label="Archivo">
            <button
              className="button button-secondary button-open-workflow"
              type="button"
              onClick={openWorkflow}
              aria-label="Abrir carpeta .workflow"
              title={window.showDirectoryPicker
                ? 'Seleccionar exactamente la carpeta .workflow para cargar workflow.yaml, el catálogo y el historial local'
                : 'Este navegador no permite seleccionar la carpeta .workflow requerida'}
              disabled={!window.showDirectoryPicker}
            >
              <FolderOpen size={16} aria-hidden="true" /> <span>Abrir .workflow</span>
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
          <div className="toolbar-group toolbar-group-theme" aria-label="Tema">
            <button
              ref={themeTriggerRef}
              className="button button-secondary button-theme-switch"
              type="button"
              onClick={() => setTheme((current) => (getResolvedTheme(current) === 'dark' ? 'light' : 'dark'))}
              role="switch"
              aria-checked={resolvedTheme === 'dark'}
              aria-label={resolvedTheme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
              title={theme === 'system'
                ? `Tema del sistema: ${resolvedTheme === 'dark' ? 'oscuro' : 'claro'}`
                : `Cambiar a tema ${resolvedTheme === 'dark' ? 'claro' : 'oscuro'}`}
            >
              <span className="theme-switch-track" aria-hidden="true">
                <span className="theme-switch-thumb">
                  {resolvedTheme === 'dark' ? <Moon size={13} aria-hidden="true" /> : <SunMedium size={13} aria-hidden="true" />}
                </span>
              </span>
              <span className="button-label">{resolvedTheme === 'dark' ? 'Oscuro' : 'Claro'}</span>
            </button>
          </div>
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
                <Background gap={20} size={1} color="var(--flow-grid)" />
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

          <SkillCatalogPanel
            catalog={skillCatalog}
            state={skillCatalogState}
            error={skillCatalogError}
            canReload={Boolean(skillCatalogRootRef.current)}
          />

          <Inspector
            workflow={workflow}
            selectedStep={selectedStep}
            validationIssues={validationIssues}
            onWorkflowChange={(change) => updateWorkflow({ ...workflow, ...change })}
            onStepChange={updateStep}
            onDuplicateStep={duplicateStep}
            onDeleteStep={deleteStep}
            skillCatalog={skillCatalog}
            onReloadSkills={reloadSkillCatalog}
            canReloadSkills={Boolean(skillCatalogRootRef.current)}
          />
        </aside>
      </section>

      {isHistoryOpen && (
        <div
          className="history-drawer-layer"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeHistory()
          }}
        >
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
                : 'Historial temporal. Abre el workflow desde su carpeta raíz para conservarlo al reiniciar.'}
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
