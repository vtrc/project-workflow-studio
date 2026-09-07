import type { SkillCatalog } from '../skillCatalog'

type CatalogState = 'unavailable' | 'missing' | 'invalid' | 'current' | 'stale'

type Props = {
  catalog: SkillCatalog | null
  state: CatalogState
  error: string | null
  onReload: () => void
  canReload: boolean
}

const statusLabels = {
  valid: 'Válida',
  'missing-description': 'Sin descripción',
  invalid: 'Inválida',
  conflict: 'Conflicto',
} as const

export function SkillCatalogPanel({ catalog, state, error, onReload, canReload }: Props) {
  const message = state === 'unavailable'
    ? 'Abre el workflow desde la carpeta raíz para consultar el catálogo local.'
    : state === 'missing'
      ? 'No se ha encontrado .workflow/skill-catalog.json. La edición YAML sigue disponible.'
      : state === 'invalid'
        ? error ?? 'El catálogo local no cumple el contrato esperado.'
        : state === 'stale'
          ? 'El catálogo puede estar desactualizado. Regénéralo con Project Workflow y vuelve a cargarlo.'
          : null

  return (
    <section className="skill-catalog" aria-labelledby="skill-catalog-title">
      <div className="skill-catalog-heading">
        <div>
          <p className="section-kicker">CATÁLOGO LOCAL</p>
          <h2 id="skill-catalog-title">Skills disponibles</h2>
        </div>
        <button className="link-button" type="button" onClick={onReload} disabled={!canReload}>
          Actualizar catálogo
        </button>
      </div>
      {message && <p className={`skill-catalog-note is-${state}`} role={state === 'invalid' ? 'alert' : 'status'}>{message}</p>}
      {catalog && (
        <>
          <p className="skill-catalog-meta">
            Generado <time dateTime={catalog.generatedAt}>{new Date(catalog.generatedAt).toLocaleString('es-ES')}</time>
            {' · '}Generador {catalog.generator.version}
          </p>
          <SkillGroup title="Skills del proyecto" entries={catalog.projectSkills} />
          <SkillGroup title="Skills globales" entries={catalog.globalSkills} />
        </>
      )}
      {canReload && state !== 'current' && (
        <p className="skill-catalog-help">Studio no puede regenerarlo: ejecuta Project Workflow en el proyecto y pulsa «Actualizar catálogo».</p>
      )}
    </section>
  )
}

function SkillGroup({ title, entries }: { title: string; entries: SkillCatalog['projectSkills'] }) {
  return (
    <div className="skill-catalog-group">
      <h3>{title} <span>{entries.length}</span></h3>
      {entries.length === 0 ? <p className="skill-catalog-empty">No hay Skills registradas.</p> : (
        <ul className="skill-catalog-list">
          {entries.map((entry) => (
            <li key={`${entry.origin}:${entry.name}:${entry.relativePath ?? entry.globalRoot ?? ''}`} className="skill-catalog-entry">
              <div className="skill-catalog-entry-top">
                <strong>{entry.name}</strong>
                <span className={`skill-status skill-status-${entry.status}`}>{statusLabels[entry.status]}</span>
              </div>
              <p>{entry.description ?? entry.reason ?? 'Sin descripción declarada.'}</p>
              <small>{entry.origin === 'project' ? 'Proyecto' : 'Global'}{entry.version ? ` · v${entry.version}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
