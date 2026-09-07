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
2. Pulsa **Abrir workflow** y selecciona `workflow.yaml` en tu máquina.
3. Añade etapas y conéctalas mediante `on_success`.
4. Configura entradas, salidas, delegación y las Skills de cada etapa.
5. Revisa los avisos de validación y pulsa **Guardar cambios** para escribir sobre el mismo archivo.

El Studio usa el selector de archivos del navegador: la ruta siempre la elige la persona. En navegadores compatibles con File System Access API, el permiso de escritura se solicita al guardar y no se sube el archivo a ningún servidor. Si el navegador no ofrece esa API, se puede importar el archivo y descargar una copia editada.

## Capacidades

- Diagrama interactivo de etapas y transiciones.
- Edición de propiedades del workflow y de cada etapa.
- Importación y exportación de YAML.
- Validación de identificadores, transiciones y asociaciones de Skills.
- Posicionamiento visual de los nodos del diagrama.

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
