# PAT Commercialization Strategy

**Date:** 2026-03-27
**Updated:** 2026-03-27
**Status:** Strategic planning — two-phase approach confirmed

---

## Executive Summary

PAT is an AI pipeline orchestrator that automates multi-stage software development workflows (research, implement, review, deploy) using AI coding agents. It's currently in alpha, transitioning from Forgejo-dependent issue tracking to a native issue system.

**The plan has two distinct phases:**

1. **Short-term: Ship current PAT as-is as an alpha Community Edition.** Get it on GitHub, get users, validate demand, collect feedback. The current codebase is battle-tested and functional — ship it.

2. **Long-term: Ground-up rewrite with commercial DNA.** Port the proven application logic (orchestrator, routing, personas, gates) into a new architecture built for multi-tenant, feature-gated, provider-agnostic commercial product from line one. This is the "TrueNAS SCALE" moment — same product vision, new foundation.

The alpha CE buys two things the rewrite can't: (1) real users telling you what actually matters, and (2) proof of demand that justifies the rewrite investment.

---

## The Two-Phase Plan

### Phase A: Alpha Community Edition (NOW → Q3 2026)

**Ship what works. Learn from real users.**

The current PAT codebase is functional and battle-tested on real issues. Ship it as an open-source alpha CE with honest labeling about its maturity. The goal is not revenue — it's signal.

**What ships as-is (already working):**
- Multi-stage pipeline orchestrator (state machine, gates, retry logic, reconciliation)
- Routing catalog with priority-based provider fallback chains
- Configurable agent personas per stage
- Real-time streaming dashboard (tmux → Postgres → SSE → React)
- Web UI for routing configuration, team management, settings
- Run history, cost tracking, success metrics
- Native issue system (in progress, replacing Forgejo dependency)

**What needs to be added for alpha launch:**
- GitHub/GitLab integration layer (biggest TAM unlock — goes from "Forgejo hobbyists" to "any dev team")
- Clean install experience (Docker Compose one-liner, minimal config)
- Documentation: README, quickstart, architecture overview
- License decision (AGPLv3 or BSL recommended)
- Telemetry opt-in (anonymous install count, pipeline runs — for demand validation)

**What does NOT need to be perfect:**
- Race conditions, timeouts — label as alpha, be transparent
- Single-user only — fine for alpha, users expect this
- tmux execution — works for self-hosted single-user
- No billing, no auth, no multi-tenancy — not needed for CE

**Success criteria for Phase A:**
- 100+ GitHub stars in first 3 months
- 20+ self-hosted installs (telemetry)
- 5+ community bug reports or feature requests
- At least 1 user running it on their own repos (not just kicking tires)
- Clear signal on what features matter most to real users

### Phase B: Commercial Rewrite (Q3 2026 → 2027, triggered by Phase A signal)

**Same app logic. New foundation. Built for commercial from line one.**

Only start this when Phase A proves demand. The rewrite ports forward the proven application logic but rebuilds the infrastructure layer with multi-tenant, feature-gated, provider-agnostic commercial architecture.

**What gets ported forward (proven code):**
- Orchestrator state machine and stage lifecycle
- Routing resolver logic (priority chains, fallback, health checks)
- Gate checker and transition rules
- Persona system and team compositions
- Pipeline configuration schema
- Dashboard UI components and real-time streaming patterns

