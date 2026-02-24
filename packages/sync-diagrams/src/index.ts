import { parseArgs } from 'node:util';
import { ExcaliDashClient } from './api.js';
import { readManifest, writeManifest, getDrawingEntry, updateDrawingEntry } from './manifest.js';
import { discoverMermaidFiles, extractMermaidContent, computeContentHash } from './mermaid.js';
import { convertMermaid, DEFAULT_APP_STATE } from './convert.js';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'docs/diagrams' },
    config: { type: 'string', default: '.excalidraw-sync.json' },
  },
  strict: true,
});

const excalidashUrl = process.env.EXCALIDASH_URL;
const apiKey = process.env.EXCALIDASH_API_KEY;

if (!excalidashUrl || !apiKey) {
  const missing = [
    !excalidashUrl && 'EXCALIDASH_URL',
    !apiKey && 'EXCALIDASH_API_KEY',
  ].filter(Boolean);
  console.error(`Error: Missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

export type SyncOptions = {
  dir: string;
  configPath: string;
  excalidashUrl: string;
  apiKey: string;
};

export const options: SyncOptions = {
  dir: values.dir as string,
  configPath: values.config as string,
  excalidashUrl,
  apiKey,
};

const client = new ExcaliDashClient(options.excalidashUrl, options.apiKey);
const manifest = readManifest(options.configPath);
const mermaidFiles = discoverMermaidFiles(options.dir);

let anyFailed = false;

for (const filePath of mermaidFiles) {
  const hash = computeContentHash(filePath);
  const entry = getDrawingEntry(manifest, filePath);

  if (entry && entry.lastSyncedHash === hash) {
    console.log(`Skipping ${filePath} — unchanged`);
    continue;
  }

  if (entry?.drawingId) {
    try {
      const drawing = await client.getDrawing(entry.drawingId);
      if (new Date(drawing.updatedAt) > new Date(entry.lastSyncedAt)) {
        console.log(`Skipping ${filePath} — ExcaliDash version is newer (human edits detected)`);
        updateDrawingEntry(manifest, filePath, { ...entry, skippedAt: new Date().toISOString() });
        continue;
      }
    } catch (err) {
      console.error(`Failed to check existing drawing for ${filePath}: ${err}`);
      anyFailed = true;
      continue;
    }
  }

  const { title, mermaidCode } = extractMermaidContent(filePath);
  if (!mermaidCode) {
    console.error(`No mermaid block found in ${filePath}`);
    anyFailed = true;
    continue;
  }

  let elements: unknown[];
  let conversionFiles: Record<string, unknown>;
  try {
    const result = await convertMermaid(mermaidCode);
    elements = result.elements;
    conversionFiles = result.files;
  } catch (err) {
    console.error(`Conversion failed for ${filePath}: ${err}`);
    anyFailed = true;
    continue;
  }

  const now = new Date().toISOString();
  const drawingName = title || entry?.drawingName || 'Untitled Diagram';

  if (entry?.drawingId) {
    try {
      await client.updateDrawing(entry.drawingId, {
        name: drawingName,
        elements,
        appState: { ...DEFAULT_APP_STATE },
        files: conversionFiles,
      });
      updateDrawingEntry(manifest, filePath, {
        ...entry,
        drawingName,
        lastSyncedAt: now,
        lastSyncedHash: hash,
        skippedAt: null,
      });
      console.log(`Updated ${filePath} → ${entry.drawingId}`);
    } catch (err) {
      console.error(`Failed to update ${filePath}: ${err}`);
      anyFailed = true;
    }
  } else {
    try {
      const created = await client.createDrawing({
        name: drawingName,
        elements,
        appState: { ...DEFAULT_APP_STATE },
        files: conversionFiles,
        ...(manifest.collectionId ? { collectionId: manifest.collectionId } : {}),
      });
      updateDrawingEntry(manifest, filePath, {
        drawingId: created.id,
        drawingName,
        lastSyncedAt: now,
        lastSyncedHash: hash,
        skippedAt: null,
      });
      console.log(`Created ${filePath} → ${created.id}`);
    } catch (err) {
      console.error(`Failed to create ${filePath}: ${err}`);
      anyFailed = true;
    }
  }
}

writeManifest(options.configPath, manifest);
process.exit(anyFailed ? 1 : 0);
