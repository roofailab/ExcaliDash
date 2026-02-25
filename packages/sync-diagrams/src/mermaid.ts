import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function discoverMermaidFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.mermaid.md')) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

export function extractMermaidContent(filePath: string): { title: string; mermaidCode: string } {
  const content = readFileSync(filePath, 'utf-8');

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : '';

  const mermaidMatch = content.match(/```mermaid\r?\n([\s\S]*?)```/);
  if (!mermaidMatch || !mermaidMatch[1].trim()) {
    throw new Error(`No mermaid code block found in ${filePath}`);
  }
  const mermaidCode = mermaidMatch[1].trim();

  return { title, mermaidCode };
}

export function computeContentHash(filePath: string): string {
  const content = readFileSync(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}
