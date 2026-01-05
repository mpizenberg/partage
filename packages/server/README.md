# Partage Server (PocketBase)

## Setup

1. Download PocketBase binary from https://pocketbase.io/docs/
2. Place the binary in the bin/ directory
3. Run `bin/pocketbase serve`

## Configuration

The server acts as a zero-knowledge relay for encrypted CRDT operations.

### Collections Schema

Will be configured via PocketBase admin UI or migrations:

- **operations**: Encrypted CRDT operations
  - `id` (auto)
  - `groupId` (string, indexed)
  - `timestamp` (number, indexed)
  - `actor` (string) - Public key hash
  - `encryptedPayload` (text)
  - `signature` (text)

## Security

- Server has NO access to plaintext data
- All encryption/decryption happens client-side
- Server only stores and relays encrypted blobs
- Real-time subscriptions for instant sync
