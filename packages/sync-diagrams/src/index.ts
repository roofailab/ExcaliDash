#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ExcaliDashClient } from './api.js';
import { readManifest, writeManifest, getDrawingEntry, updateDrawingEntry } from './manifest.js';
import { discoverMermaidFiles, extractMermaidContent, computeContentHash } from './mermaid.js';
import { convertMermaid, DEFAULT_APP_STATE, closeConvertBrowser } from './convert.js';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'docs/diagrams' },
    config: { type: 'string', default: '.excalidraw-sync.json' },
    collection: { type: 'string' },
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

const client = new ExcaliDashClient(excalidashUrl, apiKey);
const manifest = readManifest(values.config as string);
const mermaidFiles = discoverMermaidFiles(values.dir as string);

// Resolve collection: prefer manifest cache, then create/find by --collection name.
const collectionName = values.collection as string | undefined;
if (collectionName && !manifest.collectionId) {
  try {
    const existing = await client.getCollections();
    const match = existing.find((c) => c.name === collectionName);
    if (match) {
      manifest.collectionId = match.id;
      console.log(`Using existing collection "${collectionName}" (${match.id})`);
    } else {
      const created = await client.createCollection(collectionName);
      manifest.collectionId = created.id;
      console.log(`Created collection "${collectionName}" (${created.id})`);
    }
  } catch (err) {
    console.error(`Failed to resolve collection "${collectionName}": ${err}`);
    process.exit(1);
  }
}

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
      const syncedDate = new Date(entry.lastSyncedAt);
      if (!isNaN(syncedDate.getTime()) && new Date(drawing.updatedAt) > syncedDate) {
        console.log(`Skipping ${filePath} — ExcaliDash version is newer (human edits detected)`);
        updateDrawingEntry(manifest, filePath, { ...entry, skippedAt: new Date().toISOString() });
        continue;
      }
    } catch (err) {
      const msg = String(err);
      if (msg.includes('404')) {
        console.warn(`Drawing ${entry.drawingId} no longer exists for ${filePath}, will re-create`);
        updateDrawingEntry(manifest, filePath, { ...entry, drawingId: '', lastSyncedAt: '', lastSyncedHash: '' });
      } else {
        console.error(`Failed to check existing drawing for ${filePath}: ${err}`);
        anyFailed = true;
        continue;
      }
    }
  }

  let title: string;
  let mermaidCode: string;
  try {
    ({ title, mermaidCode } = extractMermaidContent(filePath));
  } catch (err) {
    console.error(String(err));
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

  const currentEntry = getDrawingEntry(manifest, filePath);
  const drawingName = title || currentEntry?.drawingName || 'Untitled Diagram';

  if (currentEntry?.drawingId) {
    try {
      await client.updateDrawing(currentEntry.drawingId, {
        name: drawingName,
        elements,
        appState: { ...DEFAULT_APP_STATE },
        files: conversionFiles,
      });
      const syncedAt = new Date().toISOString();
      updateDrawingEntry(manifest, filePath, {
        ...currentEntry,
        drawingName,
        lastSyncedAt: syncedAt,
        lastSyncedHash: hash,
        skippedAt: null,
      });
      console.log(`Updated ${filePath} → ${currentEntry.drawingId}`);
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
      const syncedAt = new Date().toISOString();
      updateDrawingEntry(manifest, filePath, {
        drawingId: created.id,
        drawingName,
        lastSyncedAt: syncedAt,
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

try {
  writeManifest(values.config as string, manifest);
} catch (err) {
  console.error(`Failed to write manifest: ${err}`);
  anyFailed = true;
} finally {
  await closeConvertBrowser();
}
process.exit(anyFailed ? 1 : 0);
