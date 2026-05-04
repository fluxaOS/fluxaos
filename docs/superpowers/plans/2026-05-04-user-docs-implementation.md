# User Docs + Doc-Drift Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docusaurus docs site at `website/docs-site/` served at `fluxaos.io/docs`, populate it with 18 pages covering the full user lifecycle (concepts, guides, reference), and add a GitHub Action that hard-gates critical doc paths and posts LLM-powered soft nudges on every code PR.

**Architecture:** Self-contained Docusaurus project at `website/docs-site/` with its own `package.json`. Vercel serves two build targets from one repo via `vercel.json` at the repo root. A GitHub Action (`.github/workflows/doc-drift.yml`) reads a declarative map (`.github/doc-drift-map.yml`) for the hard gate and calls the Anthropic API for the soft nudge.

**Tech Stack:** Docusaurus 3 (classic theme), Node 22, TypeScript, GitHub Actions, Anthropic SDK (`@anthropic-ai/sdk`), YAML parsing (`js-yaml`), Vercel monorepo deployment.

**Spec:** `docs/superpowers/specs/2026-05-04-user-docs-design.md`

---

## File Map

### New files — Docusaurus scaffold
- `website/docs-site/package.json` — standalone Docusaurus project
- `website/docs-site/docusaurus.config.ts` — site config (title, baseUrl `/docs`, navbar, footer)
- `website/docs-site/sidebars.ts` — sidebar structure (concepts / guides / reference)
- `website/docs-site/tsconfig.json` — TypeScript config for Docusaurus
- `website/docs-site/src/css/custom.css` — brand color overrides (minimal)
- `website/docs-site/static/img/logo.svg` — placeholder SVG logo

### New files — doc content (concepts, 7 pages)
- `website/docs-site/docs/concepts/index.md`
- `website/docs-site/docs/concepts/skills.md`
- `website/docs-site/docs/concepts/drivers.md`
- `website/docs-site/docs/concepts/pipelines.md`
- `website/docs-site/docs/concepts/gates.md`
- `website/docs-site/docs/concepts/signals.md`
- `website/docs-site/docs/concepts/state-vs-status.md`

### New files — doc content (guides, 5 pages)
- `website/docs-site/docs/guides/01-first-setup.md`
- `website/docs-site/docs/guides/02-build-a-pipeline.md`
- `website/docs-site/docs/guides/03-add-an-issue.md`
- `website/docs-site/docs/guides/04-run-a-pipeline.md`
- `website/docs-site/docs/guides/05-read-the-results.md`

### New files — doc content (reference, 6 pages)
- `website/docs-site/docs/reference/env-vars.md`
- `website/docs-site/docs/reference/signal-types.md`
- `website/docs-site/docs/reference/gate-rules.md`
- `website/docs-site/docs/reference/issue-states.md`
- `website/docs-site/docs/reference/playbook-schema.md`
- `website/docs-site/docs/reference/daemon.md`

### New files — Vercel + deployment
- `vercel.json` — monorepo config: two build targets (website + docs-site)

### New files — doc-drift Action
- `.github/doc-drift-map.yml` — declarative critical-path→doc mappings
- `.github/workflows/doc-drift.yml` — GitHub Action (hard gate + LLM nudge)
- `.github/scripts/doc-drift.mjs` — Node script run by the Action

---

## Task 1: File Linear issue

**Files:**
- No code changes — Linear MCP only

- [ ] **Step 1: Create the Linear issue**

Use `mcp__plugin_linear_linear__save_issue` with:
```json
{
  "teamId": "<FLX team ID>",
  "title": "User docs site + doc-drift prevention (Docusaurus + GitHub Action)",
  "description": "Build user-facing docs at fluxaos.io/docs using Docusaurus. 18 pages: 7 concepts, 5 guides (full lifecycle), 6 reference. Add hybrid doc-drift GitHub Action: hard gate via file-path map + LLM soft nudge via Claude API.\n\nSpec: docs/superpowers/specs/2026-05-04-user-docs-design.md\nPlan: docs/superpowers/plans/2026-05-04-user-docs-implementation.md",
  "priority": 2
}
```

- [ ] **Step 2: Note the issue ID**

Record the returned issue ID (e.g. `FLX-NNN`) — use it in all commit trailers for this work.

---

## Task 2: Docusaurus scaffold

**Files:**
- Create: `website/docs-site/package.json`
- Create: `website/docs-site/docusaurus.config.ts`
- Create: `website/docs-site/sidebars.ts`
- Create: `website/docs-site/tsconfig.json`
- Create: `website/docs-site/src/css/custom.css`
- Create: `website/docs-site/static/img/logo.svg`

- [ ] **Step 1: Create `website/docs-site/package.json`**

```json
{
  "name": "fluxaos-docs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "docusaurus": "docusaurus",
    "start": "docusaurus start",
    "build": "docusaurus build",
    "swizzle": "docusaurus swizzle",
    "deploy": "docusaurus deploy",
    "clear": "docusaurus clear",
    "serve": "docusaurus serve",
    "write-translations": "docusaurus write-translations",
    "write-heading-ids": "docusaurus write-heading-ids"
  },
  "dependencies": {
    "@docusaurus/core": "3.7.0",
    "@docusaurus/preset-classic": "3.7.0",
    "@mdx-js/react": "^3.0.0",
    "clsx": "^2.0.0",
    "prism-react-renderer": "^2.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@docusaurus/module-type-aliases": "3.7.0",
    "@docusaurus/tsconfig": "3.7.0",
    "@docusaurus/types": "3.7.0",
    "typescript": "~5.6.2"
  },
  "engines": {
    "node": ">=18.0"
  },
  "browserslist": {
    "production": [">0.5%", "not dead", "not op_mini all"],
    "development": ["last 3 chrome version", "last 3 firefox version", "last 3 safari version"]
  }
}
```

- [ ] **Step 2: Create `website/docs-site/tsconfig.json`**

```json
{
  "extends": "@docusaurus/tsconfig",
  "compilerOptions": {
    "baseUrl": "."
  }
}
```

- [ ] **Step 3: Create `website/docs-site/docusaurus.config.ts`**

```typescript
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'fluxaOS Docs',
  tagline: 'AI orchestration OS — documentation',
  favicon: 'img/logo.svg',

  url: 'https://fluxaos.io',
  baseUrl: '/docs/',

  organizationName: 'fluxaos',
  projectName: 'fluxaos',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: 'https://github.com/jpierce/fluxaos/tree/main/website/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'fluxaOS',
      logo: {
        alt: 'fluxaOS Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://fluxaos.io',
          label: 'Home',
          position: 'right',
        },
        {
          href: 'https://github.com/jpierce/fluxaos',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [],
      copyright: `Copyright © ${new Date().getFullYear()} fluxaOS.`,
    },
    prism: {
      theme: { plain: { color: '#393A34', backgroundColor: '#f6f8fa' }, styles: [] },
      darkTheme: { plain: { color: '#F8F8F2', backgroundColor: '#282A36' }, styles: [] },
      additionalLanguages: ['bash', 'yaml', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
```

- [ ] **Step 4: Create `website/docs-site/sidebars.ts`**

