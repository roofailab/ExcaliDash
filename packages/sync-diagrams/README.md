# @your-org/excalidash-sync

Syncs `*.mermaid.md` files from a repo to [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash). Converts Mermaid diagrams to Excalidraw elements via `@excalidraw/mermaid-to-excalidraw` and pushes them via the ExcaliDash REST API.

Designed to run in CI (GitHub Actions) on push. The sync manifest (`.excalidraw-sync.json`) tracks file → drawing ID mappings and is auto-committed back to the repo.

---

## Installation

```sh
npx @your-org/excalidash-sync
```

Or globally:

```sh
npm install -g @your-org/excalidash-sync
excalidash-sync
```

Requires **Node.js 20+**.

---

## Usage

```sh
EXCALIDASH_URL=https://excalidash.internal.company.com \
EXCALIDASH_API_KEY=your-plaintext-key \
npx @your-org/excalidash-sync --dir docs/diagrams --config .excalidraw-sync.json
```

### CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dir` | `docs/diagrams` | Directory to scan for `*.mermaid.md` files |
| `--config` | `.excalidraw-sync.json` | Path to the sync manifest |

### Required env vars

| Variable | Description |
|----------|-------------|
| `EXCALIDASH_URL` | Base URL of your ExcaliDash instance |
| `EXCALIDASH_API_KEY` | Plaintext API key (validated against bcrypt hashes stored in ExcaliDash's `API_KEYS` env var) |

---

## File format

Each diagram is a Markdown file with a `#` heading and a single `mermaid` code block:

```markdown
# Auth Flow

Brief description.

​```mermaid
flowchart TD
    A[User] --> B[Auth Service]
    B --> C{Valid?}
    C -->|Yes| D[Dashboard]
    C -->|No| E[Login Page]
​```
```

- **Naming:** kebab-case, e.g. `auth-flow.mermaid.md`
- The first `#` heading becomes the drawing name on ExcaliDash
- One mermaid block per file

---

## Sync manifest — `.excalidraw-sync.json`

Auto-managed. Commit this file to your repo.

```json
{
  "excalidashUrl": "https://excalidash.internal.company.com",
  "serviceAccount": "ci-diagrams@company.com",
  "collectionId": "project-xyz-diagrams",
  "drawings": {
    "docs/diagrams/auth-flow.mermaid.md": {
      "drawingId": "abc-123-uuid",
      "drawingName": "Auth Flow",
      "lastSyncedAt": "2026-02-24T10:30:00Z",
      "lastSyncedHash": "sha256:a1b2c3...",
      "skippedAt": null
    },
    "docs/diagrams/data-pipeline.mermaid.md": {
      "drawingId": "def-456-uuid",
      "drawingName": "Data Pipeline",
      "lastSyncedAt": "2026-02-24T10:30:00Z",
      "lastSyncedHash": "sha256:d4e5f6...",
      "skippedAt": "2026-02-24T11:00:00Z"
    }
  }
}
```

Fields:

| Field | Description |
|-------|-------------|
| `excalidashUrl` | For reference only — runtime URL comes from env var |
| `serviceAccount` | CI service account email (informational) |
| `collectionId` | Optional ExcaliDash collection to put new drawings in |
| `drawings[path].drawingId` | ExcaliDash drawing ID after first sync |
| `drawings[path].lastSyncedHash` | SHA-256 of file at last sync; unchanged files are skipped |
| `drawings[path].lastSyncedAt` | ISO timestamp of last successful sync |
| `drawings[path].skippedAt` | Set when ExcaliDash drawing was edited by a human after the last sync |

---

## Sync behavior

1. Scans `--dir` for `*.mermaid.md` files
2. Per file: computes SHA-256 hash; skips if unchanged vs manifest
3. If drawing has an existing ID: fetches `updatedAt` from ExcaliDash
   - If `updatedAt > lastSyncedAt`: skips with log `"human edits detected"`, sets `skippedAt`
4. Converts via `@excalidraw/mermaid-to-excalidraw`
5. POST (new) or PUT (existing) to ExcaliDash
6. On success: updates manifest. On failure: logs error, leaves manifest unchanged, continues
7. Writes manifest back to `--config` path
8. Exits 0 if all eligible files succeeded, 1 if any failed

---

## CI setup (GitHub Actions)

Copy `workflow-template/sync-diagrams.yml` into `.github/workflows/` in your consuming repo:

```yaml
name: Sync Diagrams to ExcaliDash
on:
  push:
    paths:
      - 'docs/diagrams/**/*.mermaid.md'

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx @your-org/excalidash-sync --dir docs/diagrams
        env:
          EXCALIDASH_URL: ${{ secrets.EXCALIDASH_URL }}
          EXCALIDASH_API_KEY: ${{ secrets.EXCALIDASH_API_KEY }}
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: sync diagram mappings"
          file_pattern: .excalidraw-sync.json
```

Add `EXCALIDASH_URL` and `EXCALIDASH_API_KEY` to your repo's GitHub Actions secrets.

### ExcaliDash setup

1. Generate an API key and bcrypt-hash it:
   ```sh
   node -e "const b=require('bcrypt'); b.hash('your-key', 10).then(console.log)"
   ```
2. Add the hash to ExcaliDash's `API_KEYS` env var (comma-separated for multiple keys)
3. Add `CI_SERVICE_ACCOUNT_EMAIL` to ExcaliDash's env (default: `ci@excalidash.local`)
4. Create a user in ExcaliDash with that email address

---

## Known limitations

### Mermaid diagram type support

| Type | Support |
|------|---------|
| **Flowchart** | Full — native Excalidraw shapes |
| **Sequence** | Partial — may have edge cases |
| **Class** | Partial |
| **ER / Gantt / GitGraph / State** | Rendered as embedded image (not editable) |

**Recommendation:** Use `flowchart TD` for architecture diagrams. Other types still display but can't be edited as individual shapes in ExcaliDash.

### Unsupported flowchart shapes

Subroutine, Cylindrical, Hexagon, Parallelogram, Trapezoid → fall back to Rectangle.

### One-way sync

Mermaid → Excalidraw only. If an engineer edits a drawing on ExcaliDash (moves elements, adds annotations), the next CI run will skip that drawing (`skippedAt` is set). To force a re-sync, update the `.mermaid.md` file — but if ExcaliDash is still newer, it still wins.

To permanently hand a diagram off to human ownership, remove it from `.excalidraw-sync.json`.
