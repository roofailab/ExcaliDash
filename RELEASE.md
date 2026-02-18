# ExcaliDash v0.4.27-dev

Release date: 2026-02-18

## Upgrading

<details>
<summary>Show upgrade steps</summary>

### Data safety checklist

- Back up backend volume (`dev.db`, secrets) before upgrading.
- Let migrations run on startup (`RUN_MIGRATIONS=true`) for normal deploys.
- Run `docker compose -f docker-compose.prod.yml logs backend --tail=200` after rollout and verify startup/migration status.

### Recommended upgrade (Docker Hub compose)

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Pin images to this release (recommended for reproducible deploys)

Edit `docker-compose.prod.yml` and pin the release tags:

```yaml
services:
  backend:
    image: zimengxiong/excalidash-backend:v0.4.27-dev
  frontend:
    image: zimengxiong/excalidash-frontend:v0.4.27-dev
```

Example:

```bash
docker compose -f docker-compose.prod.yml up -d
```

</details>

## RC for v0.4.27 release

### Authentication and user management

- Added a full authentication platform with local registration/login and password reset.
- Added bootstrap setup and onboarding controls for first admin creation.
- Added admin and user-management flows, including profile and impersonation-aware UI behavior.
- Added OIDC-enabled auth options and hardened token/session controls for hybrid deployments.

### Sharing, collaboration, and permissions

- Added sharing options between users and permission-aware sharing behavior.
- Enforced immediate permission revocation during collaboration sessions.
- Improved real-time ordering synchronization across collaborators.
- Reduced shared-view leakage of sensitive owner metadata.

### Security and reliability

- Tightened CSRF handling for auth, session, and socket workflows.
- Added additional security testing around sandboxing, login attempts, and request validation.
- Added audit event scaffolding and improved startup/migration safety.

### Import/export and data workflows

- Added import/export support for backup and restore use-cases.
- Improved exported drawing metadata handling and streaming behavior.
- Improved upload/import compatibility and preview/update behavior during edits.

### Collaboration and UI experience

- Added profile/admin pages, dashboard and settings improvements.
- Reduced fragile browser-context behavior in update checks, editor state handling, and collaboration flows.
