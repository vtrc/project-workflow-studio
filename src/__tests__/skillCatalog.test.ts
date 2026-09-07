import { describe, expect, it } from 'vitest'
import { catalogFreshness, safeProjectSkillPath, validateSkillCatalog } from '../skillCatalog'

describe('skill catalog manifest validation', () => {
  const generatedAt = '2026-09-07T12:00:00.000Z'

  it('sorts entries deterministically and marks duplicate visible names as conflicts', () => {
    const result = validateSkillCatalog({
      schemaVersion: 1,
      generatedAt,
      generator: { version: '1.0.0' },
      projectSkills: [
        { name: 'zebra', origin: 'project', status: 'valid', relativePath: '.agents/skills/zebra', description: 'Z' },
        { name: 'alpha', origin: 'project', status: 'valid', relativePath: '.agents/skills/alpha', description: 'A' },
      ],
      globalSkills: [
        { name: 'alpha', origin: 'global', status: 'valid', globalRoot: 'codex', description: 'Global A' },
      ],
      globalRoots: [{ id: 'codex', status: 'available' }],
    })

    expect(result.catalog?.projectSkills.map((skill) => skill.name)).toEqual(['alpha', 'zebra'])
    expect(result.catalog?.projectSkills.find((skill) => skill.name === 'alpha')?.status).toBe('conflict')
    expect(result.catalog?.globalSkills[0]?.status).toBe('conflict')
  })

  it('rejects unsafe project paths and malformed global roots', () => {
    expect(safeProjectSkillPath('.agents/skills/check')).toBe(true)
    expect(safeProjectSkillPath('../skills/check')).toBe(false)
    expect(safeProjectSkillPath('/private/skills/check')).toBe(false)

    const result = validateSkillCatalog({
      schemaVersion: 1,
      generatedAt,
      generator: { version: '1.0.0' },
      projectSkills: [{ name: 'unsafe', origin: 'project', status: 'valid', relativePath: '../secret', description: 'No' }],
      globalSkills: [{ name: 'global', origin: 'global', status: 'valid', globalRoot: '/Users/private', description: 'No' }],
    })

    expect(result.catalog).toBeNull()
    expect(result.error).toMatch(/ruta/i)
  })

  it('reports missing and outdated manifests without blocking the workflow', () => {
    expect(catalogFreshness(null, new Date('2026-09-07T12:00:00.000Z'))).toBe('missing')
    const result = validateSkillCatalog({
      schemaVersion: 1,
      generatedAt: '2026-08-25T12:00:00.000Z',
      generator: { version: '1.0.0' },
      projectSkills: [],
      globalSkills: [],
    })
    expect(catalogFreshness(result.catalog, new Date('2026-09-07T12:00:00.000Z'))).toBe('stale')
  })
})

describe('skill catalog integrity', () => {
  const generatedAt = '2026-09-07T12:00:00.000Z'

  it('rejects global Skills whose logical root is unavailable or undeclared', () => {
    const base = {
      schemaVersion: 1,
      generatedAt,
      generator: { version: '1.0.0' },
      projectSkills: [],
      globalSkills: [{ name: 'global', origin: 'global', status: 'valid', globalRoot: 'codex', description: 'Global' }],
    }
    expect(validateSkillCatalog({ ...base, globalRoots: [{ id: 'codex', status: 'unavailable' }] }).catalog).toBeNull()
    expect(validateSkillCatalog({ ...base, globalRoots: [{ id: 'other', status: 'available' }] }).catalog).toBeNull()
  })

  it('rejects backslashes in project paths', () => {
    expect(safeProjectSkillPath('.agents\\skills\\unsafe')).toBe(false)
  })

  it('adds a deterministic reason when duplicate names conflict', () => {
    const result = validateSkillCatalog({
      schemaVersion: 1,
      generatedAt,
      generator: { version: '1.0.0' },
      projectSkills: [{ name: 'Alpha', origin: 'project', status: 'valid', relativePath: '.agents/skills/alpha', description: 'A' }],
      globalSkills: [{ name: 'alpha', origin: 'global', status: 'valid', globalRoot: 'codex', description: 'B' }],
      globalRoots: [{ id: 'codex', status: 'available' }],
    })
    expect(result.catalog?.projectSkills[0]?.reason).toBe('Nombre duplicado: alpha.')
    expect(result.catalog?.globalSkills[0]?.reason).toBe('Nombre duplicado: alpha.')
  })
})

it('accepts a global Skill when optional globalRoots is absent', () => {
  const result = validateSkillCatalog({
    schemaVersion: 1,
    generatedAt: '2026-09-07T12:00:00.000Z',
    generator: { version: '1.0.0' },
    projectSkills: [],
    globalSkills: [{ name: 'global', origin: 'global', status: 'valid', globalRoot: 'codex', description: 'Global' }],
  })
  expect(result.catalog?.globalSkills[0]?.name).toBe('global')
})
