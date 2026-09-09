import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Inspector } from '../components/Inspector'
import type { WorkflowRecipe, WorkflowStep } from '../types'

const step: WorkflowStep = {
  id: 'make-plan',
  prompt: 'Turn the clarified request into an executable plan.',
  inputs: ['clarify-request'],
  skills: [
    { name: 'writing-plans', role: 'primary' },
    { name: 'reviewer', role: 'review' },
  ],
}

const workflow: WorkflowRecipe = {
  id: 'planning-flow',
  default_delegation: 'subagent',
  steps: [step],
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
    expect(html).not.toMatch(/skill-artifact|skill-output|skill-on-exists|artifact-root|Respaldo/)
  })
})
