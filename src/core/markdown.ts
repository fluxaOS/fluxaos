// Body HTML is rendered at write time from markdown.
// Keep this renderer dependency-free and escape-first: issue/comment bodies are
// user-authored, so every markdown production starts from escaped text.
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let blockquote: string[] = [];
  let codeFence: string[] | null = null;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    html.push(
      `<p>${renderInline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`
    );
    paragraph = [];
  }

  function flushList() {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  }

  function flushBlockquote() {
    if (blockquote.length === 0) return;
    html.push(
      `<blockquote>${renderInline(blockquote.join('\n')).replace(/\n/g, '<br>')}</blockquote>`
    );
    blockquote = [];
  }

  function closeBlocks() {
    flushParagraph();
    flushList();
    flushBlockquote();
  }

  for (const line of lines) {
    if (codeFence) {
      if (/^```/.test(line.trim())) {
        html.push(
          `<pre><code>${escapeHtml(codeFence.join('\n'))}</code></pre>`
        );
        codeFence = null;
      } else {
        codeFence.push(line);
      }
      continue;
    }

    if (/^```/.test(line.trim())) {
      closeBlocks();
      codeFence = [];
      continue;
    }

    if (!line.trim()) {
      closeBlocks();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      closeBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    if (unordered) {
      flushParagraph();
      flushBlockquote();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
        html.push('<ul>');
      }
      html.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushBlockquote();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
        html.push('<ol>');
      }
      html.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    const quote = /^\s*>\s?(.+)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      blockquote.push(quote[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(line);
  }

  if (codeFence) {
    html.push(`<pre><code>${escapeHtml(codeFence.join('\n'))}</code></pre>`);
  }
  closeBlocks();

  return html.join('');
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
