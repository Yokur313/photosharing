# Scaleway Deployment Guide

## Environment variables (Scaleway container)

Set these in your Scaleway Serverless Container (or Functions) environment:

```
NODE_ENV=production
PROD_PORT=3000
PROD_SESSION_SECRET=your-long-random-secret-here
PROD_ADMIN_PASSWORD=your-admin-password
PROD_S3_REGION=fr-par
PROD_S3_BUCKET=your-photo-bucket-name
PROD_S3_ENDPOINT=https://your-photo-bucket-name.s3.fr-par.scw.cloud
PROD_S3_ACCESS_KEY_ID=your-access-key-id
PROD_S3_SECRET_ACCESS_KEY=your-secret-access-key
```

### Optional: share metadata in Object Storage (recommended for multiple instances)

If you set `PROD_SHARES_S3_BUCKET` (or `SHARES_S3_BUCKET`), each share is stored as its **own small JSON object** (no single-file race). Objects use prefix `__app_metadata__/shares/` by default (override with `SHARES_S3_PREFIX` / `PROD_SHARES_S3_PREFIX`).

On first use, a legacy `shares.json` in that bucket (see `SHARES_S3_KEY`) is **migrated** into per-share objects and the legacy file is removed. This only affects **share metadata**, not your photo keys.

### Optional: CORS for cross-origin API clients

Same-origin use (including the built-in viewer at `/viewer/`) does not need CORS. For extra browser origins, set a comma-separated list:

```
CORS_ORIGINS=https://your-container-url.functions.fnc.fr-par.scw.cloud,http://localhost:3000
```

## Persistent volume (optional)

If you **do not** use `SHARES_S3_BUCKET`, share metadata is stored under `/app/data/shares/` (one JSON file per share). Mount a persistent volume on `/app/data` so shares survive redeploys.

If you **do** use `SHARES_S3_BUCKET`, the container can stay stateless and a volume is not required for shares.

## Deploy steps (overview)

1. Build and push the image (for example via the GitHub Action in this repo).
2. Point your Scaleway container at `ghcr.io/yokur313/photosharing:latest` (or a pinned digest).
3. Set the environment variables above.
4. Add a volume on `/app/data` only when you are not using `SHARES_S3_BUCKET`.

## After deployment

- **Admin + EJS gallery:** your container base URL (e.g. `https://…functions.fnc.fr-par.scw.cloud/`).
- **Static share viewer:** `https://…/viewer/` (same host; no GitHub Pages required).

## Security notes

- Use a strong random `PROD_SESSION_SECRET` (32+ characters).
- Use a strong `PROD_ADMIN_PASSWORD`.
- Prefer an S3 access key scoped to the buckets and prefixes you need.
- HTTPS is provided by Scaleway in front of the container.