```typescript
import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/index',
        'concepts/skills',
        'concepts/drivers',
        'concepts/pipelines',
        'concepts/gates',
        'concepts/signals',
        'concepts/state-vs-status',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/01-first-setup',
        'guides/02-build-a-pipeline',
        'guides/03-add-an-issue',
        'guides/04-run-a-pipeline',
        'guides/05-read-the-results',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/env-vars',
        'reference/signal-types',
        'reference/gate-rules',
        'reference/issue-states',
        'reference/playbook-schema',
        'reference/daemon',
      ],
    },
  ],
};

export default sidebars;
```

- [ ] **Step 5: Create `website/docs-site/src/css/custom.css`**

```css
:root {
  --ifm-color-primary: #6366f1;
  --ifm-color-primary-dark: #4f52e8;
  --ifm-color-primary-darker: #4346e3;
  --ifm-color-primary-darkest: #2c2fd4;
  --ifm-color-primary-light: #777af4;
  --ifm-color-primary-lighter: #8385f5;
  --ifm-color-primary-lightest: #a5a7f8;
  --ifm-code-font-size: 95%;
  --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.1);
}

[data-theme='dark'] {
  --ifm-color-primary: #818cf8;
  --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 6: Create placeholder logo at `website/docs-site/static/img/logo.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <circle cx="16" cy="16" r="14" stroke="#6366f1" stroke-width="2.5"/>
  <path d="M10 16 Q16 8 22 16 Q16 24 10 16Z" fill="#6366f1"/>
</svg>
```

- [ ] **Step 7: Install Docusaurus dependencies**

```bash
cd website/docs-site && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 8: Verify build works with empty docs**

Create a minimal placeholder to satisfy Docusaurus:

```bash
mkdir -p website/docs-site/docs
cat > website/docs-site/docs/concepts/index.md << 'EOF'
---
sidebar_position: 1
---
# What is fluxaOS?

Coming soon.
EOF
```

Then run:

```bash
cd website/docs-site && npm run build
```

Expected: `Build Success` with output in `website/docs-site/build/`.

- [ ] **Step 9: Commit scaffold**

```bash
git add website/docs-site/
git commit -m "feat: add Docusaurus scaffold at website/docs-site/

Refs FLX-NNN"
```

---

## Task 3: Vercel monorepo config

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create `vercel.json` at repo root**

```json
{
  "version": 2,
  "builds": [
    {
      "src": "website/package.json",
      "use": "@vercel/next"
    },
    {
      "src": "website/docs-site/package.json",
      "use": "@vercel/static-build",
      "config": {
        "distDir": "build"
      }
    }
  ],
  "routes": [
    {
      "src": "/docs/(.*)",
      "dest": "website/docs-site/build/$1"
    },
    {
      "src": "/(.*)",
      "dest": "website/$1"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: add Vercel monorepo config for website + docs-site

Routes /docs/* to Docusaurus build, /* to Next.js marketing site.

Refs FLX-NNN"
```

---

## Task 4: Concept pages (7 pages)

**Files:**
- Create: all 7 `website/docs-site/docs/concepts/*.md` files

Write each page as 2–3 paragraphs in plain English. No jargon without definition. Each page links to the relevant guide where appropriate.

- [ ] **Step 1: Write `concepts/index.md`**

```markdown
---
sidebar_position: 1
title: What is fluxaOS?
---

# What is fluxaOS?

fluxaOS is an AI orchestration OS — a config-driven engine that runs pipelines of AI-powered stages against issues (features, bugs, tasks). You describe what you want done; fluxaOS routes each issue through your pipeline, runs the right AI tool at each step, checks the output against your rules, and moves the issue forward automatically.

The key idea: fluxaOS is agnostic. It never knows what a "research" stage does or what "Claude Code" is. It reads your configuration from the database — which skills exist, which drivers run them, how they're wired together — and executes whatever you've configured. You can change the entire pipeline without touching code.

**The core concepts you need:**

- [Skills](./skills) — what to do (a prompt template)
- [Drivers](./drivers) — how to run it (a CLI tool configuration)
- [Pipelines](./pipelines) — the sequence of steps
- [Gates](./gates) — the quality checkpoint after each step
- [Signals](./signals) — how a stage tells the pipeline what happened
- [State vs Status](./state-vs-status) — the two independent fields on every issue

**Ready to use it?** Start with the [First Setup guide](../guides/01-first-setup).
```

- [ ] **Step 2: Write `concepts/skills.md`**

```markdown
---
sidebar_position: 2
title: Skills
---

# Skills

A skill is a named job definition — the *what* of a pipeline stage. At its core, a skill is a prompt template: the exact text sent to an AI driver when that stage runs.

Skills are reusable. The same "research" skill can be used in multiple pipelines. Skills can be scoped globally (available across all projects in your org) or scoped to a specific project.

**Key fields:**

| Field | Purpose |
|-------|---------|
| Name | Display name (e.g., "research", "implement") |
| Prompt template | The prompt text sent to the driver |
| Scope | `global` (org-wide) or `project` (this project only) |
| Description | Human-readable explanation of what the skill does |

The prompt template is plain text. The driver receives it as-is — fluxaOS injects context (issue details, run metadata) via context files in the workspace, not via template variables in the prompt itself.

**Where to configure:** Settings → Skills → New Skill
```

- [ ] **Step 3: Write `concepts/drivers.md`**

```markdown
---
sidebar_position: 3
title: Drivers
---

# Drivers

A driver is the *how* of a pipeline stage — it describes one AI CLI tool and how fluxaOS invokes it. Where a skill defines what the AI should do, the driver defines which binary runs it, how to pass the prompt, and what output format to expect.

fluxaOS ships with a seeded Claude Code driver (`binary: claude`). You can add drivers for any AI CLI tool by configuring the fields below.

**Key fields:**

| Field | Purpose |
|-------|---------|
| Binary | The CLI command to invoke (e.g., `claude`, `openai`) |
| Prompt transport | How the prompt is delivered: `stdin`, `argv`, or `file` |
| Output format | How to parse output: `stream-json` or `text` |
| Model flag | CLI flag for selecting the model (e.g., `--model`) |
| Env vars | Environment variables to inject at run time (e.g., API keys) |
| Context layout | Which files to write to the workspace before the stage runs |
| Is enabled | Toggle — disabled drivers cannot be selected for new stages |

**Where to configure:** Settings → Drivers → New Driver

For a step-by-step walkthrough, see [Guide 01: First Setup](../guides/01-first-setup).
```

- [ ] **Step 4: Write `concepts/pipelines.md`**

```markdown
---
sidebar_position: 4
title: Pipelines
---

# Pipelines

A pipeline is an ordered sequence of stages that processes an issue. Each stage runs a skill (the prompt) using a driver (the CLI tool), then evaluates a gate (the quality check) to decide what to do next.

Pipelines are config-driven. You define them in the UI: create a pipeline, add stages, assign a skill and driver to each stage, and set a gate mode. When you trigger a run, the orchestrator executes the stages in order — pausing at manual gates, routing to rework on failure, and moving the issue through its states as stages complete.

**A stage has:**

| Field | Purpose |
|-------|---------|
| Name | Descriptive label (often matches an issue state: "research", "implement") |
| Skill | What the AI does |
| Driver | Which CLI tool runs it |
| Gate mode | How to validate the output (`auto`, `rules`, `hold`) |
| Gate rules | Conditions that determine proceed / hold / rework / abort |
| Timeout | Seconds before the stage is force-killed (default: 300) |

**Pipeline types:** The standard pipeline is configured in the UI (database-backed stages). Advanced users can also define pipelines as YAML playbooks — see [Playbook Schema](../reference/playbook-schema) for the format.

**Where to configure:** Settings → Pipeline Settings → New Pipeline

For a step-by-step walkthrough, see [Guide 02: Build a Pipeline](../guides/02-build-a-pipeline).
```

