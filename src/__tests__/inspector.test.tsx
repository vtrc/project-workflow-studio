import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Inspector } from '../components/Inspector'
import type { WorkflowRecipe, WorkflowStep } from '../types'
import { orderedInputsAfterToggle } from '../workflow'

const clarifyStep: WorkflowStep = {
  id: 'clarify-request',
  inputs: [],
  skills: [{ name: 'grilling', role: 'primary' }],
}

const researchStep: WorkflowStep = {
  id: 'research',
  inputs: [],
  skills: [{ name: 'research', role: 'primary' }],
}

const step: WorkflowStep = {
  id: 'make-plan',
  prompt: 'Turn the clarified request into an executable plan.',
  inputs: ['clarify-request', 'research'],
  skills: [
    { name: 'writing-plans', role: 'primary' },
    { name: 'reviewer', role: 'review' },
  ],
}

const workflow: WorkflowRecipe = {
  id: 'planning-flow',
  default_delegation: 'subagent',
  steps: [clarifyStep, researchStep, step],
}

function renderStepInspector() {
  return renderToStaticMarkup(
    <Inspector
      workflow={workflow}
      selectedStep={step}
      validationIssues={[]}
      onWorkflowChange={() => undefined}
      onStepChange={() => undefined}
      onDuplicateStep={() => undefined}
      onDeleteStep={() => undefined}
      skillCatalog={null}
      onReloadSkills={() => undefined}
      canReloadSkills={false}
    />,
  )
}

describe('step-owned artifact inspector', () => {
  it('edits prompt and displays the derived artifact without retired producer controls', () => {
    const html = renderStepInspector()

    expect(html).toContain('id="step-prompt"')
    expect(html).toContain('Turn the clarified request into an executable plan.')
    expect(html).toContain('make-plan')
    expect(html).toContain('.workflow/artifacts/make-plan.md')
    expect(html).toContain('Marca una o varias etapas anteriores')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('step-input-clarify-request')
    expect(html).toContain('step-input-research')
    expect(html).toContain('Seleccionada')
    expect(html).not.toContain('<select id="step-inputs"')
    expect(html).not.toMatch(/skill-artifact|skill-output|skill-on-exists|artifact-root|Respaldo/)
  })

  it('keeps dependency selections in recipe order when toggling multiple inputs', () => {
    const preceding = [clarifyStep, researchStep]

    expect(orderedInputsAfterToggle(preceding, ['research'], 'clarify-request')).toEqual(['clarify-request', 'research'])
    expect(orderedInputsAfterToggle(preceding, ['clarify-request', 'research'], 'clarify-request')).toEqual(['research'])
    expect(orderedInputsAfterToggle(preceding, ['clarify-request', 'research'], 'research')).toEqual(['clarify-request'])
  })
})
