# Scaleway Deployment Guide

## Environment Variables for Scaleway Console

Set these in your Scaleway Serverless Container environment:

```
NODE_ENV=production
PROD_PORT=3000
PROD_SESSION_SECRET=your-long-random-secret-here
PROD_ADMIN_PASSWORD=your-admin-password
PROD_S3_REGION=fr-par
PROD_S3_BUCKET=photo-storage-313
PROD_S3_ENDPOINT=https://photo-storage-313.s3.fr-par.scw.cloud
PROD_S3_ACCESS_KEY_ID=SCWEZGZ37PKBHDAMCCTT
PROD_S3_SECRET_ACCESS_KEY=your-secret-access-key-here
```

## Volume Mount

**Important**: Add a persistent volume mount:
- **Path**: `/app/data`
- **Type**: Persistent Volume
- **Size**: 1GB (minimum)

This keeps your `shares.json` file persistent across deployments.

## Steps in Scaleway Console

1. Go to **Serverless Containers** → **Containers**
2. Click **Create Container**
3. Choose **Deploy from Git repository**
4. Connect your GitHub repo: `https://github.com/Yokur313/Photosharing`
5. Set the environment variables above
6. Add the volume mount for `/app/data`
7. Deploy!

## After Deployment

1. Get your container URL from Scaleway console
2. Update `frontend/config.js`:
   ```js
   window.API_BASE = 'https://your-container-url.scw.cloud';
   ```
3. Push the frontend to GitHub Pages

## Security Notes

- Use a strong, random `SESSION_SECRET` (32+ characters)
- Use a strong `ADMIN_PASSWORD`
- Consider creating a new S3 access key with minimal permissions
- The container will automatically get HTTPS from Scaleway
