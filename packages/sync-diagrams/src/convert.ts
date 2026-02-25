import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';

export const DEFAULT_APP_STATE = {
  viewBackgroundColor: '#ffffff',
  currentItemFontFamily: 1,
  zoom: { value: 1 },
  scrollX: 0,
  scrollY: 0,
  theme: 'dark',
} as const;

// Singleton browser — amortises ~200ms Chromium startup across all conversions.
let _browser: Browser | null = null;

async function ensureBrowser(): Promise<Browser> {
  if (!_browser) _browser = await chromium.launch();
  return _browser;
}

export async function closeConvertBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

// Build a self-contained IIFE from local node_modules (no internet required).
// Cached in memory after the first call.
let _bundle: string | null = null;

async function getBrowserBundle(): Promise<string> {
  if (_bundle) return _bundle;

  const resolveDir = fileURLToPath(new URL('..', import.meta.url));
  const result = await build({
    stdin: {
      contents: `
        import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';
        globalThis.__parseMermaidToExcalidraw = parseMermaidToExcalidraw;
      `,
      resolveDir,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });

  _bundle = result.outputFiles[0].text;
  return _bundle;
}

// Converts skeleton elements returned by parseMermaidToExcalidraw into full
// ExcalidrawElements by adding required metadata fields.
// Because skeletons come from a real browser, positions/sizes are already
// correct — no scale heuristics needed.
function skeletonToElements(skeletons: unknown[]): unknown[] {
  const now = Date.now();
  const output: Record<string, unknown>[] = [];

  const baseDefaults = {
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    roughness: 1,
    opacity: 100,
    roundness: { type: 3 },
    frameId: null,
    link: null,
    locked: false,
    angle: 0,
  };

  for (const skeleton of skeletons) {
    const s = skeleton as Record<string, unknown>;
    const label = s['label'] as Record<string, unknown> | undefined;

    const meta = {
      updated: now,
      version: 1,
      isDeleted: false,
      seed: randomInt(0, 2 ** 31 - 1),
      versionNonce: randomInt(0, 2 ** 31 - 1),
    };

    if (label?.['text']) {
      const textId = `${s['id']}_label`;
      const { label: _label, boundElements: existingBound = [], ...rest } = s;
      const fontSize = (label['fontSize'] as number) ?? 16;
      const textStr = label['text'] as string;
      const h = (s['height'] as number) ?? 40;

      output.push({
        ...baseDefaults,
        ...meta,
        ...rest,
        boundElements: [...(existingBound as unknown[]), { id: textId, type: 'text' }],
      });

      output.push({
        ...baseDefaults,
        ...meta,
        id: textId,
        type: 'text',
        x: s['x'] as number ?? 0,
        y: (s['y'] as number ?? 0) + (h - fontSize * 1.35) / 2,
        width: s['width'] as number ?? 120,
        height: fontSize * 1.35,
        text: textStr,
        originalText: textStr,
        autoResize: true,
        fontSize,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: s['id'],
        groupIds: (label['groupIds'] as unknown[]) ?? [],
        seed: randomInt(0, 2 ** 31 - 1),
        versionNonce: randomInt(0, 2 ** 31 - 1),
      });
    } else {
      output.push({
        ...baseDefaults,
        ...meta,
        boundElements: s['boundElements'] ?? null,
        ...s,
      });
    }
  }

  return output;
}

// For SVG images, the mermaid renderer sometimes emits a root width/height that
// doesn't match the viewBox (e.g. journey diagrams compress 3700 viewBox units
// into a 1264px root). This causes Excalidraw to render content at a fraction
// of its designed size. Fix: align root width/height to the viewBox so there is
// no internal scaling, then size the element proportionally (capped to 1600px).
function normalizeImageFiles(elements: unknown[], files: Record<string, unknown>): void {
  const MAX_PX = 1600;
  for (const el of elements as Record<string, unknown>[]) {
    if (el['type'] !== 'image') continue;
    const fileId = el['fileId'] as string | undefined;
    if (!fileId) continue;
    const file = files[fileId] as Record<string, unknown> | undefined;
    if (!file || file['mimeType'] !== 'image/svg+xml') continue;

    const dataURL = file['dataURL'] as string;
    const comma = dataURL.indexOf(',');
    if (comma < 0) continue;
    const meta = dataURL.slice(0, comma);
    const payload = dataURL.slice(comma + 1);
    const svg = meta.includes(';base64')
      ? Buffer.from(payload, 'base64').toString('utf-8')
      : decodeURIComponent(payload);

    const vbMatch = svg.match(/\bviewBox="([^"]+)"/i);
    if (!vbMatch) continue;
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) continue;
    const [, , vbW, vbH] = parts;
    if (vbW <= 0 || vbH <= 0) continue;

    // Set SVG root to viewBox natural size so no internal scaling occurs.
    const fixedSvg = svg
      .replace(/\bwidth="[^"]*"/i, `width="${vbW}"`)
      .replace(/\bheight="[^"]*"/i, `height="${vbH}"`);
    file['dataURL'] = `data:image/svg+xml;base64,${Buffer.from(fixedSvg, 'utf-8').toString('base64')}`;

    // Size element proportionally, capped to MAX_PX on the longest side.
    const scale = Math.min(1, MAX_PX / Math.max(vbW, vbH));
    el['width'] = Math.round(vbW * scale);
    el['height'] = Math.round(vbH * scale);
  }
}

export async function convertMermaid(
  mermaidCode: string,
): Promise<{ elements: unknown[]; files: Record<string, unknown> }> {
  const [bundle, browser] = await Promise.all([getBrowserBundle(), ensureBrowser()]);
  const page = await browser.newPage();

  try {
    await page.setContent('<!DOCTYPE html><html><body></body></html>');
    await page.addScriptTag({ content: bundle });

    const raw = await page.evaluate(async (code: string) => {
      const fn = (globalThis as unknown as Record<string, unknown>)['__parseMermaidToExcalidraw'] as
        (code: string) => Promise<{ elements: unknown[]; files: unknown }>;
      const result = await fn(code);
      return JSON.parse(JSON.stringify(result));
    }, mermaidCode);

    const elements = skeletonToElements((raw as { elements: unknown[] }).elements);
    const files = ((raw as { files: Record<string, unknown> }).files) ?? {};
    normalizeImageFiles(elements, files);
    return { elements, files };
  } finally {
    await page.close();
  }
}
