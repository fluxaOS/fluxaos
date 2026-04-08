# fluxaOS Brand Guidelines

Version 1.0 — April 2026

---

## 1. Brand Identity

### Name

- **Full name:** fluxaOS
- **Capitalization:** Always lowercase "flux", uppercase "AOS" — `fluxaOS`
- **Never:** FluxAOS, Fluxaos, FLUXAOS, flux-aos, Flux AOS
- **Short form:** "flux" is acceptable in casual conversation, CLI commands, and internal references
- **Pronunciation:** "flux A-O-S" (not "flux-oss")

### Tagline

**Primary:** An OS for AI workflows
**Extended:** Configure. Orchestrate. Observe. — AI pipelines that run the way you designed them.

### Brand Personality

fluxaOS is **clean, technical, and quietly confident.**

| Trait | What it means | What it doesn't mean |
|-------|--------------|---------------------|
| Technical | Assumes competence, speaks precisely | Jargon-heavy, inaccessible |
| Confident | Knows what it is, doesn't oversell | Arrogant, dismissive |
| Minimal | Every element earns its place | Sparse, incomplete |
| Modern | Current practices, current aesthetics | Trendy, chasing fads |
| Open | Transparent, community-oriented | Naive, unstructured |

---

## 2. Color Palette

### Design Philosophy

Dark-first. The palette is built around a black-to-violet gradient that conveys depth, sophistication, and the "AI orchestration" identity. Violet is the signature color — it owns the brand.

### Primary Palette — Violet Gradient

These are the core brand colors. The gradient moves from deep black through rich violets to a bright accent.

| Name | Hex | RGB | HSL | Usage |
|------|-----|-----|-----|-------|
| Void | `#0B0014` | 11, 0, 20 | 273, 100%, 4% | Deepest background, app chrome |
| Abyss | `#150030` | 21, 0, 48 | 266, 100%, 9% | Primary dark surface |
| Deep Violet | `#2D1B69` | 45, 27, 105 | 254, 59%, 26% | Elevated surfaces, card backgrounds |
| Royal Violet | `#5B21B6` | 91, 33, 182 | 263, 69%, 42% | Primary brand color, buttons, links |
| Electric Violet | `#7C3AED` | 124, 58, 237 | 262, 83%, 58% | Accent, hover states, highlights |
| Soft Violet | `#A78BFA` | 167, 139, 250 | 255, 92%, 76% | Secondary text on dark, tags, badges |
| Pale Violet | `#DDD6FE` | 221, 214, 254 | 250, 91%, 92% | Subtle highlights, light mode accent bg |

### Neutral Palette — Slate

> **Implementation note:** This is Tailwind's built-in `slate` scale — use `bg-slate-800`, `text-slate-400`, etc. directly. Do not redeclare these as custom tokens.

For text, borders, and structural UI elements. Tailwind's slate is cool-toned and complements the violet naturally.

| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| Slate 950 | `#020617` | 2, 6, 23 | Near-black text (light mode) |
| Slate 900 | `#0F172A` | 15, 23, 42 | Alt dark background |
| Slate 800 | `#1E293B` | 30, 41, 59 | Dark mode card/surface |
| Slate 700 | `#334155` | 51, 65, 85 | Borders (dark mode) |
| Slate 600 | `#475569` | 71, 85, 105 | Muted text (dark mode) |
| Slate 500 | `#64748B` | 100, 116, 139 | Placeholder text |
| Slate 400 | `#94A3B8` | 148, 163, 184 | Secondary text (dark mode) |
| Slate 300 | `#CBD5E1` | 203, 213, 225 | Borders (light mode) |
| Slate 200 | `#E2E8F0` | 226, 232, 240 | Light mode surfaces |
| Slate 100 | `#F1F5F9` | 241, 245, 249 | Light mode background |
| Slate 50 | `#F8FAFC` | 248, 250, 252 | Lightest background |

### Semantic Colors

For UI states. These never represent the brand — only functional meaning.

| State | Color | Hex | Usage |
|-------|-------|-----|-------|
| Success | Green | `#188C42` | Passed gates, healthy providers, completed runs |
| Warning | Amber | `#F5A314` | Held gates, degraded providers, slow stages |
| Error | Red | `#CE1212` | Failed runs, errored stages, broken providers |
| Info | Blue | `#097FC3` | Informational banners, tips, neutral status |

### Color Usage Rules

