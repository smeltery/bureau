import type { DocPage } from '../pages.ts';
import { clientExample, endpoints } from '../examples.ts';

export function pageMarkdown(page?: DocPage): string {
  if (!page)
    return [
      '# Bureau API',
      'Script your self-hosted agent office. Authenticate every /api route with a personal API token: Authorization: Bearer <token>.',
      ...endpoints.map((endpoint) => `## ${endpoint.title}\n\n${endpoint.method} ${endpoint.path}\n\n${endpoint.description}\n\n\`\`\`sh\n${endpoint.example}\n\`\`\``),
      `## Scripting with fetch\n\n\`\`\`ts\n${clientExample}\n\`\`\``,
    ].join('\n\n');
  const parts = [`# ${page.title}`, page.description];
  for (const section of page.sections) {
    parts.push(`## ${section.title}`, ...section.paragraphs);
    if (section.diagram)
      parts.push(
        section.diagram === 'webhook'
          ? '```mermaid\nsequenceDiagram\n  participant GitHub\n  participant Bureau\n  participant Target as Agent or schedule\n  GitHub->>Bureau: Signed delivery\n  Bureau-->>GitHub: 202 accepted\n  Bureau->>Target: Selected payload fields\n```'
          : '```mermaid\nsequenceDiagram\n  participant Script\n  participant Bureau\n  participant Agent\n  Script->>Bureau: POST /api/agents/{id}/messages\n  Bureau-->>Script: messageId\n  Bureau->>Agent: Deliver or queue\n  Agent->>Bureau: Reply to token\n  Script->>Bureau: Drain inbox\n  Bureau-->>Script: Entries\n```',
      );
    if (section.items) parts.push(section.items.map((item) => `- ${item}`).join('\n'));
    if (section.table) {
      const rows = section.table.map((row) => `| ${row.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`);
      rows.splice(1, 0, `| ${section.table[0]?.map(() => '---').join(' | ')} |`);
      parts.push(rows.join('\n'));
    }
    if (section.code) parts.push(`\`\`\`${section.language?.toLowerCase() ?? ''}\n${section.code}\n\`\`\``);
    if (section.links) parts.push(section.links.map((link) => `- [${link.label}](${link.href})`).join('\n'));
  }
  return parts.join('\n\n');
}
