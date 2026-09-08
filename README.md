# Project Workflow Studio

**Editor visual para diseñar, revisar y exportar recetas YAML de Project Workflow.**

Project Workflow Studio ayuda a convertir un flujo de trabajo en un diagrama editable: etapas, transiciones, delegación, políticas de bloqueo y Skills. El resultado es una receta YAML que puede consumirse fuera del Studio.

## Inicio rápido

```bash
npm install
npm run dev
```

Vite mostrará la dirección local de la aplicación. Antes de compartir cambios, ejecuta:

```bash
npm run lint
npm run build
```

## Flujo de trabajo

1. Abre el [Studio publicado](https://vtrc.github.io/project-workflow-studio/).
2. Pulsa **Abrir workflow**. En navegadores compatibles, elige la carpeta raíz del proyecto: el Studio abre `workflow.yaml` (o la ruta relativa y segura de `?path=ruta/relativa/workflow.yaml`) y crea o reutiliza el historial local.
3. Si tu navegador no permite seleccionar carpetas, el mismo botón abre el selector de archivo. Ese modo conserva un historial temporal durante la sesión.
4. Añade etapas y conéctalas mediante `on_success`.
5. Configura las entradas, la delegación, el `step.prompt` opcional y las Skills de cada etapa. El artefacto de salida se deriva automáticamente.
6. Revisa los avisos de validación y pulsa **Guardar cambios** para escribir sobre el mismo archivo.

El Studio usa el selector de archivos del navegador: la ruta siempre la elige la persona. En navegadores compatibles con File System Access API, el permiso de escritura se solicita al guardar y no se sube el archivo a ningún servidor. Si el navegador no ofrece esa API, se puede importar el archivo y descargar una copia editada.

## Formato canónico de artefactos

Una receta describe la topología y el comportamiento de las etapas; el runtime registra la ejecución. Cada etapa tiene un único artefacto público: el identificador es `step.id` y su ruta se deriva como `.workflow/artifacts/<step.id>.md`.

```yaml
id: planning-flow
steps:
  - id: clarify-request
    prompt: Reúne las restricciones que falten antes de planificar.
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
      - name: plan-review
        role: review
```

El orquestador entrega los resultados de una etapa a la siguiente mediante `inputs`: `user-request` o los IDs de etapas anteriores. `step.prompt` es contexto opcional para las Skills compuestas; no crea otro artefacto. Cada etapa debe contener exactamente una Skill con el papel `primary`, que publica el artefacto derivado. Las Skills `supporting` y `review` colaboran o revisan ese resultado, pero no publican artefactos públicos separados.

Las revisiones, los checksums, el estado de ejecución, el linaje, las sustituciones y la gestión de colisiones pertenecen exclusivamente al registro de ejecución. Por tanto, `workflow.yaml` no incluye metadatos de revisión ni rutas de salida configurables por Skill.

### Importación de recetas anteriores

El Studio puede importar formatos anteriores cuando `artifact_root`, `outputs`, `artifact` y `output_file` repiten exactamente el ID y la ruta derivados. Al guardar, siempre exporta el formato canónico y elimina esos campos redundantes. Las recetas que definen una política `on_exists` o usan el papel `fallback` se rechazan con un diagnóstico de migración: esas decisiones ya no forman parte del YAML creado por usuarios.

## Historial local

Al abrir el workflow desde la carpeta raíz, el Studio guarda un historial lineal y local (incluidas las posiciones del diagrama) en:

```
.workflow/studio-history/
├── manifest.json
└── snapshots/
    └── snapshot-<id>.json
```

`manifest.json` declara la versión del esquema, la ruta YAML relativa, el cursor actual y los metadatos de cada versión. Las instantáneas contienen la receta y las posiciones, nunca permisos ni handles del navegador. El historial se agrupa mientras se escribe, conserva un número/tamaño acotado de versiones y descarta la rama de rehacer cuando se edita tras deshacer. Esta carpeta es una caché local, está ignorada por Git y no se carga a ningún servicio. Si falla el permiso o la escritura, el Studio muestra un aviso y mantiene el historial de la sesión. La ruta `path` solo acepta YAML relativo y seguro; no admite rutas absolutas ni segmentos `..`.

## Tema visual

El Studio sigue automáticamente el tema claro u oscuro seleccionado en el sistema operativo. Si el sistema cambia de tema mientras la aplicación está abierta, la interfaz se adapta sin recargar ni guardar una preferencia adicional en el navegador.

## Capacidades

- Diagrama interactivo de etapas y transiciones.
- Edición de propiedades del workflow y de cada etapa.
- Importación y exportación de YAML.
- Validación de identificadores, transiciones y asociaciones de Skills.
- Posicionamiento visual de los nodos del diagrama.
- Deshacer, rehacer y restauración de versiones desde un historial visible.

## Relación con Project Workflow

| Componente | Responsabilidad |
| --- | --- |
| **Project Workflow Studio** | Crea, edita y valida recetas YAML desde una interfaz visual. |
| **Skill `project-workflow`** | Interpreta y ejecuta esas recetas en el entorno donde esté instalada. |

El Studio **no ejecuta, instala ni distribuye** `project-workflow`. Ambos proyectos se integran mediante el formato de receta YAML, sin compartir código ni historial Git. El Studio tampoco forma parte del framework instruction-only.

## Desarrollo

| Comando | Uso |
| --- | --- |
| `npm run dev` | Inicia el entorno local de Vite. |
| `npm run lint` | Ejecuta Oxlint. |
| `npm run build` | Comprueba TypeScript y genera la compilación de producción. |
| `npm run preview` | Sirve la última compilación localmente. |

La aplicación está construida con React, TypeScript, Vite, React Flow y YAML. La lógica del formato y sus validaciones vive en `src/workflow.ts`; los tipos se definen en `src/types.ts`.

## Skills y responsabilidades

Las Skills pertenecen al repositorio [Project Workflow](https://github.com/vtrc/project-workflow), no a este Studio. El Studio solo proporciona la interfaz visual y no instala, distribuye ni ejecuta Skills.

## Publicación

El repositorio se publica en [github.com/vtrc/project-workflow-studio](https://github.com/vtrc/project-workflow-studio) y el Studio en [vtrc.github.io/project-workflow-studio](https://vtrc.github.io/project-workflow-studio/). GitHub Pages recompila `main` mediante Actions. La primera vez, una persona con permisos de administración debe seleccionar **Settings → Pages → GitHub Actions** como fuente de publicación.

## Límites del repositorio

Este repositorio contiene solo el Studio. No modifica ni comparte historial con `realtime-voice-chat`. Nunca se versionan dependencias, compilaciones, configuraciones locales, credenciales ni artefactos generados en `.workflow/artifacts/`.
