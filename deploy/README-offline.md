# Offline release runbook

## Build and seal an offline package

On a connected build host with Docker build access, run from the repository root:

```bash
scripts/package-offline-release.sh 0.3.0 /absolute/path/dtv-release-0.3.0
```

Build for the target CPU architecture (or configure Docker Buildx for it). The package contains the Compose file, configuration, all SQL migrations, auth directory, account initialization and backup/restore/migration scripts, image archive, and checksums. Transfer the entire directory through the approved offline channel. Include separately licensed local map/model assets if the deployment uses them; this package cannot invent or bundle third-party datasets.

Verify the transfer before loading any image:

```bash
cd /path/to/dtv-release-0.3.0
shasum -a 256 -c SHA256SUMS
shasum -a 256 -c images.sha256
```

## First installation with no network

```bash
cd deploy
cp .env.example .env
# Set a locally generated POSTGRES_PASSWORD. Keep DEMO_ENABLED=false and COOKIE_SECURE=true behind HTTPS.
cp tianqing/sources.example.json tianqing/sources.json
# Keep the endpoint and credentials on this server only; edit one scene entry per region.
chmod 600 tianqing/sources.json
# The API/Worker containers run as node (UID/GID 1000). On Linux, grant only that group read access:
sudo chgrp 1000 tianqing/sources.json && chmod 640 tianqing/sources.json
cd ..
docker load -i images.tar
DTV_VERSION=0.3.0 docker compose -f deploy/compose.yaml config --quiet
# Ensure deploy/auth is writable by container UID 1000, then create the first admin account.
sudo chown 1000:1000 deploy/auth && sudo chmod 700 deploy/auth
read -s DTV_ACCOUNT_PASSWORD
printf '%s' "$DTV_ACCOUNT_PASSWORD" | DTV_VERSION=0.3.0 AUTH_USERS_FILE=/run/dtv-auth/users.json docker compose -f deploy/compose.yaml run --rm --no-deps -T core-api node scripts/create-account.mjs --id admin --tenant customer-a --role admin --scenes xian,taiyuan,chengdu --output /run/dtv-auth/users.json
unset DTV_ACCOUNT_PASSWORD
DTV_VERSION=0.3.0 docker compose -f deploy/compose.yaml up -d --no-build --pull never
```

The host must already contain Docker Engine and Compose. The images must match the target CPU architecture. No package-manager installation or image pull is part of this runbook. The browser needs no public internet for bundled application assets; any configured basemap, terrain, or model endpoint must be reachable on the private network.

The default web bind address is `127.0.0.1:8080`, intended for a host reverse proxy. Set `WEB_BIND_ADDRESS=0.0.0.0` and a suitable `WEB_PORT` only when the host firewall and upstream TLS termination are configured. Set `COOKIE_SECURE=true` whenever users access the site over HTTPS. The sample environment disables demo login and enables secure cookies; for isolated local evaluation only, set `DEMO_ENABLED=true` and `COOKIE_SECURE=false`. The API deliberately refuses `DEPLOYMENT_MODE=production` until production data, license, capacity and security controls and target-host acceptance are complete, so this package runs in demo/mock deployment mode.

## Upgrade and rollback

1. Verify package hashes and architecture; retain the previous release directory and image tags.
2. Take a complete backup with `scripts/backup.sh /absolute/path/pre-upgrade`.
3. Load the new images. Stop the application, then run `scripts/apply-migrations.sh` from the release root. It applies migrations in filename order and leaves the application stopped.
4. Start using the new Compose file with `--no-build --pull never`, then check `/health`, `/api/health`, login, map, and a sample data query.
5. Roll back by stopping services, restoring the pre-upgrade backup with `CONFIRM_RESTORE=yes scripts/restore.sh ...`, and starting the retained previous image version. Database downgrade scripts are intentionally not used; restore is the rollback mechanism.

Never remove the PostgreSQL volume as an upgrade or rollback method. Test the exact package, Compose configuration, DB migration, backup and restore on a network-isolated staging host with the same OS, Docker version, architecture, mount permissions, and local datasets before field acceptance.
