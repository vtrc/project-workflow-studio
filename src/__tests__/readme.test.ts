/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')

describe('Studio recipe documentation', () => {
  it('documents the canonical derived artifact handoff without retired YAML examples', () => {
    expect(readme).toContain('.workflow/artifacts/<step.id>.md')
    expect(readme).toContain('step.prompt')
    expect(readme).toContain('primary')
    expect(readme).toContain('supporting')
    expect(readme).toContain('review')
    expect(readme).not.toMatch(/role:\s*fallback/)
    expect(readme).not.toMatch(/output_file:/)
    expect(readme).not.toMatch(/artifact:\s/)
  })
})
