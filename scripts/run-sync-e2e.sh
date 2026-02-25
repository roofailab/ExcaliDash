#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
SYNC_DIR="${SYNC_TEST_DIR:-/tmp/excalidash-sync-test}"
LOG_DIR="${SYNC_LOG_DIR:-$ROOT_DIR/logs/sync-diagrams-e2e}"
BACKEND_DATABASE_URL="${SYNC_BACKEND_DATABASE_URL:-file:$BACKEND_DIR/prisma/dev.db}"
SYNC_CONFIG_PATH="${SYNC_CONFIG_PATH:-$SYNC_DIR/.excalidraw-sync.json}"

EXCALIDASH_URL_DEFAULT="http://localhost:6767/api"
EXCALIDASH_URL="${EXCALIDASH_URL:-$EXCALIDASH_URL_DEFAULT}"
CI_EMAIL="${CI_SERVICE_ACCOUNT_EMAIL:-ci@excalidash.local}"
PLAIN_API_KEY="${EXCALIDASH_API_KEY_PLAIN:-test-api-key-123}"

mkdir -p "$SYNC_DIR" "$LOG_DIR"
rm -f "$LOG_DIR"/sync-*.log
rm -f "$SYNC_CONFIG_PATH"

log() {
  printf "[%s] %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*"
}

log "Using EXCALIDASH_URL=$EXCALIDASH_URL"
log "Using CI service account email=$CI_EMAIL"
log "Using sync dir=$SYNC_DIR"
log "Using backend DATABASE_URL for seeding: $BACKEND_DATABASE_URL"
log "Using manifest path: $SYNC_CONFIG_PATH"

assert_log_contains() {
  local pattern="$1"
  local file="$2"
  if ! rg -q --fixed-strings "$pattern" "$file"; then
    log "Assertion failed: expected '$pattern' in $file"
    exit 1
  fi
}

run_sync() {
  EXCALIDASH_URL="$EXCALIDASH_URL" EXCALIDASH_API_KEY="$PLAIN_API_KEY" \
    npx tsx "$ROOT_DIR/packages/sync-diagrams/src/index.ts" --dir "$SYNC_DIR" --config "$SYNC_CONFIG_PATH"
}

log "Creating/upserting CI service account user in local SQLite via Prisma"
pushd "$BACKEND_DIR" >/dev/null
DATABASE_URL="$BACKEND_DATABASE_URL" CI_EMAIL="$CI_EMAIL" PLAIN_API_KEY="$PLAIN_API_KEY" node <<'NODE'
const bcrypt = require('bcrypt');
const { PrismaClient } = require('./src/generated/client');

(async () => {
  const email = process.env.CI_EMAIL;
  const plainApiKey = process.env.PLAIN_API_KEY;
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash('ci-password', 10);
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        username: 'ci-service',
        name: 'CI Service',
        passwordHash,
        role: 'USER',
      },
    });
    const apiKeyHash = await bcrypt.hash(plainApiKey, 10);
    console.log('CI_USER_ID', user.id);
    console.log('API_KEY_HASH', apiKeyHash);
  } finally {
    await prisma.$disconnect();
  }
})();
NODE
popd >/dev/null

log "Writing sample Mermaid files"
cat <<'MD' > "$SYNC_DIR/auth-flow.mermaid.md"
# Auth Flow

```mermaid
flowchart TD
  A[User] --> B[Auth Service]
  B --> C{Valid?}
  C -->|Yes| D[Dashboard]
  C -->|No| E[Login Page]
```
MD

cat <<'MD' > "$SYNC_DIR/data-pipeline.mermaid.md"
# Data Pipeline

```mermaid
flowchart TD
  A[Producer] --> B[Queue]
  B --> C[Processor]
  C --> D[(DB)]
```
MD

log "Running initial sync"
run_sync 2>&1 | tee "$LOG_DIR/sync-1.log"
assert_log_contains "Created $SYNC_DIR/auth-flow.mermaid.md" "$LOG_DIR/sync-1.log"
assert_log_contains "Created $SYNC_DIR/data-pipeline.mermaid.md" "$LOG_DIR/sync-1.log"

