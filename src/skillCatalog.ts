export const SKILL_CATALOG_SCHEMA_VERSION = 1 as const
export const SKILL_CATALOG_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type SkillCatalogStatus = 'valid' | 'missing-description' | 'invalid' | 'conflict'
export type SkillCatalogOrigin = 'project' | 'global'

export type SkillCatalogEntry = {
  name: string
  description?: string
  version?: string
  status: SkillCatalogStatus
  contentHash?: string
  relativePath?: string
  globalRoot?: string
  reason?: string
  origin: SkillCatalogOrigin
}

export type SkillCatalog = {
  schemaVersion: 1
  generatedAt: string
  generator: { version: string }
  projectSkills: SkillCatalogEntry[]
  globalSkills: SkillCatalogEntry[]
  globalRoots?: Array<{ id: string; status: 'available' | 'unavailable' }>
}

export type SkillCatalogValidation = { catalog: SkillCatalog | null; error: string | null }

const statuses: SkillCatalogStatus[] = ['valid', 'missing-description', 'invalid', 'conflict']
const rootPattern = /^[a-z0-9][a-z0-9._-]*$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function safeProjectSkillPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:/.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => Boolean(segment) && segment !== '.' && segment !== '..')
}

function parseEntry(value: unknown, origin: SkillCatalogOrigin): SkillCatalogEntry | string {
  if (!isRecord(value)) return 'Cada Skill debe ser un objeto.'
  const name = text(value.name)
  if (!name) return 'Cada Skill necesita un nombre visible.'
  if (value.origin !== origin) return `La Skill “${name}” tiene una procedencia incoherente.`
  if (!statuses.includes(value.status as SkillCatalogStatus)) return `La Skill “${name}” tiene un estado inválido.`
  const status = value.status as SkillCatalogStatus
  const description = text(value.description)
  const version = text(value.version)
  const contentHash = text(value.contentHash)
  const reason = text(value.reason)
  if (contentHash && !/^[a-f0-9]{64}$/i.test(contentHash)) return `La Skill “${name}” tiene un hash de contenido inválido.`

  if (origin === 'project') {
    if (status !== 'invalid' && !safeProjectSkillPath(value.relativePath)) return `La Skill “${name}” tiene una ruta relativa insegura.`
    if (value.relativePath !== undefined && !safeProjectSkillPath(value.relativePath)) return `La Skill “${name}” tiene una ruta relativa insegura.`
    return { name, description, version, status, contentHash, relativePath: value.relativePath as string | undefined, reason, origin }
  }

  if (status !== 'invalid' && (!text(value.globalRoot) || !rootPattern.test(text(value.globalRoot)!))) return `La Skill global “${name}” tiene una raíz lógica inválida.`
  if (value.globalRoot !== undefined && (!text(value.globalRoot) || !rootPattern.test(text(value.globalRoot)!))) return `La Skill global “${name}” tiene una raíz lógica inválida.`
  return { name, description, version, status, contentHash, globalRoot: text(value.globalRoot), reason, origin }
}

function parseEntries(value: unknown, origin: SkillCatalogOrigin): SkillCatalogEntry[] | string {
  if (!Array.isArray(value)) return `La colección de Skills ${origin === 'project' ? 'del proyecto' : 'globales'} debe ser una lista.`
  const entries: SkillCatalogEntry[] = []
  for (const item of value) {
    const entry = parseEntry(item, origin)
    if (typeof entry === 'string') return entry
    entries.push(entry)
  }
  return entries
}

function parseGlobalRoots(value: unknown): SkillCatalog['globalRoots'] | string | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return 'Las raíces globales deben ser una lista.'
  const roots: NonNullable<SkillCatalog['globalRoots']> = []
  for (const root of value) {
    if (!isRecord(root) || !text(root.id) || !rootPattern.test(text(root.id)!) || (root.status !== 'available' && root.status !== 'unavailable')) {
      return 'Una raíz global no es válida.'
    }
    roots.push({ id: text(root.id)!, status: root.status })
  }
  return [...roots].sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

function stableEntries(entries: SkillCatalogEntry[]): SkillCatalogEntry[] {
  const duplicates = new Set<string>()
  const names = new Map<string, number>()
  entries.forEach((entry) => {
    const key = entry.name.toLocaleLowerCase('es-ES')
    names.set(key, (names.get(key) ?? 0) + 1)
  })
  names.forEach((count, name) => { if (count > 1) duplicates.add(name) })

  return entries
    .map((entry) => {
      const normalizedName = entry.name.toLocaleLowerCase('es-ES')
      return duplicates.has(normalizedName)
        ? { ...entry, status: 'conflict' as const, reason: `Nombre duplicado: ${normalizedName}.` }
        : entry
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }) ||
      (left.relativePath ?? left.globalRoot ?? '').localeCompare(right.relativePath ?? right.globalRoot ?? '', 'en'),
    )
}

export function validateSkillCatalog(value: unknown): SkillCatalogValidation {
  if (!isRecord(value)) return { catalog: null, error: 'El catálogo debe ser un objeto JSON.' }
  if (value.schemaVersion !== SKILL_CATALOG_SCHEMA_VERSION) return { catalog: null, error: 'La versión del catálogo no es compatible.' }
  const generatedAt = text(value.generatedAt)
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) return { catalog: null, error: 'La fecha de generación no es válida.' }
  if (!isRecord(value.generator) || !text(value.generator.version)) return { catalog: null, error: 'Falta la versión del generador.' }
  const projectSkills = parseEntries(value.projectSkills, 'project')
  if (typeof projectSkills === 'string') return { catalog: null, error: projectSkills }
  const globalSkills = parseEntries(value.globalSkills, 'global')
  if (typeof globalSkills === 'string') return { catalog: null, error: globalSkills }

  const globalRoots = parseGlobalRoots(value.globalRoots)
  if (typeof globalRoots === 'string') return { catalog: null, error: globalRoots }
  if (globalRoots) {
    const globalRootsById = new Map(globalRoots.map((root) => [root.id, root.status]))
    const unsupportedGlobalSkill = globalSkills.find((skill) => !skill.globalRoot || globalRootsById.get(skill.globalRoot) !== 'available')
    if (unsupportedGlobalSkill) {
      return { catalog: null, error: `La Skill global “${unsupportedGlobalSkill.name}” usa una raíz no disponible.` }
    }
  }
  const entries = stableEntries([...projectSkills, ...globalSkills])
  return {
    catalog: {
      schemaVersion: SKILL_CATALOG_SCHEMA_VERSION,
      generatedAt,
      generator: { version: text(value.generator.version)! },
      projectSkills: entries.filter((entry) => entry.origin === 'project'),
      globalSkills: entries.filter((entry) => entry.origin === 'global'),
      ...(globalRoots ? { globalRoots } : {}),
    },
    error: null,
  }
}

export function catalogFreshness(catalog: SkillCatalog | null, now = new Date()): 'missing' | 'current' | 'stale' {
  if (!catalog) return 'missing'
  return now.getTime() - Date.parse(catalog.generatedAt) > SKILL_CATALOG_STALE_AFTER_MS ? 'stale' : 'current'
}
