# Partage Server (PocketBase)

## Setup

The PocketBase binary is already included in `bin/pocketbase`.

### Starting the Server

```bash
# From the monorepo root
pnpm --filter server serve

# Or directly
cd packages/server/bin
./pocketbase serve
```

The server will start on `http://127.0.0.1:8090`

### First-Time Setup

#### 1. Create Admin Account (First Time Only)

Start the server and create an admin account via the web UI:

```bash
pnpm --filter server serve
```

Then open http://127.0.0.1:8090/_/ and create your admin account.

#### 2. Configure Environment Variables

Create a `.env` file in `packages/server/` with your admin credentials:

```bash
# packages/server/.env
VITE_POCKETBASE_URL=http://127.0.0.1:8090
PB_ADMIN_EMAIL=your-admin@example.com
PB_ADMIN_PASSWORD=your-secure-password
```

See `.env.example` for a template.

⚠️ **Important**: The `.env` file is already in `.gitignore` - never commit credentials!

#### 3. Set Up Collections (Automated)

Run the setup script to automatically create the required collections:

```bash
# From the monorepo root
pnpm --filter server setup

# Or directly
cd packages/server
node setup-collections.js
```

The script is **idempotent** - safe to run multiple times. It will:
- Create `groups` collection with proper schema and indexes
- Create `loro_updates` collection with real-time enabled
- Skip collections that already exist

### Collections Schema

See [schema.md](./schema.md) for detailed documentation.

The setup script creates these collections:

1. **groups** - Group metadata (name, creator, activity timestamp)
2. **loro_updates** - Encrypted CRDT operations with real-time sync

**Manual Setup (Alternative)**:
If you prefer to create collections manually via the web UI, see the "Quick Setup" section in schema.md

### Testing the Setup

```bash
# List groups
curl http://127.0.0.1:8090/api/collections/groups/records

# List updates
curl http://127.0.0.1:8090/api/collections/loro_updates/records
```

## Architecture

The server acts as a zero-knowledge relay for encrypted CRDT operations:

- **Zero-knowledge**: Server has NO access to plaintext data
- **Local-first**: All encryption/decryption happens client-side
- **Append-only**: Server stores immutable Loro CRDT updates
- **Real-time**: Instant sync via PocketBase subscriptions
- **Offline-capable**: Clients queue updates and sync on reconnect

## Security

**Phase 4 (MVP):**
- No authentication (development only)
- Anyone can read/write any group
- Focus: Get sync working

**Phase 5 (Production):**
- Cryptographic member verification
- Signature-based access control
- Public key infrastructure

## Development

```bash
# Install PocketBase SDK for testing
pnpm add pocketbase

# Run schema setup helper
node packages/server/setup-schema.js
```

## File Structure

```
packages/server/
├── bin/
│   ├── pocketbase          # PocketBase binary
│   └── pb_data/            # Database and config
├── schema.md               # Detailed schema documentation
├── setup-schema.js         # Schema setup helper
└── README.md               # This file
```
