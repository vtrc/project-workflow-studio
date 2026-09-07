# Project Workflow Studio — Agent Guide

## Purpose

Project Workflow Studio is a local React application for visually authoring and validating Project Workflow YAML recipes. It is an independent repository: do not move code into `project-workflow` or `realtime-voice-chat`, and do not treat this application as the instruction-only framework.

## Working agreement

- Keep changes scoped to the requested outcome.
- Preserve the YAML recipe contract; `src/workflow.ts` owns parsing, defaults, IDs, and validation.
- Keep UI copy in Spanish unless the user requests another language.
- Do not add secrets, local configuration, build output, `node_modules`, or `.workflow/artifacts/` to Git.
- Do not add, remove, or execute a Skill without an explicit user request.
- Do not push, publish, or change repository remotes unless the user explicitly authorizes it.

## Project map

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Application state, editor interactions, import, and export. |
| `src/components/` | Workflow node and inspector UI. |
| `src/workflow.ts` | YAML recipe parsing, default recipe, ID generation, and validation. |
| `src/types.ts` | Workflow recipe and Skill-binding types. |
| `.agents/skills/` | Versioned agent Skills, including `impeccable`. |

## Commands

```bash
npm run lint
npm run build
npm run dev
```

Run `npm run lint` and `npm run build` after code, configuration, documentation, or skill changes. Treat warnings emitted by third-party code under `.agents/skills/` separately from warnings in Studio source.

## UI work

For frontend design, accessibility, UX, or visual-polish work, read `.agents/skills/impeccable/SKILL.md` before editing. The Studio is an editor: clarity, scanability, keyboard accessibility, and predictable YAML behavior take priority over decorative effects.

## Git

Use focused conventional commits. Review staged changes before committing, check for secrets, and keep generated output out of the repository. The default branch is `main` and its remote is `origin`.
