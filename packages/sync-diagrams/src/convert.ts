import { JSDOM } from 'jsdom';
import { randomInt } from 'node:crypto';

// Set up DOM globals before loading browser-bundled mermaid/excalidraw packages.
// parseMermaidToExcalidraw uses D3 + mermaid which require document/window globals.
function setupBrowserGlobals(): void {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost',
  });

  const g = globalThis as Record<string, unknown>;
  const define = (key: string, value: unknown) => {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  };
  g['document'] = dom.window.document;
  g['window'] = dom.window;
  g['self'] = dom.window;
  define('navigator', dom.window.navigator);
  define('location', dom.window.location);

  // Mock SVGElement.getBBox — jsdom has no layout engine, so we derive
  // dimensions from explicit SVG attributes (width/height/viewBox) set by mermaid.
  const SVGElement = (dom.window as unknown as { SVGElement: { prototype: Record<string, unknown> } }).SVGElement;
  if (SVGElement) {
    SVGElement.prototype['getBBox'] = function (this: Element) {
      const x = Number(this.getAttribute('x') ?? 0);
      const y = Number(this.getAttribute('y') ?? 0);
      const width = Number(this.getAttribute('width') ?? 0);
      const height = Number(this.getAttribute('height') ?? 0);
      return { x, y, width, height };
    };
  }
}

setupBrowserGlobals();

// Dynamic import so globals are set up before the module evaluates.
const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw');

export const DEFAULT_APP_STATE = {
  viewBackgroundColor: '#ffffff',
  currentItemFontFamily: 1,
  zoom: { value: 1 },
  scrollX: 0,
  scrollY: 0,
  theme: 'light',
} as const;

// Adds the required ExcalidrawElement fields to skeleton elements returned by
// parseMermaidToExcalidraw. This replaces convertToExcalidrawElements from
// @excalidraw/excalidraw, which is a browser-only webpack bundle.
function skeletonToElements(skeletons: unknown[]): unknown[] {
  const now = Date.now();
  return skeletons.map((skeleton) => {
    const s = skeleton as Record<string, unknown>;
    return {
      angle: 0,
      frameId: null,
      boundElements: s['boundElements'] ?? null,
      updated: now,
      link: s['link'] ?? null,
      locked: false,
      seed: randomInt(0, 2 ** 31 - 1),
      version: 1,
      versionNonce: randomInt(0, 2 ** 31 - 1),
      isDeleted: false,
      ...s,
    };
  });
}

export async function convertMermaid(
  mermaidCode: string,
): Promise<{ elements: unknown[]; files: Record<string, unknown> }> {
  const { elements: skeletons, files } = await parseMermaidToExcalidraw(mermaidCode);
  const elements = skeletonToElements(skeletons as unknown[]);
  return { elements, files: (files as Record<string, unknown>) ?? {} };
}
