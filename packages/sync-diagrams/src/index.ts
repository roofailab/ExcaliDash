import { parseArgs } from 'node:util';

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

console.log('excalidash-sync: ok');
process.exit(0);
