// Body HTML is rendered at write time from markdown.
// Minimal placeholder: escape HTML, convert newlines to <br>, wrap in <p>.
// A proper markdown library will replace this later.
export function renderMarkdown(md: string): string {
  return (
    '<p>' +
    md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>') +
    '</p>'
  );
}
