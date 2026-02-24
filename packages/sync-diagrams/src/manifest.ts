import { readFileSync, writeFileSync } from 'node:fs';

export type DrawingEntry = {
  drawingId: string;
  drawingName: string;
  lastSyncedAt: string;
  lastSyncedHash: string;
  skippedAt: string | null;
};

export type SyncManifest = {
  excalidashUrl: string;
  serviceAccount: string;
  collectionId: string | null;
  drawings: Record<string, DrawingEntry>;
};

const emptyManifest = (): SyncManifest => ({
  excalidashUrl: '',
  serviceAccount: '',
  collectionId: null,
  drawings: {},
});

export function readManifest(configPath: string): SyncManifest {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as SyncManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyManifest();
    }
    throw err;
  }
}

export function writeManifest(configPath: string, manifest: SyncManifest): void {
  writeFileSync(configPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

export function getDrawingEntry(manifest: SyncManifest, filePath: string): DrawingEntry | undefined {
  return manifest.drawings[filePath];
}

export function updateDrawingEntry(manifest: SyncManifest, filePath: string, entry: DrawingEntry): void {
  manifest.drawings[filePath] = entry;
}