- [ ] **Step 5: Write `concepts/gates.md`**

```markdown
---
sidebar_position: 5
title: Gates
---

# Gates

A gate is a quality checkpoint that runs after a stage completes. It evaluates conditions against the stage's output and produces a verdict that tells the pipeline what to do next.

Gates decouple quality policy from execution. You don't need to change the skill or driver to add a cost cap or a retry limit — you change the gate rules.

**Gate modes:**

| Mode | Behavior |
|------|---------|
| `auto` | Evaluate rules automatically; proceed if all pass |
| `rules` | Same as auto but verdict is explicitly displayed |
| `hold` | Always pause; requires manual approval to continue |
| `skip` | Do not evaluate; always proceed |

**Gate verdicts:**

| Verdict | Meaning |
|---------|---------|
| `proceed` | Move to the next stage |
| `hold` | Pause the run; wait for human approval, rework, or abort |
| `rework` | Route to the configured rework stage |
| `abort` | Stop the pipeline immediately; mark the run failed |

**Important:** A stage can exit with code 0 (success) and still fail its gate. Gate failure is independent of whether the subprocess ran cleanly. See [Signal Types](../reference/signal-types) for how skills influence gate outcomes.

For rule syntax and field reference, see [Gate Rules](../reference/gate-rules).
```

- [ ] **Step 6: Write `concepts/signals.md`**

```markdown
---
sidebar_position: 6
title: Signals
---

# Signals

A signal is how a stage communicates its outcome to the pipeline. After a stage's subprocess finishes, it writes a result document to a file at `$RESULT_DOC_PATH`. The orchestrator reads this file and uses it to route the pipeline.

The result document is a JSON file with these fields:

| Field | Required | Purpose |
|-------|----------|---------|
| `verdict` | Yes | `"pass"`, `"fail"`, or `"blocked"` |
| `summary` | Yes | One sentence describing what happened |
| `comment` | No | Text to post as a comment on the issue |
| `blockers` | No | Array of `{title, description}` objects |
| `artifacts` | No | Array of filenames produced in `$ARTIFACTS_DIR` |
| `meta.model` | No | Model identifier used |
| `meta.input_tokens` | No | Input token count |
| `meta.output_tokens` | No | Output token count |

**Verdict meanings:**

- `pass` — work is complete; gate rules are evaluated, then `onPass` routing applies
- `fail` — work was attempted but did not meet the bar; `onFail` routing applies
- `blocked` — the stage cannot continue; `fallback` routing applies

The orchestrator posts `comment` text to the issue, surfaces `blockers` in the UI, and records `artifacts` for download. Skills that don't write a result document are treated as `blocked`.

For the full list of routing fields and how they interact with gate verdicts, see [Signal Types](../reference/signal-types).
```

- [ ] **Step 7: Write `concepts/state-vs-status.md`**

```markdown
---
sidebar_position: 7
title: State vs Status
---

# State vs Status

This is the most commonly confused distinction in fluxaOS. Every issue has **two** independent fields: a **state** and a **status**. They mean different things and change at different times.

## State — Where is the issue in the workflow?

State represents the issue's position in the development lifecycle. It maps to pipeline stages: when the research stage completes successfully, the issue moves from `research` state to `implement` state.

| State | Meaning |
|-------|---------|
| `New` | Just created, not yet started |
| `Research` | Research stage running or queued |
| `Implement` | Implementation in progress |
| `Review` | Awaiting code review |
| `Rework` | Reviewer requested changes |
| `Deploy` | Approved, awaiting merge/deploy |
| `Complete` | Done — terminal state, issue is closed |

State transitions are controlled by the pipeline. The orchestrator moves the issue forward when a stage completes with a `pass` verdict. You can also move state manually in the UI. See [Issue States](../reference/issue-states) for the full transition table.

## Status — What is the system doing right now?

Status represents the operational condition of the issue — what fluxaOS is actively doing with it, regardless of where it is in the workflow.

| Status | Meaning |
|--------|---------|
| `Open` | Active, not currently running |
| `Queued` | A stage run is queued, waiting for the daemon |
| `Running` | A stage is actively executing right now |
| `Blocked` | Needs human intervention (skill emitted `blocked` verdict) |
| `Completed` | The most recent pipeline run finished |

Status changes automatically as the daemon picks up and executes runs. You do not set it manually.

## Why this matters

An issue can be in `Implement` state with `Running` status (a stage is executing), or `Implement` state with `Blocked` status (the stage ran but got stuck). The state tells you *where* in the pipeline the issue is; the status tells you *what's happening to it right now*.

When something goes wrong, check **both fields**: state tells you which stage to look at, status tells you whether the daemon is actively working on it.
```

- [ ] **Step 8: Commit concept pages**

```bash
git add website/docs-site/docs/concepts/
git commit -m "docs: add 7 concept pages (skills, drivers, pipelines, gates, signals, state-vs-status)

Refs FLX-NNN"
```

---

## Task 5: Guide pages (5 pages)

**Files:**
- Create: all 5 `website/docs-site/docs/guides/*.md` files

Guides are task-oriented and numbered. Each ends with a "Next" link to the following guide.

- [ ] **Step 1: Write `guides/01-first-setup.md`**

```markdown
---
sidebar_position: 1
title: "Guide 1: First Setup"
---

# Guide 1: First Setup

Before you can run a pipeline, you need two things configured: a **driver** (which AI CLI tool to use) and a **skill** (what to ask it to do). This guide walks through both.

## Prerequisites

- fluxaOS is running and you can reach the UI
- The daemon is running (if you see pipeline runs stuck at "Pending", the daemon is down — see [Daemon reference](../reference/daemon))
- You have an org, user, and project already created (these are seeded by default)

## Step 1: Configure a driver

A driver tells fluxaOS how to invoke an AI CLI tool. fluxaOS ships with a seeded "Claude Code" driver. If you want to use it as-is, skip to Step 2.

To create a new driver or review the existing one:

1. Navigate to **Settings → Drivers**
2. Click **New Driver** (or click an existing driver to expand it)
3. Fill in the required fields:
   - **Name**: A display name (e.g., "Claude Code")
   - **Slug**: A unique machine-readable ID (e.g., `claude-code`)
   - **Binary**: The CLI command (e.g., `claude`)
   - **Prompt transport**: How the prompt is delivered — use `stdin` for Claude Code
   - **Output format**: Use `stream-json` for Claude Code
   - **Context layout**: JSON describing which files to write to the workspace. For Claude Code, use:
     ```json
     { "instructionsFile": "CLAUDE.md", "contextFile": "context.md" }
     ```
4. Click **Create** (or **Save** if editing)
5. Make sure **Is Enabled** is checked — disabled drivers can't be used in pipeline stages

For a full field reference, see [Drivers](../concepts/drivers).

## Step 2: Create a skill

A skill is the prompt template that gets sent to the driver. Start simple.

1. Navigate to **Settings → Skills**
2. Click **New Skill**
3. Fill in:
   - **Name**: Something descriptive (e.g., "research")
   - **Scope**: `global` (available across all projects) or `project` (this project only)
   - **Prompt template**: The prompt to send. Example for a research skill:
     ```
     Read the issue carefully. Identify the affected code areas, any relevant context,
     and what a good implementation approach would look like. Write a concise plan.
     Output your result document when done.
     ```
4. Click **Create**

Repeat to create additional skills (e.g., "implement", "review") as needed for your pipeline.

---

**Next:** [Guide 2: Build a Pipeline →](./02-build-a-pipeline)
```

