import { describe, expect, it } from 'vitest'
import {
  artifactIdForStep,
  artifactPathForStep,
  validateWorkflow,
  workflowFromYaml,
  workflowToYaml,
} from '../workflow'

const canonicalWorkflow = `
id: planning-flow
steps:
  - id: clarify-request
    prompt: Gather the missing constraints.
    inputs: [user-request]
    on_success: make-plan
    skills:
      - name: grilling
        role: primary
  - id: make-plan
    inputs: [clarify-request]
    on_success: complete
    skills:
      - name: writing-plans
        role: primary
      - name: reviewer
        role: review
`

describe('step-owned workflow artifacts', () => {
  it('derives a step artifact identifier and path from its id', () => {
    const step = { id: 'clarify-request' }

    expect(artifactIdForStep(step)).toBe('clarify-request')
    expect(artifactPathForStep(step)).toBe('.workflow/artifacts/clarify-request.md')
  })

  it('parses an optional step prompt into the canonical model', () => {
    const workflow = workflowFromYaml(canonicalWorkflow)

    expect(workflow.steps[0]?.prompt).toBe('Gather the missing constraints.')
    expect(workflow.steps[0]?.inputs).toEqual(['user-request'])
  })

  it('normalizes redundant legacy artifact fields out of the canonical model', () => {
    const workflow = workflowFromYaml(`
id: planning-flow
artifact_root: .workflow/artifacts
steps:
  - id: clarify-request
    outputs: [clarify-request]
    inputs: [user-request]
    on_success: complete
    skills:
      - name: grilling
        role: primary
        artifact: clarify-request
        output_file: .workflow/artifacts/clarify-request.md
`)

    expect(workflow).not.toHaveProperty('artifact_root')
    expect(workflow.steps[0]).not.toHaveProperty('outputs')
    expect(workflow.steps[0]?.skills[0]).not.toHaveProperty('artifact')
    expect(workflow.steps[0]?.skills[0]).not.toHaveProperty('output_file')
  })

  it.each([
    ['artifact_root', canonicalWorkflow.replace('steps:', 'artifact_root: custom/artifacts\nsteps:')],
    ['steps[0].outputs', canonicalWorkflow.replace('prompt: Gather the missing constraints.', 'outputs: [another-artifact]\n    prompt: Gather the missing constraints.')],
    ['steps[0].skills[0].artifact', canonicalWorkflow.replace('role: primary', 'role: primary\n        artifact: another-artifact')],
    ['steps[0].skills[0].output_file', canonicalWorkflow.replace('role: primary', 'role: primary\n        output_file: .workflow/artifacts/another-artifact.md')],
  ])('rejects a mismatched legacy %s field', (field, source) => {
    expect(() => workflowFromYaml(source)).toThrow(field)
  })

  it('rejects legacy collision and fallback producer settings with migration diagnostics', () => {
    expect(() => workflowFromYaml(canonicalWorkflow.replace('role: primary', 'role: primary\n        on_exists: version')))
      .toThrow('steps[0].skills[0].on_exists')
    expect(() => workflowFromYaml(canonicalWorkflow.replace('role: primary', 'role: fallback')))
      .toThrow('steps[0].skills[0].role')
  })

  it('validates one primary, preceding inputs, transitions, and non-empty skill lists', () => {
    const workflow = workflowFromYaml(canonicalWorkflow)
    expect(validateWorkflow(workflow)).toEqual([])

    const invalid = structuredClone(workflow)
    invalid.steps[0]!.skills = [{ name: 'reviewer', role: 'review' }]
    invalid.steps[1]!.inputs = ['make-plan']
    invalid.steps[1]!.on_success = 'clarify-request'
    invalid.steps[1]!.skills = []

    expect(validateWorkflow(invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining('exactamente una Skill principal'),
      expect.stringContaining('solo puede usar user-request o etapas anteriores'),
      expect.stringContaining('debe apuntar a una etapa posterior'),
      expect.stringContaining('no tiene ninguna Skill'),
    ]))
  })

  it('serializes only canonical fields while preserving prompts', () => {
    const serialized = workflowToYaml(workflowFromYaml(`
id: planning-flow
artifact_root: .workflow/artifacts
steps:
  - id: clarify-request
    prompt: Gather the missing constraints.
    outputs: [clarify-request]
    inputs: [user-request]
    on_success: complete
    skills:
      - name: grilling
        role: primary
        artifact: clarify-request
        output_file: .workflow/artifacts/clarify-request.md
`))

    expect(serialized).toContain('prompt: Gather the missing constraints.')
    expect(serialized).not.toMatch(/artifact_root|outputs:|artifact:|output_file:|on_exists:|fallback/)
  })
})