1. **Violet is the brand.** Royal Violet (`#5B21B6`) is the primary — use it for primary actions, key UI elements, and brand moments.
2. **Never use semantic colors for decoration.** Green means success. Red means error. Always.
3. **Dark mode is the default.** Design dark first, adapt to light second.
4. **Contrast minimums:** All text must meet WCAG 2.1 AA (4.5:1 for body text, 3:1 for large text). Soft Violet on Abyss passes. Slate 400 on Void passes.
5. **The gradient is directional.** Dark at the top/left, lighter toward bottom/right — mirrors depth and emergence.

---

## 3. Typography

### Font Stack

| Role | Font | Fallback | Weight Range |
|------|------|----------|-------------|
| Headings | **Geist Sans** | Inter, system-ui, sans-serif | 500 (medium), 600 (semibold), 700 (bold) |
| Body | **Geist Sans** | Inter, system-ui, sans-serif | 400 (regular), 500 (medium) |
| Code / Mono | **Geist Mono** | JetBrains Mono, Fira Code, monospace | 400 (regular), 500 (medium) |

### Why Geist

- Designed by Vercel for developer tools — optimized for UI readability at small sizes
- Clean, geometric, modern without being sterile
- Geist Mono pairs perfectly — same design family
- Open source (SIL Open Font License)
- Ships with Next.js (`next/font`) — zero-config integration

### Type Scale

Base size: **16px** (1rem)

| Level | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Display | 2.25rem (36px) | 700 | 1.2 | Landing page hero |
| H1 | 1.875rem (30px) | 700 | 1.3 | Page titles |
| H2 | 1.5rem (24px) | 600 | 1.35 | Section headings |
| H3 | 1.25rem (20px) | 600 | 1.4 | Card titles, subsections |
| H4 | 1.125rem (18px) | 500 | 1.4 | Small headings |
| Body | 1rem (16px) | 400 | 1.6 | Default text |
| Body Small | 0.875rem (14px) | 400 | 1.5 | Secondary text, captions |
| Caption | 0.75rem (12px) | 500 | 1.5 | Labels, badges, metadata |
| Code | 0.875rem (14px) | 400 | 1.6 | Inline code, code blocks |

### Typography Rules

1. **One font family.** Geist Sans for everything except code. No mixing fonts for "variety."
2. **Weight over size.** Differentiate hierarchy with weight before reaching for larger sizes.
3. **Monospace is sacred.** Only use Geist Mono for actual code, file paths, CLI output, and technical identifiers. Never for decorative purposes.
4. **No all-caps headings.** Sentence case everywhere. "Pipeline configuration" not "PIPELINE CONFIGURATION."

---

## 4. Voice & Tone

### Core Voice

fluxaOS speaks like a **senior engineer explaining something to a peer** — clear, direct, assumes you know what you're doing, but doesn't make you feel stupid if you don't.

### Voice Attributes

| Attribute | Do | Don't |
|-----------|-----|-------|
| Direct | "Configure your routing profile" | "You may want to consider configuring..." |
| Precise | "The gate evaluated to `hold` — waiting for approval" | "Something went wrong with the gate" |
| Concise | "3 stages, 2 passed, 1 held" | "Your pipeline has completed running through three stages, of which two have successfully passed..." |
| Helpful | "No providers matched. Check your routing profile filters." | "Error: No provider found" |
| Human | "That pipeline took 4.2s — 60% faster than last run" | "Pipeline execution time: 4.2 seconds" |

### Tone by Context

| Context | Tone | Example |
|---------|------|---------|
| Documentation | Clear, instructional, practical | "Add a gate after the review stage to require approval before deploy." |
| UI labels | Short, scannable, noun-first | "Pipeline runs", "Active providers", "Gate status" |
| Error messages | Specific, actionable, no blame | "Connection to Redis failed at localhost:6379. Check that Redis is running." |
| Success states | Brief, factual, quietly positive | "Pipeline complete. 3/3 stages passed." |
| CLI output | Terse, structured, grep-friendly | "ok  stage:review  2.1s  gate:passed" |
| README / marketing | Confident, benefits-first, no hype | "An OS for AI workflows — configure pipelines, route to any provider, observe everything." |
| Commit messages | Imperative, specific | "Add gate evaluation to pipeline state machine" |

### Words We Use

| Concept | Use | Avoid |
|---------|-----|-------|
| The product | fluxaOS, flux | "the platform", "our solution" |
| Users | "you" | "the user", "customers" |
| AI models | providers, models | "AI", "artificial intelligence" (in UI — too vague) |
| Running a pipeline | "run", "execute" | "kick off", "fire up", "spin up" |
| Configuration | "configure", "set up" | "customize", "personalize" |
| Errors | "failed", "errored" | "oops", "uh oh", "something went wrong" |

### Words We Never Use