- [ ] **Step 2: Write `guides/02-build-a-pipeline.md`**

```markdown
---
sidebar_position: 2
title: "Guide 2: Build a Pipeline"
---

# Guide 2: Build a Pipeline

A pipeline is an ordered sequence of stages. Each stage runs a skill using a driver, then evaluates a gate to decide what happens next. This guide walks through creating a pipeline and adding stages.

## Step 1: Create a pipeline

1. Navigate to **Settings → Pipeline Settings**
2. Click **New Pipeline**
3. Enter:
   - **Name**: e.g., "Standard Dev"
   - **Description**: optional
4. Click **Create**

## Step 2: Add stages

1. On the Pipeline Settings page, find your new pipeline and click **Stages**
2. Click **Add Stage**
3. For each stage, fill in:
   - **Stage Name**: e.g., "research" — this should match the issue state the stage corresponds to
   - **Skill**: select from the skills you created in Guide 1
   - **Driver**: select the driver you configured in Guide 1
   - **Gate Mode**: how to validate output after the stage runs:
     - `auto` — apply rules, proceed if all pass (best for automated workflows)
     - `hold` — always pause and wait for your manual approval
4. Click **Create**
5. Repeat to add all the stages you need (e.g., research → implement → review → deploy)

The stages run in the order you create them.

## Step 3: Set this pipeline as default

The default pipeline is triggered automatically when you click "Run Stage" on an issue.

1. On the Pipeline Settings page, find your pipeline
2. Click **Set as default**

## Example: a minimal 2-stage pipeline

| Stage | Skill | Driver | Gate mode |
|-------|-------|--------|-----------|
| research | research | Claude Code | auto |
| implement | implement | Claude Code | hold |

The `hold` gate on "implement" means you'll manually approve each implementation before it proceeds. Good for getting started.

## Adding gate rules

Gate rules let you define conditions that must pass before a stage proceeds. For example, to abort if a stage takes longer than 2 hours:

1. Set **Gate Mode** to `rules`
2. Add a rule:
   - Field: `timing.duration_sec`
   - Operator: `less_than`
   - Value: `7200`
   - Severity: `block`
   - On Fail: `abort`
   - Label: "2 hour cap"

For the full list of available fields and operators, see [Gate Rules](../reference/gate-rules).

---

**Next:** [Guide 3: Add an Issue →](./03-add-an-issue)
```

- [ ] **Step 3: Write `guides/03-add-an-issue.md`**

```markdown
---
sidebar_position: 3
title: "Guide 3: Add an Issue"
---

# Guide 3: Add an Issue

Issues are the units of work that pipelines operate on. This guide covers creating an issue and understanding the two fields you'll see change as it moves through the pipeline.

## Step 1: Create an issue

1. Navigate to your project's **Issues** page
2. Click **New Issue**
3. Fill in:
   - **Title**: A clear description of the work (e.g., "Add health check endpoint")
   - **Type**: Bug, Feature, or Task
   - **Priority**: Critical, High, Medium, or Low
   - **Description** (optional): Markdown-formatted context, requirements, or acceptance criteria
4. Click **Create**

The issue is created in **New** state with **Open** status.

## Step 2: Understand state and status

Every issue shows two badges: a **state** and a **status**. These are independent — see [State vs Status](../concepts/state-vs-status) for a full explanation.

**State** = where the issue is in the workflow:
- Starts at `New`
- Moves through `Research → Implement → Review → Rework → Deploy → Complete` as pipeline stages succeed
- You can also move state manually

**Status** = what fluxaOS is doing with it right now:
- `Open` — not currently running
- `Queued` — a run is waiting for the daemon
- `Running` — a stage is executing right now
- `Blocked` — needs your attention

## Step 3: Review the issue before running

Before triggering a pipeline, make sure:
- The title and description are clear (this is what the AI skill reads)
- The state is correct (the pipeline stage that runs will be matched to this state)
- You've set the default pipeline (from Guide 2)

---

**Next:** [Guide 4: Run a Pipeline →](./04-run-a-pipeline)
```

- [ ] **Step 4: Write `guides/04-run-a-pipeline.md`**

```markdown
---
sidebar_position: 4
title: "Guide 4: Run a Pipeline"
---

# Guide 4: Run a Pipeline

This guide covers triggering a pipeline run against an issue and understanding what happens during execution.

## Prerequisites

- Daemon is running (runs stay at "Pending" if it's not — see [Daemon](../reference/daemon))
- You have a default pipeline set on your project (Guide 2)
- You have an issue in a non-terminal state (Guide 3)

## Step 1: Trigger a run

1. Open the issue detail page
2. In the **Pipeline Stages** card, find the stage that matches the issue's current state
3. Click **Run Stage**

fluxaOS creates a `pipeline_run` and `stage_run` in `pending` status and returns immediately. The daemon picks up the run asynchronously.

## Step 2: Watch execution

The issue status changes to `Queued`, then `Running` as the daemon picks it up.

To see live output, click **View Details** on the run card (or open the Run Detail Modal). You'll see:

- **Status badge** — updates in real time: Pending → Running → Completed / Failed
- **Stage timeline** — each stage as a card, color-coded by status
- **Output tab** — live transcript of everything the AI printed, including tool calls, tool results, and final cost
- **Gates tab** — pass/fail for each gate rule (if configured)

The UI updates automatically via Supabase Realtime. If you don't see updates, check your network connection — see [Realtime dependency](../concepts/signals#realtime).

## Step 3: Handle a manual gate (hold)

If a stage has `gateMode: hold`, execution pauses after the stage completes. You'll see three buttons:

- **Approve** — proceed to the next stage
- **Rework** — mark the stage as failed and route to rework
- **Abort** — cancel the entire run

Review the stage output in the Output tab before deciding.

## Step 4: Check the issue state after the run

Once the run completes, the issue state advances automatically. If the research stage passed, the issue moves from `Research` to `Implement` state. The status returns to `Open` (ready for the next trigger) or `Blocked` (needs your attention).

To run the next stage, repeat from Step 1.

---

**Next:** [Guide 5: Read the Results →](./05-read-the-results)
```

- [ ] **Step 5: Write `guides/05-read-the-results.md`**

