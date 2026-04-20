# Skill Index

Quick reference for skills bundled with NativeClaw. Load matched skills (max 3) at the start of a relevant task. No match = no skill — don't force-fit.

On any new task: scan this list, load skills whose description matches the work, then start.

---

## Core (always ship with template)

| Skill | When to use |
|---|---|
| [onboarding](onboarding/SKILL.md) | First-run configuration of SOUL.md + device.md. Auto-triggered when those files still contain `<!-- unfilled -->` markers. |
| [skill-creator](skill-creator/SKILL.md) | Create new skills, improve existing ones, or measure skill performance. |
| [mcp-builder](mcp-builder/SKILL.md) | Building a new MCP server (Python FastMCP or Node/TS MCP SDK) to expose an external API or service to the agent. |

## Design & Frontend

| Skill | When to use |
|---|---|
| [frontend-design](frontend-design/SKILL.md) | Creating distinctive, production-grade frontend interfaces with high design quality. |
| [web-design-guidelines](web-design-guidelines/SKILL.md) | Reviewing UI code for Vercel Web Interface Guidelines compliance. |
| [webapp-testing](webapp-testing/SKILL.md) | Interacting with and testing local web applications via Playwright. |
| [canvas-design](canvas-design/SKILL.md) | Creating visual art in `.png` and `.pdf` using a deliberate design philosophy. |
| [algorithmic-art](algorithmic-art/SKILL.md) | Creating algorithmic art using p5.js with seeded randomness and interactive params. |

## Document Handling

| Skill | When to use |
|---|---|
| [docx](docx/SKILL.md) | Any time a Word `.docx` is input or output — create, read, edit, manipulate. |
| [pdf](pdf/SKILL.md) | Any time a PDF file is involved — read, create, extract, modify. |
| [xlsx](xlsx/SKILL.md) | Any time a spreadsheet (`.xlsx`) is primary input or output. |
| [pptx](pptx/SKILL.md) | Any time a `.pptx` deck is input, output, or the target of edits. |

## Thinking & Process

| Skill | When to use |
|---|---|
| [brainstorming](brainstorming/SKILL.md) | Use BEFORE any creative work — features, components, content, planning. Produces a structured problem statement and solution space. |
| [ab-test-setup](ab-test-setup/SKILL.md) | Planning, designing, or implementing an A/B test / experiment. |

---

## Adding your own

Run the `skill-creator` skill and follow its flow. New skills land under `skills/<name>/SKILL.md` — add them to this index so they trigger.

## Removing skills you don't need

Skills are just folders. Delete any you won't use, then remove the row from this index.