- "Revolutionary", "game-changing", "next-generation"
- "Leverage", "utilize", "synergy"
- "Simply", "just", "easily" (nothing is simple if you're debugging it at 2am)
- "World-class", "best-in-class", "enterprise-grade"
- "Powered by AI" (we ARE the AI orchestration layer — this is redundant)

---

## 5. Logo

### Current State

The logo is pending design. Until a final logo is produced, use the wordmark treatment below.

### Wordmark Specification

- Font: Geist Sans, weight 700
- Text: `fluxaOS`
- Color: White (`#FFFFFF`) on dark backgrounds, Void (`#0B0014`) on light backgrounds
- The "flux" portion may optionally use Electric Violet (`#7C3AED`) for emphasis

### Logo Concepts (for future design)

The "flux" concept suggests movement, flow, transformation. Potential directions:
- Abstract waveform or flow lines
- Geometric shape suggesting orchestration/routing (nodes + paths)
- Minimal circuit or pipeline glyph

### Usage Rules (once designed)

- Minimum clear space: 1x the height of the logo on all sides
- Minimum size: 24px height for digital
- Always use provided assets — never recreate, stretch, or recolor
- Monochrome (white or black) variant required for constrained contexts

---

## 6. Imagery & Iconography

### Icons

- **Style:** Outlined, 1.5px stroke, rounded caps
- **Recommended set:** Lucide Icons (open source, consistent with Geist aesthetic)
- **Size grid:** 16px, 20px, 24px
- **Color:** Inherit from text color by default; violet only for interactive/accent states

### Illustrations

Not planned for alpha. If introduced later:
- Geometric, abstract — no characters or cartoons
- Violet gradient palette
- Technical feel — circuit diagrams, flow charts, node graphs

### Screenshots & Previews

- Always show dark mode as the primary
- Include realistic data (not "lorem ipsum" or "test123")
- Capture at 2x resolution for retina displays

---

## 7. Spacing & Layout

> **Implementation note:** Spacing, border radius, and font sizes use Tailwind's built-in defaults. These are documented here for design reference only — use Tailwind utility classes (`p-4`, `gap-6`, `rounded-lg`, `text-sm`) directly. Do not redeclare them as custom tokens.

### Spacing Scale

Base unit: **4px**

| Token | Value | Usage |
|-------|-------|-------|
| space-1 | 4px | Tight gaps (icon-to-label) |
| space-2 | 8px | Compact padding |
| space-3 | 12px | Default gap |
| space-4 | 16px | Standard padding |
| space-6 | 24px | Section gaps |
| space-8 | 32px | Card padding |
| space-12 | 48px | Section separators |
| space-16 | 64px | Page sections |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| radius-sm | 4px | Tags, badges |
| radius-md | 8px | Buttons, inputs |
| radius-lg | 12px | Cards, panels |
| radius-xl | 16px | Modals, popovers |

### Layout Principles

1. **Consistent spacing.** Use the scale — don't eyeball it.
2. **Generous whitespace.** Let content breathe. Dev tools are data-dense; space prevents overwhelm.
3. **8px grid.** Align everything to an 8px grid for visual rhythm.
4. **Max content width:** 1280px for main content area.

---

## 8. Application

### GitHub README

- Banner: Dark gradient (Void → Deep Violet) with white wordmark centered
- Badges: Use shields.io with `?style=flat&color=5B21B6` for brand color
- Screenshot: Dark mode dashboard, realistic data

### CLI Output

- Use terminal default colors where possible
- Violet/purple for fluxaOS branding elements (logo, version)
- Standard ANSI: green=success, red=error, yellow=warning
- No emoji in structured output; optional in human-friendly messages

### Documentation Site (future)

- Dark mode default, light mode toggle
- Sidebar navigation with violet active state
- Code blocks with Abyss (`#150030`) background

### Docker Hub / Package Registries

- Avatar: Logo icon on Void background
- Description: Use the primary tagline

---

## 9. Quick Reference

### The Palette at a Glance

```
Brand:     #0B0014  #150030  #2D1B69  #5B21B6  #7C3AED  #A78BFA  #DDD6FE
Neutral:   #020617  #0F172A  #1E293B  #334155  #475569  #64748B  #94A3B8  #CBD5E1  #E2E8F0  #F1F5F9  #F8FAFC
Semantic:  #188C42 (success)  #F5A314 (warning)  #CE1212 (error)  #097FC3 (info)
```

### The Rules

1. Dark mode first
2. Violet is the brand — never semantic
3. One font: Geist (Sans + Mono)
4. Direct voice, no hype
5. fluxaOS — always this capitalization
6. WCAG AA contrast minimum

---

*Brand Guidelines v1.0 — Created April 2026*
*Review annually or when the product evolves significantly.*