```markdown
---
sidebar_position: 5
title: "Guide 5: Read the Results"
---

# Guide 5: Read the Results

After a pipeline run completes, this guide shows you where to find each piece of information and what it means.

## The Run Detail Modal

Open a run from the issue page (click **View Details** or the run history entry). The modal has three main areas:

### Left panel — run metadata

- **Status** — final run status: Completed, Failed, Timed Out, Cancelled
- **Trigger** — always "manual" for user-triggered runs
- **Started / Duration** — when the run started and how long it took
- **Cost** — total cost in USD across all stages (only shown if > $0)
- **Stage timeline** — clickable list of all stages with status badges

### Right panel — stage details

Click any stage in the timeline to see its details:

**Output tab:**
- Full transcript of the stage's stdout, formatted as:
  - Text messages from the AI
  - Tool calls (e.g., bash commands the AI ran)
  - Tool results (indented; red border = error)
  - Final result with cost and token counts
- Toggle **Raw JSON** to see the raw event payloads (useful for debugging)
- Toggle **Verbose** to show lifecycle events (launched, completed) and all tool results

**Gates tab:**
- Shows pass/fail for each gate rule
- Green checkmark = rule passed
- Red X = rule failed, with the actual value that caused the failure
- Overall verdict: Proceed, Hold, Rework, or Abort

## The Activity Feed

The activity feed on the issue page shows **issue-level events** — not stage output. This includes:
- State changes (e.g., "Moved from Research to Implement")
- Comments posted by skills (from the result document's `comment` field)
- Blockers surfaced by skills

For stage output (the AI's actual work), always use the Run Detail Modal.

## Understanding costs and tokens

- **Cost** is the sum of all stage `costUsd` values from the result documents
- **Tokens** are broken into input and output, per stage
- Cost only appears if the driver reported it in the result document metadata (`meta.input_tokens`, `meta.output_tokens`)

## What to do when a run fails

1. Open the Run Detail Modal
2. Check the **Output tab** — look for the last tool call and its error output
3. Check the **Gates tab** — if a rule failed, the verdict and reason are shown there
4. Check the issue's **State and Status** — `Blocked` status means a skill emitted `blocked` verdict and needs your attention
5. Fix the underlying issue (update the skill prompt, fix the code, clear the blocker), then trigger a new run
```

- [ ] **Step 6: Commit guide pages**

```bash
git add website/docs-site/docs/guides/
git commit -m "docs: add 5 guide pages covering full pipeline lifecycle

Guides 01-05: first setup, build a pipeline, add an issue,
run a pipeline, read the results.

Refs FLX-NNN"
```

---

## Task 6: Reference pages (6 pages)

**Files:**
- Create: all 6 `website/docs-site/docs/reference/*.md` files

Reference pages are detailed and complete. They are linked from guides at the relevant step.

- [ ] **Step 1: Write `reference/env-vars.md`**

```markdown
---
sidebar_position: 1
title: Environment Variables
---

# Environment Variables

All `FLUXAOS_*` environment variables are read once at daemon startup via `src/config/env.ts` and injected into services. Nothing reads `process.env` directly after bootstrap.

Set these in `.env` (committed, non-secret defaults) or `.env.local` (gitignored, secrets and local overrides).

## Daemon — Required

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` | integer | none (required) | Seconds to wait for in-flight stage runs to drain after SIGTERM. Daemon refuses to start without it. |

## Pipeline execution

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_TARGET_REPO_PATH` | path | none | Absolute path to a local clone of the target repo. Stage runner refuses to acquire an isolation env without it. |
| `FLUXAOS_BUNDLED_PIPELINES_DIR` | path | `src/core/pipeline/bundled` | Path to bundled YAML playbook files. |
| `FLUXAOS_WORKSPACE_ROOT` | path | `<repo>/.fluxaos-worktrees/` | Where worktrees are created. Auto-added to target repo `.gitignore`. |
| `FLUXAOS_ARTIFACTS_ROOT` | path | `<repo>/.fluxaos-artifacts/` | Where per-run artifact directories live. Auto-added to target repo `.gitignore`. |

## Cleanup scheduler

The cleanup scheduler only runs if all four vars are set. Missing any one disables it (logged warning; app still boots).

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN` | integer | none | How often (minutes) the cleanup sweep runs. |
| `FLUXAOS_CLEANUP_STALE_DAYS` | integer | none | Age in days before a worktree is considered stale and removed. |
| `FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS` | integer | none | Age in days before terminal session data is purged. |
| `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` | integer | none | Age in days before terminal pipeline run artifact directories are reaped. |

## Daemon recovery

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | integer | none (optional) | If set, daemon runs crash recovery every N minutes. If unset, only the startup sweep runs. |

## Development / testing

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_TEST_TARGET_REPO` | string | none | `owner/repo` that deploy-touching e2e journey tests open PRs against. Specs skip cleanly when unset. |
| `FLUXAOS_LAN_AUTH_BYPASS` | `1` | none | Set to `1` to let Playwright skip `/login` on LAN access (homelab use). |
```

- [ ] **Step 2: Write `reference/signal-types.md`**

```markdown
---
sidebar_position: 2
title: Signal Types
---

# Signal Types

Signals are the verdicts a stage emits via its result document. The orchestrator reads the result document after a stage completes and routes the pipeline based on the verdict plus any gate rules.

## Result document verdicts

| Verdict | Meaning | Default routing |
|---------|---------|-----------------|
| `pass` | Work complete, meets the bar | Gate rules evaluated → `onPass` stage |
| `fail` | Work attempted but did not meet the bar | Gate rules evaluated → `onFail` stage |
| `blocked` | Stage cannot continue | Skip gate rules → `fallback` stage |

## How routing works

For `pass` and `fail` verdicts, gate rules are evaluated first. A gate rule failure can override the routing (e.g., `abort` overrides `onPass`). For `blocked`, routing goes directly to `fallback` — gate rules are not evaluated.

In a YAML playbook stage:

```yaml
- id: implement
  skill: implement
  onPass: review       # where to go on pass verdict (after gates pass)
  onFail: rework       # where to go on fail verdict (or gate failure)
  fallback: blocked    # where to go on blocked verdict
```

The special stage ID `complete` marks the pipeline as finished. The special stage ID `blocked` marks the pipeline as blocked (issue status → Blocked).

## Gate verdicts

Gate verdicts are produced by the gate engine after evaluating rules. They can override the result document's routing:

| Gate verdict | Effect |
|--------------|--------|
| `proceed` | Continue with the result-document routing |
| `hold` | Pause the pipeline; wait for manual approval |
| `rework` | Route to the `onFail` stage |
| `abort` | Stop the pipeline immediately; mark the run failed |

See [Gate Rules](./gate-rules) for how gate verdicts are produced.
```

- [ ] **Step 3: Write `reference/gate-rules.md`**

