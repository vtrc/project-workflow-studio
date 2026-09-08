import type { SkillCatalog } from '../skillCatalog'

type CatalogState = 'unavailable' | 'missing' | 'invalid' | 'current' | 'stale'

type Props = {
  catalog: SkillCatalog | null
  state: CatalogState
  error: string | null
  canReload: boolean
}

export function SkillCatalogPanel({ catalog, state, error, canReload }: Props) {
  const message = state === 'unavailable'
    ? 'Abre la carpeta .workflow para consultar las Skills locales.'
    : state === 'missing'
      ? 'No se ha encontrado .workflow/skill-catalog.json. Puedes escribir el nombre de la Skill manualmente.'
      : state === 'invalid'
        ? error ?? 'El catálogo local no cumple el contrato esperado. Puedes escribir el nombre de la Skill manualmente.'
        : state === 'stale'
          ? 'El catálogo puede estar desactualizado. Regénéralo con Project Workflow y usa «Actualizar Skills» en una etapa.'
          : null

  return (
    <section className="skill-catalog" aria-labelledby="skill-catalog-title">
      <div className="skill-catalog-heading">
        <div>
          <p className="section-kicker">CATÁLOGO LOCAL</p>
          <h2 id="skill-catalog-title">Skills disponibles</h2>
        </div>
      </div>
      {message && <p className={`skill-catalog-note is-${state}`} role={state === 'invalid' ? 'alert' : 'status'}>{message}</p>}
      {catalog && <p className="skill-catalog-meta" role="status">{catalog.projectSkills.length + catalog.globalSkills.length} Skills disponibles · Generado <time dateTime={catalog.generatedAt}>{new Date(catalog.generatedAt).toLocaleString('es-ES')}</time></p>}
      {canReload && state !== 'current' && <p className="skill-catalog-help">Studio no puede regenerarlo: ejecuta Project Workflow y después usa «Actualizar Skills» en una etapa.</p>}
    </section>
  )
}
