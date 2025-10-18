# Photosharing Frontend

A clean, static frontend for viewing shared photo folders. Hosted on GitHub Pages.

## Setup

1. Update `config.js` with your backend URL:
   ```js
   window.API_BASE = 'https://your-backend-domain.com';
   ```

2. Deploy to GitHub Pages:
   - Push this folder to your GitHub repo
   - Enable Pages in repo Settings → Pages
   - Source: Deploy from a branch → main /frontend

## Features

- Light/dark theme toggle
- Image preview modal
- Download ZIP for shared folders
- Responsive grid layout
- No admin functionality (keeps secrets secure)

## Backend Requirements

Your backend needs:
- CORS enabled for your Pages domain
- `/api/share/:id` JSON endpoint
- `/s/:id/download.zip` ZIP download