```markdown
---
sidebar_position: 3
title: Gate Rules
---

# Gate Rules

Gate rules define conditions that must pass before a stage proceeds. They're evaluated by the gate engine after a stage completes and produce a verdict that routes the pipeline.

## Rule structure

Each rule has five fields:

| Field | Type | Purpose |
|-------|------|---------|
| `field` | string | What to check (see fields table below) |
| `operator` | string | How to compare (see operators table below) |
| `value` | any | The threshold to compare against |
| `severity` | string | How bad a failure is (`warn`, `required`, `block`) |
| `onFail` | string | What to do when the rule fails |
| `label` | string | Human-readable description shown in the UI |

## Available fields

| Field | Type | Description |
|-------|------|-------------|
| `exit_code` | integer | Process exit code (0 = success) |
| `timing.duration_sec` | number | Stage duration in seconds |
| `cost.total_usd` | number | Total cost in USD |
| `tokens.input` | integer | Input token count |
| `tokens.output` | integer | Output token count |
| `verdict` | string | Result document verdict: `pass`, `fail`, `blocked` |
| `run.attempt` | integer | Attempt number (1 = first try, 2 = first retry, etc.) |

## Operators

| Operator | Meaning |
|----------|---------|
| `equals` | Exact match |
| `not_equals` | Not equal |
| `less_than` | Strictly less than |
| `less_than_or_equal` | Less than or equal |
| `greater_than` | Strictly greater than |
| `greater_than_or_equal` | Greater than or equal |

## Severity levels

| Severity | Meaning |
|----------|---------|
| `warn` | Rule failure is logged and shown in the UI but does not affect routing |
| `required` | Rule failure triggers `onFail` action |
| `block` | Same as `required` but displayed prominently as a blocker |

## onFail actions

| Action | Effect |
|--------|--------|
| `proceed` | Ignore the failure; continue |
| `hold` | Pause the run for manual decision |
| `rework` | Route to `onFail` stage |
| `abort` | Stop the pipeline; mark the run failed |
| `notify` | Log the failure (no routing change) |

## Verdict resolution

When multiple rules fail, the gate engine takes the **worst** `onFail` action across all failed rules (severity order: `abort` > `rework` > `hold` > `proceed`). That worst action becomes the gate verdict.

## Example

Abort if the implementation stage takes longer than 2 hours, and warn if it uses more than 100k tokens:

```yaml
rules:
  - field: timing.duration_sec
    operator: less_than
    value: 7200
    severity: block
    onFail: abort
    label: "2 hour cap"
  - field: tokens.input
    operator: less_than
    value: 100000
    severity: warn
    onFail: proceed
    label: "Token budget warning"
```
```

- [ ] **Step 4: Write `reference/issue-states.md`**

```markdown
---
sidebar_position: 4
title: Issue States
---

# Issue States

See [State vs Status](../concepts/state-vs-status) for an explanation of the difference between state and status.

## States

| State | Color | Terminal | Meaning |
|-------|-------|----------|---------|
| `New` | Gray | No | Just created, not yet started |
| `Research` | Blue | No | Research stage running or pending |
| `Implement` | Purple | No | Implementation in progress |
| `Review` | Amber | No | Awaiting code review |
| `Rework` | Red | No | Reviewer requested changes |
| `Deploy` | Green | No | Approved, awaiting merge/deploy |
| `Complete` | Teal | **Yes** | Done — issue is closed |

When an issue reaches `Complete`, `isClosed` is set to `true` and a `closedAt` timestamp is recorded. Issues in a terminal state cannot be transitioned to another state except by reopening (back to `Implement`).

## Valid transitions

| From | To | How |
|------|----|-----|
| `New` | `Research` | Pipeline trigger or manual |
| `New` | `Implement` | Manual (skip research) |
| `Research` | `Implement` | Research stage passes |
| `Implement` | `Review` | Implement stage passes |
| `Implement` | `Research` | Manual |
| `Review` | `Rework` | Review stage fails |
| `Review` | `Deploy` | Review stage passes |
| `Rework` | `Review` | Rework stage passes |
| `Deploy` | `Complete` | Deploy stage passes |
| `Complete` | `Implement` | Manual reopen |

## Statuses

| Status | Meaning |
|--------|---------|
| `Open` | Active, not currently running |
| `Queued` | In the queue, waiting for the daemon to pick it up |
| `Running` | A stage is actively executing |
| `Blocked` | Needs human intervention (skill emitted `blocked` verdict) |
| `Completed` | Most recent pipeline run finished |

Status is set automatically by the daemon. It is not user-configurable.

## Priorities

| Priority | Weight | Meaning |
|----------|--------|---------|
| `Critical` | 100 | Highest urgency |
| `High` | 200 | |
| `Medium` | 300 | |
| `Low` | 400 | Lowest urgency |

Lower weight = higher priority in queue ordering. The daemon picks up higher-priority runs first.
```

- [ ] **Step 5: Write `reference/playbook-schema.md`**

```markdown
---
sidebar_position: 5
title: Playbook Schema
---

# Playbook Schema

A playbook is a YAML file that defines a pipeline as a graph of stages. Playbooks are an alternative to database-configured pipelines — they're useful for bundling standard workflows with fluxaOS.

Playbooks live in the bundled pipelines directory (`FLUXAOS_BUNDLED_PIPELINES_DIR`, default: `src/core/pipeline/bundled/`).

## Top-level fields

| Field | Required | Type | Purpose |
|-------|----------|------|---------|
| `name` | Yes | string | Display name; used to look up the playbook |
| `description` | Yes | string | Human-readable description |
| `prompt` | Yes | string | System prompt injected into every stage's context |
| `stages` | Yes | array | One or more stage definitions |

## Stage types

### Sequential (default)

Runs one skill. If `type` is omitted, sequential is assumed.

```yaml
- id: research
  skill: research
  onPass: implement    # next stage on pass verdict
  onFail: research     # next stage on fail verdict
  fallback: blocked    # next stage on blocked verdict
  trustMode: prescriptive  # prescriptive | declarative
  rules: []            # gate rules (same format as UI rules)
```

| Field | Required | Default | Purpose |
|-------|----------|---------|---------|
| `id` | Yes | | Unique stage identifier within this playbook |
| `skill` | Yes | | Skill name to run |
| `onPass` | Yes | | Next stage ID on pass verdict |
| `onFail` | Yes | | Next stage ID on fail verdict |
| `fallback` | Yes | | Next stage ID on blocked verdict |
| `trustMode` | No | `prescriptive` | `prescriptive` = follow rules strictly; `declarative` = skill has more autonomy |
| `rules` | No | `[]` | Gate rules array |

### Loop node

Repeats a skill until a condition is met or a maximum iteration count is reached.

```yaml
- type: loop
  id: review-loop
  skill: code-review
  until: VERDICT_PASS       # stop condition
  maxIterations: 5          # hard cap
  onComplete: deploy        # next stage when loop exits successfully
  onExhausted: rework       # next stage when maxIterations is hit
  fallback: blocked         # next stage on blocked verdict
```

| Field | Required | Default | Purpose |
|-------|----------|---------|---------|
| `until` | Yes | | Stop condition (see below) |
| `maxIterations` | No | `10` | Maximum number of iterations before `onExhausted` |
| `onComplete` | Yes | | Next stage when the `until` condition is met |
| `onExhausted` | Yes | | Next stage when `maxIterations` is hit |

**`until` values:**

| Value | Meaning |
|-------|---------|
| `VERDICT_PASS` | Stop when skill emits `pass` verdict |
| `VERDICT_FAIL` | Stop when skill emits `fail` verdict |
| `ISSUE_OUT_OF_ACTIVE_STATE` | Stop if issue moved to a terminal state |
| `ALWAYS` | Always loop until `maxIterations` is hit |

## Special stage IDs

| ID | Meaning |
|----|---------|
| `complete` | Pipeline finishes successfully; issue moves to `Complete` state |
| `blocked` | Pipeline halts; issue status set to `Blocked` |

## Example: standard-dev playbook

```yaml
name: standard-dev
description: Research → implement → review → deploy with conditional rework.
prompt: |
  You are a fluxaOS pipeline agent running in headless, unattended mode.
  Your only job is to do the work your skill describes and produce an honest
  result document at the path in the ${RESULT_DOC_PATH} environment variable.

