// Inline SVG <img> via Next public folder. The SVGs use `fill="currentColor"`
// — but as <img>, currentColor resolves to black (the img's own root). We
// invert + bias brightness so they read as a uniform off-white wall on dark.

const VENDORS = [
  { slug: 'anthropic', name: 'Anthropic' },
  { slug: 'openai', name: 'OpenAI' },
  { slug: 'ollama', name: 'Ollama' },
  { slug: 'mistral', name: 'Mistral' },
  { slug: 'huggingface', name: 'Hugging Face' },
  { slug: 'google', name: 'Google' },
  { slug: 'meta', name: 'Meta' },
  { slug: 'databricks', name: 'Databricks' },
  { slug: 'replicate', name: 'Replicate' },
  { slug: 'perplexity', name: 'Perplexity' },
];

export function ProviderStrip() {
  return (
    <section className="border-y border-white/[0.07] bg-white/[0.01]">
      <div className="max-w-[1180px] mx-auto px-8 py-9 flex flex-col items-center gap-6">
        <div className="flx-mono text-center" style={{ letterSpacing: '0.18em' }}>
          ROUTES TO ANY PROVIDER
        </div>
        <div className="flex gap-12 flex-wrap items-center justify-center w-full">
          {VENDORS.map((v) => (
            <div
              key={v.slug}
              title={v.name}
              className="flex items-center justify-center h-9 opacity-45 hover:opacity-90 transition-opacity"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/logos/${v.slug}.svg`}
                alt={v.name}
                height={24}
                className="h-6 w-auto block"
                style={{
                  // black currentColor → white via invert
                  filter: 'invert(1) brightness(0.85)',
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
