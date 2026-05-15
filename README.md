# Photo Storage App

A simple admin-only photo manager on Scaleway Object Storage with public share links (optionally password-protected).

## Requirements

- Node.js 20+ (matches Docker image)
- A Scaleway Object Storage bucket

## Configure

Create a `.env` file in the project root with your bucket and credentials (see `deploy.md` for production naming). Example:

```
PORT=3000
SESSION_SECRET=your-random-secret

S3_ENDPOINT=https://YOUR_BUCKET.s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_BUCKET=YOUR_BUCKET
S3_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=YOUR_SECRET

ADMIN_PASSWORD=choose-strong-password
```

Optional: `SHARES_S3_BUCKET` to store share metadata in Object Storage (one JSON object per share). Optional: `SHARES_S3_PREFIX` to override the default `__app_metadata__/shares/` prefix.

## Install and run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` and sign in with the admin password.

## Scripts

- `npm run dev` — development server with reload
- `npm run lint` — ESLint on `src/` and `test/`
- `npm test` — smoke tests (`node --test`)

## Features

- Upload, delete, move files; create/delete folders
- Share links for a folder (optional password; optional guest uploads)
- Public gallery (EJS) and a static viewer at **`/viewer/`** on the same host
- Presigned object URLs (default expiry one hour)

## Share storage

- **Local (default):** `data/shares/<id>.json` (a legacy `data/shares.json` is migrated once to this layout).
- **S3:** set `SHARES_S3_BUCKET`; shares live as separate objects under `SHARES_S3_PREFIX` (default `__app_metadata__/shares/`). A legacy single `shares.json` in that bucket is migrated automatically.

Application metadata keys are hidden from the admin object browser where possible.