**What gets rebuilt from scratch:**
- **Multi-tenant data layer** — tenant ID on every table, row-level security, tenant-scoped queries from day one
- **Auth and user model** — OAuth/SSO, API keys per user, RBAC, organization model
- **Agent execution** — containerized (K8s pods or Firecracker microVMs), not tmux. Proper isolation, resource limits, tenant boundaries
- **Provider-agnostic forge integration** — abstraction layer supporting GitHub, GitLab, Forgejo, Bitbucket. Not coupled to any single forge
- **Feature gating** — license key system for CE/Pro/Enterprise tiers, TrueNAS-style single codebase
- **Smart routing** — BridgeBench-powered model selection built into the routing resolver from the start (Issue #588)
- **Billing and metering** — Stripe integration, usage tracking, rate limiting
- **Observability** — Prometheus metrics, structured logging, health checks, alerting

**Architecture decisions for the rewrite:**
- PostgreSQL with row-level security for tenant isolation
- Kubernetes-native deployment (Helm chart)
- Event-driven architecture (replace polling with pub/sub)
- API-first design (OpenAPI spec, SDK generation)
- CI/CD from day one (not a homelab systemd unit)

**Tier structure (TrueNAS-style, single codebase, license key gated):**

| Feature | Community (Free) | Pro ($49-99/mo) | Enterprise (Custom) |
|---------|-----------------|-----------------|---------------------|
| Projects | 1 | Unlimited | Unlimited |
| Routing profiles | 1 | Unlimited | Unlimited |
| Agent personas | Built-in only | Custom | Custom + sharing |
| Smart routing (BridgeBench) | No | No | Yes |
| Scheduled overrides | No | Yes | Yes |
| GitHub/GitLab integration | 1 repo | Unlimited | Unlimited + Bitbucket |
| Priority support | No | Email | Dedicated |
| SSO / RBAC | No | No | Yes |
| Audit logging | No | No | Yes |
| Multi-tenant managed hosting | No | No | Yes (SaaS option) |

---

## Market Validation

### The Market Is Real

- **AI orchestration market:** $11B (2025) → $30.2B (2030), 22.3% CAGR
- **Agentic AI enterprise platforms:** $4.35B (2025) → $47.8B (2030), 61.5% CAGR
- **Comparable exits:** Devin ($10.2B valuation, $73M ARR), Cursor ($29.3B valuation, $1B+ ARR)

### Pain Points PAT Solves

- 66% of developers spend MORE time fixing AI-generated code (Stack Overflow 2025)
- Developer trust in AI accuracy fell to 29% even as adoption hit 84%
- No existing tool provides gated, multi-stage, issue-driven AI pipelines
- Cloud-only tools (Devin, Factory) can't serve regulated industries needing self-hosted

### PAT's Unique Position

No competitor combines all of:
1. Multi-stage pipeline with gates and retry logic
2. Configurable agent personas per stage
3. Issue-driven automation (not IDE-bound)
4. Self-hosted / forge-agnostic (native issue system replacing Forgejo dependency)
5. Provider-agnostic routing catalog with fallback chains
6. Real-time streaming dashboard

---

## Exit Strategy (Target: 2027-2028, demand-dependent)

**Only pursue after Phase B proves commercial traction.**

**Ideal acquirers:**
- DevOps platforms (GitLab, Atlassian) wanting AI pipeline capabilities
- AI companies (Anthropic, OpenAI) wanting orchestration infrastructure
- Enterprise software companies wanting to add AI dev automation

**What makes PAT acquirable:**
- Proven OSS traction + managed revenue
- Novel routing/orchestration IP (smart routing, BridgeBench integration)
- Community of users generating organic enterprise demand
- Clean multi-tenant architecture ready for scale

---

## Smart Routing — The Killer Feature

### Concept

PAT auto-routes issues to the best-performing LLM model for each task type, based on independent benchmark data from BridgeBench (https://www.bridgebench.ai/).

### How It Works

1. **PAT classifies issues by type** — security, refactoring, debugging, generation, UI, algorithms
2. **BridgeBench rankings feed a routing table** — e.g., Sonnet 4.6 leads security (85.3), GPT-5.4 Nano leads refactoring (98.3)
3. **PAT auto-routes to the best model the user has access to** — constrained by which provider API keys they've configured
4. **User can override** — manual priority, cost-optimized, or fully custom

### Three Routing Modes

- **Manual** — user picks model per stage (free tier)
- **Priority chain** — user defines fallback order per stage (pro tier, already implemented)
- **Smart routing** — BridgeBench-informed auto-selection optimized for task type + available providers (enterprise tier)

### Why This Is Defensible

- GitHub/GitLab can't build this — locked into provider partnerships (Copilot = OpenAI)
- Devin/Factory can't build this — they use their own models, not provider-agnostic
- Only an independent orchestrator can be truly provider-agnostic
- BridgeBench partnership creates data moat (PAT feeds ground-truth success rates back)

### BridgeBench Partnership Opportunity

- PAT operationalizes their rankings (first tool to do so)
- PAT generates real-world validation data (did the PR merge? did tests pass?)
- Co-marketing: "PAT uses BridgeBench to route your code to the best AI model"
- Elon Musk has already retweeted BridgeBench — mainstream credibility established

---

## Competitive Landscape Summary

| Tool | Multi-stage | Issue-driven | Self-hosted | Provider-agnostic | Smart routing |
|------|------------|-------------|-------------|-------------------|---------------|
| **PAT** | Yes | Yes | Yes | Yes | Planned |
| Devin | No | No | No | No | No |
| Factory | Partial | No | No | No | No |
| GitHub Copilot Agent | No | Yes (GitHub) | No | No | No |
| Google Antigravity | No | No | No | Partial | No |
| OpenHands | No | Partial | Yes | Partial | No |

---

## Risk Assessment (Devil's Advocate)

### Real Risks
1. **"Build it themselves" risk** — target customers are sophisticated enough to DIY
2. **Big player gravity** — GitHub/GitLab adding AI features to their platforms
3. **Timing** — market may consolidate before PAT reaches maturity
4. **Single-maintainer risk** — bus factor and velocity concerns
5. **Autonomous AI trust gap** — most orgs not ready for fully autonomous pipelines

### Mitigations
1. Smart routing + BridgeBench integration creates defensible moat
2. Provider-agnostic positioning is structurally impossible for platform-locked competitors
3. Open-source launch builds community before SaaS investment
4. Gates and review stages address the trust gap directly
5. Self-hosted model serves regulated industries that cloud-only competitors can't

---

## Key Metrics to Track

- GitHub stars / forks / contributors (community health)
- Self-hosted installs (demand validation)
- Pipeline runs per install (engagement/stickiness)
- Free → Pro conversion rate (monetization viability)
- BridgeBench routing accuracy vs manual selection (smart routing value proof)

---

## Next Steps

1. Complete native issue system (decouple from Forgejo)
2. Build GitHub/GitLab integration layer
3. Spec and implement smart routing (BridgeBench integration)
4. Reach out to BridgeMind team for API access / partnership
5. Prepare open-source launch (README, docs, install guide, license decision)
