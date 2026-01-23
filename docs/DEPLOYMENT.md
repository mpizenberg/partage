# Deployment Guide

This guide covers deploying the Partage application to production.

## Architecture Overview

Partage consists of two separate services that must be deployed:

1. **PocketBase Server** - Zero-knowledge relay for encrypted CRDT operations (port 8090)
2. **Client Application** - Static SPA built with Vite (served via web server)

## Prerequisites

- PocketBase server must be deployed first and accessible via HTTPS
- Domain names configured with SSL certificates
- Deployment platform (e.g., Dokploy, Railway, Vercel, etc.)

## Deploying PocketBase

### Option 1: Dokploy (Recommended)

The project includes a custom PocketBase Docker image with hooks for anti-spam PoW protection.

**Docker Compose:**

```yaml
version: '3.8'

services:
  pocketbase:
    # Upgrade of adrianmusante/pocketbase:latest with my hooks on top
    image: ghcr.io/mpizenberg/partage/pocketbase:latest
    restart: always
    expose:
      - 8090
    volumes:
      - pocketbase-data:/pocketbase-data
    environment:
      - POCKETBASE_ADMIN_EMAIL=${ADMIN_EMAIL}
      - POCKETBASE_ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - POCKETBASE_ADMIN_UPSERT=true
      - POCKETBASE_PORT_NUMBER=8090
      - POW_SECRET=${POW_SECRET}
      - POCKETBASE_WORKDIR=/pocketbase-data
      - POCKETBASE_HOOK_DIR=/pocketbase/pb_hooks
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:8090/_/']
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  pocketbase-data: {}
```

**Environment Variables:**

| Variable         | Required | Description                                                              |
| ---------------- | -------- | ------------------------------------------------------------------------ |
| `ADMIN_EMAIL`    | Yes      | Admin email for PocketBase                                               |
| `ADMIN_PASSWORD` | Yes      | Admin password for PocketBase                                            |
| `POW_SECRET`     | Yes      | Secret for signing PoW challenges (generate with `openssl rand -hex 32`) |

**Important:** The volume mounts at `/pocketbase-data` (not `/pocketbase`) to preserve the hooks directory from the Docker image. The `POCKETBASE_WORKDIR` environment variable redirects PocketBase to use the mounted volume.

**Verify hooks are working:**

```bash
curl https://your-pocketbase-url/api/pow/challenge
# Should return: {"challenge":"...","timestamp":...,"difficulty":18,"signature":"..."}
```

### Building the PocketBase Image

The custom PocketBase image is built automatically via GitHub Actions when files in `packages/server/bin/pb_hooks/` or `packages/server/Dockerfile` change.

To manually trigger a build:

1. Go to GitHub Actions → "Build PocketBase Image"
2. Click "Run workflow"

The image is published to `ghcr.io/mpizenberg/partage/pocketbase:latest`.

### Option 2: Manual Deployment

```bash
# On your server
cd packages/server
./bin/pocketbase serve --http=0.0.0.0:8090
```

Ensure the `pb_hooks` directory is in the same directory as the PocketBase executable, and set the `POW_SECRET` environment variable.

Set up reverse proxy (nginx/Caddy) to handle SSL and proxy to port 8090.

## Deploying the Client Application

The client is a static single-page application (SPA) that must be built and served.

### Build Process

```bash
# Install dependencies
pnpm install

# Build (includes PocketBase setup + client build)
pnpm build
```

This creates optimized static files in `packages/client/dist/`:

- `index.html` - Entry point
- `assets/` - JavaScript, CSS, and assets
- `manifest.webmanifest` - PWA manifest
- `sw.js` - Service worker for offline support

### Option 1: Dokploy with Railpack

**Environment Variables (must be set before build):**

```bash
# REQUIRED: PocketBase URL (baked into build at compile time)
VITE_POCKETBASE_URL=https://partage-pocketbase.yourhost.com

# REQUIRED: Tell Railpack where the built files are
RAILPACK_SPA_OUTPUT_DIR=packages/client/dist
```

**Deployment Steps:**

1. Create a new application in Dokploy
2. Connect your Git repository
3. Ensure Railpack version is up to date (0.15.4+)
4. Configure environment variables (see above)
5. Deploy

Railpack will automatically:

- Detect Node.js with pnpm
- Install dependencies with `pnpm install`
- Run build with `pnpm build`
- Detect the SPA output directory via `RAILPACK_SPA_OUTPUT_DIR`
- Set up Caddy web server to serve static files
- Configure for SPA routing (all routes → index.html)

**Important Notes:**

- The `VITE_POCKETBASE_URL` environment variable is baked into the JavaScript bundle at build time
- If you change the PocketBase URL, you must rebuild and redeploy the client
- Ensure your `package.json` specifies `"pnpm": ">=9.0.0"` to match the lockfile version

