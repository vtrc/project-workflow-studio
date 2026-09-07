# Project Workflow Studio

Editor visual local para diseñar y validar recetas YAML de **Project Workflow**. Permite modelar etapas, transiciones, delegación y Skills, e importar o exportar el resultado como YAML.

## Inicio rápido

```bash
npm install
npm run dev
```

Abre la dirección que muestre Vite en el navegador. Para comprobar la aplicación antes de distribuirla:

```bash
npm run lint
npm run build
```

## Qué hace

- Crea y reorganiza etapas de un workflow en un diagrama visual.
- Configura inputs, outputs, transiciones, política de bloqueo y delegación.
- Asocia Skills a cada etapa y exporta una receta YAML.
- Importa recetas YAML y señala problemas de estructura antes de exportarlas.

## Relación con Project Workflow

| Componente | Responsabilidad |
| --- | --- |
| **Project Workflow Studio** | Interfaz visual para crear, editar y revisar recetas YAML. |
| **Skill `project-workflow`** | Interpreta y ejecuta las recetas en el entorno que la tenga instalada. |

El Studio **no instala, distribuye ni ejecuta** la Skill. Es una aplicación independiente y no forma parte del framework instruction-only. La compatibilidad se basa en el formato de receta YAML, no en una dependencia de código entre ambos proyectos.

## Publicación futura

La URL pública todavía está por decidir. Cuando exista, deberá documentarse aquí junto con el destino de despliegue y la versión publicada. Mientras tanto, el Studio se usa localmente con Vite.

## Límites del repositorio

Este repositorio contiene solo la aplicación Studio. No modifica ni comparte historial con `/Users/victor/Documents/Codex/2026-09-04/realtime-voice-chat`, y no incluye credenciales, artefactos locales de workflows ni resultados de compilación.
