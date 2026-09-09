import { describe, expect, it } from 'vitest'
import {
  artifactIdForStep,
  artifactPathForStep,
  readyStepIds,
  rootStepIds,
  successorIdsForStep,
  validateWorkflow,
  workflowFromYaml,
  workflowToYaml,
} from '../workflow'

const canonicalWorkflow = `
id: planning-flow
default_delegation: subagent
steps:
  - id: research
    prompt: Gather the missing constraints.
    inputs: []
    skills:
      - name: grilling
        role: primary
  - id: plan
    inputs: [research]
    skills:
      - name: writing-plans
        role: primary
  - id: review
    inputs: [research]
    skills:
      - name: reviewer
        role: primary
  - id: final
    inputs: [plan, review]
    skills:
      - name: synthesizer
        role: primary
`

describe('step-owned workflow artifacts', () => {
  it('derives a step artifact identifier and path from its id', () => {
    const step = { id: 'research' }
    expect(artifactIdForStep(step)).toBe('research')
    expect(artifactPathForStep(step)).toBe('.workflow/artifacts/research.md')
  })

  it('parses roots, child inputs, fan-out, joins, and prompts', () => {
    const workflow = workflowFromYaml(canonicalWorkflow)
    expect(workflow.steps[0]?.prompt).toBe('Gather the missing constraints.')
    expect(workflow.steps[0]?.inputs).toEqual([])
    expect(rootStepIds(workflow)).toEqual(['research'])
    expect(successorIdsForStep(workflow, 'research')).toEqual(['plan', 'review'])
    expect(readyStepIds(workflow, new Set(['research']))).toEqual(['plan', 'review'])
    expect(validateWorkflow(workflow)).toEqual([])
  })

  it('normalizes redundant legacy artifact fields out of canonical serialization', () => {
    const workflow = workflowFromYaml(`
id: planning-flow
artifact_root: .workflow/artifacts
steps:
  - id: research
    outputs: [research]
    inputs: []
    skills:
      - name: grilling
        role: primary
        artifact: research
        output_file: .workflow/artifacts/research.md
`)
    const serialized = workflowToYaml(workflow)
    expect(serialized).toContain('inputs: []')
    expect(serialized).not.toMatch(/artifact_root|outputs:|artifact:|output_file:|on_exists:/)
  })

  it.each([
    ['artifact_root', canonicalWorkflow.replace('steps:', 'artifact_root: custom/artifacts\nsteps:')],
    ['steps[0].outputs', canonicalWorkflow.replace('prompt: Gather the missing constraints.', 'outputs: [another-artifact]\n    prompt: Gather the missing constraints.')],
    ['steps[0].skills[0].artifact', canonicalWorkflow.replace('role: primary', 'role: primary\n        artifact: another-artifact')],
    ['steps[0].skills[0].output_file', canonicalWorkflow.replace('role: primary', 'role: primary\n        output_file: .workflow/artifacts/another-artifact.md')],
  ])('rejects mismatched legacy %s fields', (field, source) => expect(() => workflowFromYaml(source)).toThrow(field))

  it('rejects retired controls and binding overrides with migration diagnostics', () => {
    expect(() => workflowFromYaml(canonicalWorkflow.replace('inputs: []', 'inputs: []\n    on_success: plan'))).toThrow('steps[0].on_success')
    expect(() => workflowFromYaml(canonicalWorkflow.replace('role: primary', 'role: primary\n        required: true'))).toThrow('steps[0].skills[0].required')
    expect(() => workflowFromYaml(canonicalWorkflow.replace('default_delegation: subagent', 'default_delegation: subagent\ndefault_invocation: compose'))).toThrow('default_invocation')
  })

  it('validates primaries, IDs, ordering, roots, and cycles', () => {
    const workflow = workflowFromYaml(canonicalWorkflow)
    const invalid = structuredClone(workflow)
    invalid.steps[0]!.skills = [{ name: 'reviewer', role: 'review' }]
    invalid.steps[1]!.inputs = ['missing']
    invalid.steps[2]!.inputs = ['final']
    invalid.steps[3]!.skills = []
    expect(validateWorkflow(invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining('exactamente una Skill principal'),
      expect.stringContaining('no existe'),
      expect.stringContaining('solo puede usar etapas anteriores'),
      expect.stringContaining('no tiene ninguna Skill'),
    ]))
  })

  it('requires inputs arrays and serializes only canonical fields', () => {
    expect(() => workflowFromYaml(`id: invalid\nsteps:\n  - id: root\n    skills: []`)).toThrow('steps[0].inputs')
    const serialized = workflowToYaml(workflowFromYaml(canonicalWorkflow))
    expect(serialized).toContain('default_delegation: subagent')
    expect(serialized).toContain('inputs: []')
    expect(serialized).not.toMatch(/execution|completion|on_success|on_blocked|invocation|required|outputs/)
  })
})