stages:
  - id: research
    skill: research
    onPass: implement
    onFail: research
    fallback: blocked

  - id: implement
    skill: implement
    onPass: review
    onFail: rework
    fallback: blocked
    rules:
      - field: timing.duration_sec
        operator: less_than
        value: 7200
        severity: warn
        onFail: hold
        label: Implementation time cap (2 hours)

  - id: review
    skill: review
    onPass: deploy
    onFail: rework
    fallback: blocked

  - id: rework
    skill: rework
    onPass: review
    onFail: blocked
    fallback: blocked
    rules:
      - field: run.attempt
        operator: less_than
        value: 4
        severity: block
        onFail: abort
        label: Rework attempt cap (3 max)

  - id: deploy
    skill: deploy
    onPass: complete
    onFail: blocked
    fallback: complete
```
```

- [ ] **Step 6: Write `reference/daemon.md`**

```markdown
---
sidebar_position: 6
title: The Daemon
---

# The Daemon

The orchestrator daemon is a long-running background process that executes pipeline runs. You do not start it by clicking "Run" in the UI — it runs continuously in the background.

## What it does

1. **Listens** for new `pipeline_run` rows via Supabase Realtime
2. **Executes** stage runs by spawning subprocesses (the AI CLI driver)
3. **Streams** output events back to the database as they arrive
4. **Evaluates** gates after each stage and routes to the next stage
5. **Transitions** issue states and statuses as stages complete
6. **Cleans up** stale worktrees and artifact directories
7. **Recovers** from crashes on startup (and periodically if configured)

## Starting the daemon

**Production (systemd):**
```bash
systemctl --user start fluxaos-daemon
systemctl --user status fluxaos-daemon
```

**Development:**
```bash
npm run daemon
```

The daemon reads all `FLUXAOS_*` environment variables at startup. `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` is required — the daemon refuses to start without it. See [Environment Variables](./env-vars).

## Checking if the daemon is running

If pipeline runs sit at **Pending** status and don't progress, the daemon is likely not running.

```bash
# Check systemd status
systemctl --user status fluxaos-daemon

# Or look for the process
ps aux | grep 'npm run daemon\|tsx.*daemon'
```

## Graceful shutdown

Send `SIGTERM` (systemd stop) or `Ctrl+C` (dev). The daemon:
1. Stops accepting new runs
2. Waits for running stages to finish (up to `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`)
3. Force-kills any stages still running after the grace period
4. Exits

Setting `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` too low (e.g., 5) will force-kill stages that are mid-execution. Recommended: 30–60 seconds.

## Crash recovery

On startup, the daemon scans for `stage_run` rows marked `running` whose process is no longer alive. It marks them as failed and routes the pipeline to the `onFail` stage.

If `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` is set, this scan also runs periodically. Without it, recovery only happens at startup.

## Live updates depend on the daemon

The UI updates in real time because the daemon writes to Supabase tables and Supabase Realtime pushes those changes to the browser. If the daemon is stopped mid-run:
- The run stays at its last known status in the UI
- Realtime will not deliver further updates for that run
- On daemon restart, crash recovery will detect the stale run and fail it forward
```

- [ ] **Step 7: Commit reference pages**

```bash
git add website/docs-site/docs/reference/
git commit -m "docs: add 6 reference pages (env-vars, signals, gate-rules, issue-states, playbook-schema, daemon)

Refs FLX-NNN"
```

---

## Task 7: Doc-drift map and GitHub Action

**Files:**
- Create: `.github/doc-drift-map.yml`
- Create: `.github/scripts/doc-drift.mjs`
- Create: `.github/workflows/doc-drift.yml`

- [ ] **Step 1: Create `.github/doc-drift-map.yml`**

```yaml
# Maps critical source files to their corresponding user doc pages.
# If a mapped source file changes in a PR and none of its docs change,
# the doc-drift Action fails the PR.
#
# Keep this list small — only files where a change almost certainly
# requires a doc update. Everything else is covered by the LLM soft nudge.

critical:
  - match: src/core/db/schema.ts
    docs:
      - website/docs-site/docs/reference/env-vars.md
      - website/docs-site/docs/reference/issue-states.md
      - website/docs-site/docs/reference/gate-rules.md
      - website/docs-site/docs/concepts/state-vs-status.md

  - match: src/core/pipeline/playbook.ts
    docs:
      - website/docs-site/docs/reference/playbook-schema.md

  - match: src/config/env.ts
    docs:
      - website/docs-site/docs/reference/env-vars.md

  - match: src/core/constants.ts
    docs:
      - website/docs-site/docs/reference/signal-types.md
      - website/docs-site/docs/reference/gate-rules.md

  - match: src/core/gates/types.ts
    docs:
      - website/docs-site/docs/reference/gate-rules.md
      - website/docs-site/docs/concepts/gates.md
```

- [ ] **Step 2: Create `.github/scripts/doc-drift.mjs`**