log "Re-running sync (should skip unchanged)"
run_sync 2>&1 | tee "$LOG_DIR/sync-2.log"
assert_log_contains "Skipping $SYNC_DIR/auth-flow.mermaid.md — unchanged" "$LOG_DIR/sync-2.log"
assert_log_contains "Skipping $SYNC_DIR/data-pipeline.mermaid.md — unchanged" "$LOG_DIR/sync-2.log"

log "Simulating out-of-band human edit in backend DB"
DATABASE_URL="$BACKEND_DATABASE_URL" CONFIG_PATH="$SYNC_CONFIG_PATH" node <<'NODE'
const fs = require('fs');
const { PrismaClient } = require('./backend/src/generated/client');

(async () => {
  const configPath = process.env.CONFIG_PATH;
  const manifest = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const entry = manifest.drawings?.['/tmp/excalidash-sync-test/data-pipeline.mermaid.md']
    || manifest.drawings?.[Object.keys(manifest.drawings || {}).find((k) => k.endsWith('/data-pipeline.mermaid.md'))];

  if (!entry?.drawingId) {
    throw new Error('Could not resolve data-pipeline drawingId from manifest');
  }

  const prisma = new PrismaClient();
  try {
    await prisma.drawing.update({
      where: { id: entry.drawingId },
      data: { name: 'Data Pipeline (human edit)' },
    });
    console.log('HUMAN_EDIT_DRAWING_ID', entry.drawingId);
  } finally {
    await prisma.$disconnect();
  }
})();
NODE

log "Updating the edited Mermaid file to force a re-sync check"
cat <<'MD' > "$SYNC_DIR/data-pipeline.mermaid.md"
# Data Pipeline

```mermaid
flowchart TD
  A[Producer] --> B[Queue]
  B --> C[Processor]
  C --> D[(DB)]
  D --> E[Analytics]
```
MD

log "Re-running sync (should detect human edits and skip one)"
run_sync 2>&1 | tee "$LOG_DIR/sync-3.log"
assert_log_contains "Skipping $SYNC_DIR/auth-flow.mermaid.md — unchanged" "$LOG_DIR/sync-3.log"
assert_log_contains "Skipping $SYNC_DIR/data-pipeline.mermaid.md — ExcaliDash version is newer (human edits detected)" "$LOG_DIR/sync-3.log"

AUTH_HASH_BEFORE="$(CONFIG_PATH="$SYNC_CONFIG_PATH" node <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, 'utf8'));
const entry = manifest.drawings?.[Object.keys(manifest.drawings || {}).find((k) => k.endsWith('/auth-flow.mermaid.md'))];
if (!entry?.lastSyncedHash) throw new Error('Missing auth-flow manifest hash before failed sync');
process.stdout.write(entry.lastSyncedHash);
NODE
)"

log "Corrupting one Mermaid file to force a conversion error"
cat <<'MD' > "$SYNC_DIR/auth-flow.mermaid.md"
# Auth Flow

```mermaid
flowchart TD
  A[User] --> B[Auth Service
```
MD

set +e
run_sync 2>&1 | tee "$LOG_DIR/sync-4.log"
EXIT_CODE=${PIPESTATUS[0]}
set -e

assert_log_contains "Conversion failed for $SYNC_DIR/auth-flow.mermaid.md" "$LOG_DIR/sync-4.log"

log "Final sync exit code: $EXIT_CODE (expected non-zero)"
log "Logs: $LOG_DIR/sync-1.log, sync-2.log, sync-3.log, sync-4.log"
log "Manifest: $SYNC_CONFIG_PATH"

if [ "$EXIT_CODE" -eq 0 ]; then
  log "Assertion failed: expected non-zero exit for corrupted Mermaid file"
  exit 1
fi

AUTH_HASH_AFTER="$(CONFIG_PATH="$SYNC_CONFIG_PATH" node <<'NODE'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, 'utf8'));
const entry = manifest.drawings?.[Object.keys(manifest.drawings || {}).find((k) => k.endsWith('/auth-flow.mermaid.md'))];
if (!entry?.lastSyncedHash) throw new Error('Missing auth-flow manifest hash after failed sync');
process.stdout.write(entry.lastSyncedHash);
NODE
)"

if [ "$AUTH_HASH_BEFORE" != "$AUTH_HASH_AFTER" ]; then
  log "Assertion failed: auth-flow manifest hash changed after failed conversion"
  exit 1
fi

log "All sync E2E assertions passed"
