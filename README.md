# Photo Storage App

A simple admin-only photo manager on Scaleway Object Storage with public share links (optionally password-protected).

## Requirements
- Node.js 18+
- A Scaleway Object Storage bucket

## Configure
Create a `.env` file in the project root with:

```
PORT=3000
SESSION_SECRET=your-random-secret

S3_ENDPOINT=https://photo-storage-313.s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_BUCKET=photo-storage-313
S3_ACCESS_KEY_ID=SCWEZGZ37PKBHDAMCCTT
S3_SECRET_ACCESS_KEY=YOUR_SECRET_HERE

ADMIN_PASSWORD=choose-strong-password
```

## Install & Run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` and login with the admin password.

## Features
- Upload/delete/move files
- Create/delete folders
- Create share links for a folder (with optional password)
- Public gallery view with presigned URLs

## Notes
- Shares are stored in `data/shares.json`.
- Presigned URLs currently expire after 1 hour.