### Option 2: Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd packages/client
vercel --prod
```

**Environment Variables:**

- `VITE_POCKETBASE_URL` - Your PocketBase URL

**Configuration (`vercel.json`):**

```json
{
  "buildCommand": "cd ../.. && pnpm build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Option 3: Netlify

**Configuration (`netlify.toml`):**

```toml
[build]
  command = "pnpm build"
  publish = "packages/client/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build.environment]
  VITE_POCKETBASE_URL = "https://partage-pocketbase.yourhost.com"
```

### Option 4: Static File Hosting (nginx/Caddy)

After building locally:

```bash
# Build the app
pnpm build

# Copy to web server
scp -r packages/client/dist/* user@server:/var/www/partage/
```

**nginx Configuration:**

```nginx
server {
    listen 80;
    server_name partage.yourhost.com;
    root /var/www/partage;
    index index.html;

    # SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Caddyfile Configuration:**

```
partage.yourhost.com {
    root * /var/www/partage
    encode gzip
    file_server
    try_files {path} /index.html
}
```

## Environment Variables Reference

### Build-time (Client)

These must be set **before** building the client:

| Variable              | Required | Description           | Example                                   |
| --------------------- | -------- | --------------------- | ----------------------------------------- |
| `VITE_POCKETBASE_URL` | Yes      | PocketBase server URL | `https://partage-pocketbase.yourhost.com` |

### Runtime (PocketBase)

| Variable              | Required | Description                       |
| --------------------- | -------- | --------------------------------- |
| `PB_ADMIN_EMAIL`      | Yes      | Admin email for PocketBase        |
| `PB_ADMIN_PASSWORD`   | Yes      | Admin password for PocketBase     |
| `POW_SECRET`          | Yes      | Secret for signing PoW challenges |
| `POCKETBASE_WORKDIR`  | Yes\*    | Work directory path               |
| `POCKETBASE_HOOK_DIR` | Yes\*    | Hooks directory path              |

\*Required when using the custom Docker image with Dokploy to separate data from hooks.

### Deployment (Dokploy/Railpack)

| Variable                  | Required | Description                |
| ------------------------- | -------- | -------------------------- | ---------------------- |
| `RAILPACK_SPA_OUTPUT_DIR` | Yes      | Path to built static files | `packages/client/dist` |

## Post-Deployment Verification

### 1. Check PocketBase

```bash
# Health check
curl https://partage-pocketbase.yourhost.com/api/health

# List collections (should show groups, loro_updates)
curl https://partage-pocketbase.yourhost.com/api/collections/groups/records
```

### 2. Check Client Application

1. Open `https://partage.yourhost.com` in browser
2. Open browser DevTools → Console
3. Check for `POCKETBASE_URL` log (should show your PocketBase URL)
4. Verify no connection errors
5. Try creating a test group

### 3. Test Sync

1. Open the app in two different browser tabs
2. Create a group in tab 1
3. Join the group from tab 2
4. Add an expense in tab 1
5. Verify it appears in tab 2 within 1-2 seconds

## Troubleshooting

### Bad Gateway (502)

**Symptom:** Client shows "Bad Gateway" error

**Causes:**

- Web server not configured correctly
- `RAILPACK_SPA_OUTPUT_DIR` not set or wrong path
- Build failed but deployment continued

**Solution:**

1. Check deployment logs for build errors
2. Verify `RAILPACK_SPA_OUTPUT_DIR=packages/client/dist` is set
3. Verify static files exist in `packages/client/dist/`

### "Cannot connect to server"

**Symptom:** Client loads but shows connection errors

**Causes:**

- `VITE_POCKETBASE_URL` not set or incorrect
- PocketBase server not running
- CORS issues

**Solution:**

1. Check browser console for `POCKETBASE_URL` value
2. Verify PocketBase is accessible: `curl https://your-pocketbase-url/api/health`
3. Rebuild client with correct `VITE_POCKETBASE_URL`

### SSL Certificate Errors

**Symptom:** Browser shows "Connection is not secure"

**Causes:**

- Domain misconfigured (trailing slash, typo)
- Let's Encrypt ACME challenge failed
- Traefik serving default self-signed cert

**Solution:**

1. Verify domain configuration (no trailing slash!)
2. Check Traefik logs for ACME errors
3. Ensure port 80 is accessible for HTTP-01 challenge

### Build Fails with "pnpm-lock.yaml is absent"

**Symptom:** Build fails with lockfile compatibility error

**Causes:**

- pnpm version mismatch between lockfile and builder
- Lockfile generated with pnpm 9.x but builder uses 8.x

**Solution:**

1. Update `package.json` engines: `"pnpm": ">=9.0.0"`
2. Commit and redeploy

## Production Checklist

- [ ] PocketBase deployed with SSL/TLS
- [ ] Admin credentials set securely (not in git!)
- [ ] PocketBase collections created (groups, loro_updates)
- [ ] Client built with correct `VITE_POCKETBASE_URL`
- [ ] Client deployed and accessible via HTTPS
- [ ] SPA routing configured (all routes → index.html)
- [ ] Service worker enabled for offline support
- [ ] Multi-device sync tested
- [ ] Backup strategy for PocketBase database
- [ ] Monitoring configured (optional)

## Security Notes

1. **Never commit credentials** - Use environment variables
2. **Always use HTTPS** - WebCrypto API requires secure context
3. **PocketBase is zero-knowledge** - Server cannot decrypt data
4. **Backup encryption keys** - Users should export/backup their keypairs
5. **Rate limiting** - Configure per-IP rate limiting in PocketBase admin settings

## Scaling Considerations

For production with many users:

1. **PocketBase**:
   - Use a persistent volume for the SQLite database
   - Consider PocketBase clustering for high availability
   - Set up regular database backups

2. **Client (Static Files)**:
   - Use a CDN (Cloudflare, AWS CloudFront)
   - Enable aggressive caching for assets
   - Consider multiple geographic regions

3. **Monitoring**:
   - Monitor PocketBase health and response times
   - Track client-side errors with Sentry or similar
   - Monitor WebSocket connection stability
