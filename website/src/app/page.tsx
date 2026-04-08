import Link from 'next/link';

const features = [
  {
    title: 'Pipeline orchestration',
    description:
      'Multi-stage pipelines with configurable stages, retry logic, and sequential execution. Define the workflow once, run it on every issue.',
  },
  {
    title: 'Provider-agnostic routing',
    description:
      'Route to any AI provider — Anthropic, OpenAI, Ollama — via config, not code changes. Fallback chains handle failures automatically.',
  },
  {
    title: 'Gate-controlled quality',
    description:
      'A rules engine evaluates conditions between stages. Auto-approve, hold for human review, rework, or abort — per stage, per rule.',
  },
  {
    title: 'Configurable personas',
    description:
      'Define agent personalities, skills, and routing rules. Scope them globally or per-project with inheritance, forking, and overrides.',
  },
  {
    title: 'Real-time observability',
    description:
      'Stream every stage output live. Track tokens, costs, and success rates across all runs. Event-sourced from the ground up.',
  },
  {
    title: 'Self-hosted & open source',
    description:
      'Docker Compose deployment. Your data stays on your infrastructure. AGPLv3 licensed — inspect, modify, and contribute.',
  },
];

const steps = [
  {
    step: '01',
    title: 'Configure',
    description:
      'Define pipelines, personas, skills, and routing rules through the web UI or CLI. Everything is stored in the database — no config files to sync.',
  },
  {
    step: '02',
    title: 'Orchestrate',
    description:
      'fluxaOS routes work to the right provider, materializes skills to the workspace, executes stages, and evaluates gates between them.',
  },
  {
    step: '03',
    title: 'Observe',
    description:
      'Watch runs stream in real-time. Track costs per provider, per model, per project. Measure outcomes and iterate on your configuration.',
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden pt-32 pb-24 md:pt-44 md:pb-32">
        {/* Gradient background */}
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 0%, #2D1B69 0%, #150030 40%, #0B0014 80%)',
          }}
        />

        <div className="mx-auto max-w-4xl px-6 text-center">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white md:text-6xl">
            An OS for AI workflows
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400 md:text-xl">
            Configure. Orchestrate. Observe. — AI pipelines that run the way you
            designed them.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="https://github.com/fluxaOS/fluxaos#getting-started"
              className="rounded-lg bg-royal-violet px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-electric-violet"
            >
              Get started
            </Link>
            <a
              href="https://github.com/fluxaOS/fluxaos"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Everything you need to orchestrate AI
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              A config-driven engine that puts the pieces together — whatever
              those pieces are.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6 transition-colors hover:border-slate-600/50 hover:bg-slate-800/50"
              >
                <h3 className="text-base font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              How it works
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              Three steps from configuration to insight.
            </p>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {steps.map((item) => (
              <div key={item.step} className="relative">
                <span className="text-5xl font-bold text-deep-violet">
                  {item.step}
                </span>
                <h3 className="mt-4 text-xl font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Open source CTA */}
      <section id="open-source" className="py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Open source. Self-hosted. Yours.
          </h2>
          <p className="mt-4 text-lg text-slate-400">
            Get running in minutes with Docker Compose.
          </p>

          <div className="mx-auto mt-10 max-w-xl overflow-hidden rounded-lg border border-slate-700/50">
            <div className="flex items-center gap-2 border-b border-slate-700/50 bg-slate-800/60 px-4 py-2.5">
              <span className="h-3 w-3 rounded-full bg-slate-600" />
              <span className="h-3 w-3 rounded-full bg-slate-600" />
              <span className="h-3 w-3 rounded-full bg-slate-600" />
              <span className="ml-2 text-xs text-slate-500">terminal</span>
            </div>
            <pre className="overflow-x-auto bg-abyss p-5 text-left font-mono text-sm leading-relaxed text-slate-300">
              <code>{`git clone https://github.com/fluxaOS/fluxaos.git
cd fluxaos
cp .env.example .env
docker compose up`}</code>
            </pre>
          </div>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="https://github.com/fluxaOS/fluxaos"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-royal-violet px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-electric-violet"
            >
              Star on GitHub
            </a>
            <a
              href="https://github.com/fluxaOS/fluxaos#getting-started"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
            >
              Read the docs
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