```javascript
#!/usr/bin/env node
// Doc-drift gate: hard gate (file-path map) + LLM soft nudge (Claude API).
// Called by .github/workflows/doc-drift.yml with env vars set by the workflow.
//
// Env vars required:
//   CHANGED_FILES   — newline-separated list of files changed in this PR
//   PR_DIFF         — full unified diff of the PR (for LLM nudge)
//   ANTHROPIC_API_KEY — for LLM nudge (optional; nudge skipped if absent)
//   GITHUB_TOKEN    — for posting the PR comment
//   GITHUB_REPOSITORY — e.g. "jpierce/fluxaos"
//   PR_NUMBER       — pull request number
//   MAP_FILE        — path to doc-drift-map.yml (default: .github/doc-drift-map.yml)

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const changedFiles = (process.env.CHANGED_FILES || '').split('\n').filter(Boolean);
const prDiff = process.env.PR_DIFF || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const githubToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = process.env.PR_NUMBER;
const mapFile = process.env.MAP_FILE || '.github/doc-drift-map.yml';

// ── Layer 1: Hard gate ─────────────────────────────────────────────────────

const map = yaml.load(fs.readFileSync(mapFile, 'utf-8'));
const violations = [];

for (const entry of map.critical) {
  const sourceChanged = changedFiles.some(f => f === entry.match || f.startsWith(entry.match));
  if (!sourceChanged) continue;

  const anyDocChanged = entry.docs.some(doc => changedFiles.includes(doc));
  if (!anyDocChanged) {
    violations.push({ source: entry.match, docs: entry.docs });
  }
}

if (violations.length > 0) {
  let msg = '❌ **Doc drift detected** — the following source files changed without updating their mapped doc pages:\n\n';
  for (const v of violations) {
    msg += `**\`${v.source}\`** changed but none of these doc pages were updated:\n`;
    for (const d of v.docs) {
      msg += `  - \`${d}\`\n`;
    }
    msg += '\n';
  }
  msg += '_Update at least one mapped doc page, or update `.github/doc-drift-map.yml` if the mapping is wrong._';
  console.error(msg.replace(/\*\*/g, '').replace(/`/g, ''));
  await postComment(msg);
  process.exit(1);
}

console.log('✅ Hard gate passed — no critical doc drift detected.');

// ── Layer 2: LLM soft nudge ────────────────────────────────────────────────

if (!anthropicKey) {
  console.log('ℹ️  ANTHROPIC_API_KEY not set — skipping LLM soft nudge.');
  process.exit(0);
}

if (!prDiff) {
  console.log('ℹ️  No PR diff available — skipping LLM soft nudge.');
  process.exit(0);
}

const docPages = [
  'concepts/index', 'concepts/skills', 'concepts/drivers', 'concepts/pipelines',
  'concepts/gates', 'concepts/signals', 'concepts/state-vs-status',
  'guides/01-first-setup', 'guides/02-build-a-pipeline', 'guides/03-add-an-issue',
  'guides/04-run-a-pipeline', 'guides/05-read-the-results',
  'reference/env-vars', 'reference/signal-types', 'reference/gate-rules',
  'reference/issue-states', 'reference/playbook-schema', 'reference/daemon',
];

const prompt = `You are reviewing a code diff for a product called fluxaOS — an AI orchestration OS that runs pipelines of AI-powered stages against software issues.

Determine whether any user-visible behavior changed in this diff. "User-visible" means: changes to how users configure skills, drivers, pipelines, or gates; changes to issue state/status transitions; changes to environment variables; changes to signal/verdict types; changes to the playbook YAML schema; changes to daemon behavior.

If user-visible behavior changed, identify which doc pages from the list below likely need updating.

Doc pages:
${docPages.map(p => `- ${p}`).join('\n')}

Reply with ONLY a JSON object (no markdown, no explanation):
{"changed": boolean, "pages": string[], "reason": string}

PR diff:
\`\`\`
${prDiff.slice(0, 8000)}
\`\`\``;

let nudgeComment = null;

try {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  const result = JSON.parse(text);

  if (result.changed && result.pages.length > 0) {
    nudgeComment = `💡 **Doc nudge** — Claude thinks this PR may affect user-visible behavior:\n\n> ${result.reason}\n\nConsider updating:\n${result.pages.map(p => `- \`${p}\``).join('\n')}\n\n_This is advisory only and does not block the PR._`;
    console.log('LLM nudge:', result.reason);
  } else {
    console.log('LLM nudge: no user-visible changes detected.');
  }
} catch (err) {
  console.warn('LLM nudge failed (non-blocking):', err.message);
}

if (nudgeComment) {
  await postComment(nudgeComment);
}

process.exit(0);

// ── Helpers ────────────────────────────────────────────────────────────────

async function postComment(body) {
  if (!githubToken || !repo || !prNumber) return;
  await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
}
```

- [ ] **Step 3: Create `.github/workflows/doc-drift.yml`**

```yaml
name: Doc Drift

on:
  pull_request:
    branches: [main]
    paths:
      - 'src/**'

jobs:
  doc-drift:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install js-yaml
        run: npm install js-yaml

      - name: Get changed files
        id: changed
        run: |
          git fetch origin ${{ github.base_ref }}
          CHANGED=$(git diff --name-only origin/${{ github.base_ref }}...HEAD)
          echo "files<<EOF" >> $GITHUB_OUTPUT
          echo "$CHANGED" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Get PR diff
        id: diff
        run: |
          DIFF=$(git diff origin/${{ github.base_ref }}...HEAD -- 'src/**')
          echo "diff<<EOF" >> $GITHUB_OUTPUT
          echo "$DIFF" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Run doc-drift gate
        env:
          CHANGED_FILES: ${{ steps.changed.outputs.files }}
          PR_DIFF: ${{ steps.diff.outputs.diff }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          MAP_FILE: .github/doc-drift-map.yml
        run: node .github/scripts/doc-drift.mjs
```

- [ ] **Step 4: Add `js-yaml` dependency note**

The doc-drift script requires `js-yaml` at runtime in the Action. This is installed inline (`npm install js-yaml`) in the workflow step — no changes to the main `package.json` needed.

- [ ] **Step 5: Commit drift gate**

```bash
git add .github/doc-drift-map.yml .github/scripts/doc-drift.mjs .github/workflows/doc-drift.yml
git commit -m "feat: add doc-drift GitHub Action (hard gate + LLM soft nudge)

Hard gate: fails PR if mapped source file changes without updating
any of its mapped doc pages.

LLM nudge: posts advisory comment via Claude Haiku if user-visible
behavior may have changed. Non-blocking. Requires ANTHROPIC_API_KEY
secret in the repo.

Refs FLX-NNN"
```

---

## Task 8: Wire up GitHub Actions secret and verify

**Files:**
- No code changes — GitHub settings + end-to-end verification

- [ ] **Step 1: Add `ANTHROPIC_API_KEY` secret to the repo**

In GitHub: Settings → Secrets and variables → Actions → New repository secret  
Name: `ANTHROPIC_API_KEY`  
Value: your Anthropic API key from `.env.local`

(The hard gate runs without this secret. The LLM nudge is skipped if the secret is absent.)

- [ ] **Step 2: Verify the Action triggers correctly**

Open a test PR that changes `src/core/constants.ts` without touching any doc files. Expected:
- Action runs
- Hard gate fails with message about `reference/signal-types.md` and `reference/gate-rules.md`
- PR is blocked

Then update `website/docs-site/docs/reference/signal-types.md` (add a whitespace change). Expected:
- Hard gate passes
- LLM nudge runs and posts an advisory comment (or posts nothing if no user-visible changes)

- [ ] **Step 3: Update Linear issue to In Review**

Use `mcp__plugin_linear_linear__save_issue` to set the issue status to "In Review" and attach the PR link.

---

## Task 9: Open PR and merge

**Files:**
- No code changes — git + GitHub operations

- [ ] **Step 1: Push the branch**

```bash
git push -u origin docs/user-docs-design
```

- [ ] **Step 2: Open a PR**

```bash
gh pr create \
  --title "feat: user docs site (Docusaurus) + doc-drift prevention GitHub Action" \
  --body "$(cat <<'EOF'
## Summary

- Docusaurus scaffold at `website/docs-site/`, served at `fluxaos.io/docs` via Vercel
- 18 doc pages: 7 concepts, 5 guides (full lifecycle 01–05), 6 reference
- Doc-drift GitHub Action: hard gate via `.github/doc-drift-map.yml` + LLM soft nudge via Claude Haiku
- `vercel.json` wires up monorepo two-build-target deployment

## Test plan

- [ ] `cd website/docs-site && npm run build` succeeds
- [ ] Docusaurus dev server shows all pages with correct sidebar
- [ ] Doc-drift Action triggers on a test PR that changes `src/core/constants.ts`
- [ ] Hard gate fails when no doc pages updated; passes when any mapped page touched
- [ ] LLM nudge posts advisory comment (requires `ANTHROPIC_API_KEY` secret)

Refs FLX-NNN
EOF
)"
```

- [ ] **Step 3: Merge and update Linear**

After CI passes and the Docusaurus build succeeds:

```bash
gh pr merge --squash --delete-branch
```

Then use `mcp__plugin_linear_linear__save_issue` to set the issue status to "Done" and attach the merged PR URL.

---

## Self-Review Notes

**Spec coverage:**
- ✅ Docusaurus scaffold at `website/docs-site/` — Task 2
- ✅ Vercel monorepo config — Task 3
- ✅ 7 concept pages — Task 4
- ✅ 5 guide pages (full lifecycle) — Task 5
- ✅ 6 reference pages — Task 6
- ✅ `.github/doc-drift-map.yml` — Task 7
- ✅ `.github/workflows/doc-drift.yml` (hard gate + LLM nudge) — Task 7
- ✅ Linear issue — Task 1

**No placeholders or TBDs** — all code blocks are complete and specific.

**Type/name consistency** — `doc-drift.mjs` uses `CHANGED_FILES`, `PR_DIFF`, `MAP_FILE` env vars consistently with the workflow definition.
