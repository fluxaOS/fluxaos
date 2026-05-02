export function composePrompt(
  basePrompt: string,
  skillPrompt: string,
  vars: Record<string, string> = {}
): string {
  const substitute = (text: string) =>
    Object.entries(vars).reduce(
      (acc, [key, value]) => acc.replaceAll(`\${${key}}`, value),
      text
    );

  return [substitute(basePrompt), substitute(skillPrompt)].join('\n\n---\n\n');
}
