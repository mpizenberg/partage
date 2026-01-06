# PocketBase Collections Schema

## Overview
The server stores encrypted CRDT operations and provides real-time sync capabilities. All sensitive data is encrypted client-side; the server only relays encrypted bytes.

## Collections

### 1. `groups`
Basic group metadata for discovery and access control.

**Fields:**
- `id` (text, 15 chars, primary key) - Auto-generated
- `name` (text, required) - Group name (not sensitive, for display)
- `createdAt` (number, required) - Unix timestamp
- `createdBy` (text, required) - Public key hash (actor ID)
- `lastActivityAt` (number, indexed) - For sorting/cleanup
- `memberCount` (number) - Cached member count

**Indexes:**
- `createdBy` - Find groups by creator
- `lastActivityAt` - Sort by activity

**API Rules:**
- Anyone can create (POST)
- Members can read (GET) - Will implement member verification later
- No updates/deletes (immutable group metadata)

**Notes:**
- This is minimal metadata only
- Actual group data (members, settings) is in the encrypted Loro CRDT
- For MVP, we skip authentication; Phase 5 will add member verification

---

### 2. `loro_updates`
Stores incremental Loro CRDT updates for synchronization.

**Fields:**
- `id` (text, 15 chars, primary key) - Auto-generated
- `groupId` (text, required, indexed) - Foreign key to groups collection
- `timestamp` (number, required, indexed) - Unix timestamp
- `actorId` (text, required, indexed) - Public key hash of the actor
- `updateData` (text, required) - Base64-encoded Loro update bytes (Uint8Array)
- `version` (json, optional) - Loro version vector for this update (for debugging)

**Indexes:**
- `groupId` - Filter updates by group
- `timestamp` - Chronological ordering
- `actorId` - Track updates by actor

**API Rules:**
- Anyone can create (POST) - For MVP
- Anyone can read (GET) with groupId filter
- No updates/deletes (append-only log)

**Notes:**
- Each entry represents one Loro CRDT update (from `loro.export({ mode: 'update', from: version })`)
- Clients fetch all updates for a group and apply them sequentially with `loro.import(update)`
- Updates are immutable and append-only for CRDT consistency
- Real-time subscriptions allow instant sync across devices

---

### 3. `invitations` (Phase 5)
Group invitation records for multi-user joining flow.

**Fields:**
- `id` (text, 15 chars, primary key) - Auto-generated invitation ID
- `groupId` (text, required, indexed) - Foreign key to groups collection
- `inviterPublicKeyHash` (text, required) - Who created this invitation
- `createdAt` (number, required) - Unix timestamp
- `expiresAt` (number, optional) - Optional expiration timestamp
- `maxUses` (number, optional) - Maximum number of times this can be used
- `usedCount` (number, required) - How many times this has been used
- `status` (text, required) - 'active', 'expired', or 'revoked'

**Indexes:**
- `groupId` - Find invitations by group
- `inviterPublicKeyHash` - Find invitations by creator
- `status` - Filter active invitations

**API Rules:**
- Group members can create (POST)
- Anyone can read (GET) - needed to display invitation details before joining
- Creators can update status (for revocation)
- No deletes

**Notes:**
- Invitation links encode the invitation ID
- When clicked, displays group name and asks for user's name
- Expiration and usage limits provide security controls

---

### 4. `join_requests` (Phase 5)
Pending requests to join groups via invitations.

**Fields:**
- `id` (text, 15 chars, primary key) - Auto-generated
- `invitationId` (text, required, indexed) - Which invitation was used
- `groupId` (text, required, indexed) - Which group to join
- `requesterPublicKey` (text, required) - Base64 serialized public key
- `requesterPublicKeyHash` (text, required, indexed) - SHA-256 hash (member ID)
- `requesterName` (text, required) - Display name
- `requestedAt` (number, required) - Unix timestamp
- `status` (text, required) - 'pending', 'approved', or 'rejected'
- `approvedBy` (text, optional) - Public key hash of approver
- `approvedAt` (number, optional) - Unix timestamp
- `rejectedBy` (text, optional) - Public key hash of rejecter
- `rejectedAt` (number, optional) - Unix timestamp
- `rejectionReason` (text, optional) - Optional reason

**Indexes:**
- `groupId` - Find requests by group
- `invitationId` - Track invitation usage
- `requesterPublicKeyHash` - Find by requester
- `status` - Filter pending requests

**API Rules:**
- Anyone can create (POST) - creates pending join request
- Group members can read (GET) - see pending requests
- Group members can update (for approval/rejection)
- No deletes

**Notes:**
- Auto-approved for MVP (Phase 5 focus is key exchange, not moderation)
- Can add manual approval in Phase 6
- Includes public key for ECDH key exchange

---

### 5. `key_packages` (Phase 5)
Encrypted group keys sent to approved members.

**Fields:**
- `id` (text, 15 chars, primary key) - Auto-generated
- `joinRequestId` (text, required, indexed) - Which join request this is for
- `groupId` (text, required, indexed) - Which group
- `recipientPublicKeyHash` (text, required, indexed) - Who this is for
- `senderPublicKeyHash` (text, required) - Who encrypted and sent this
- `encryptedKeys` (json, required) - Encrypted group keys (iv, ciphertext, authTag)
- `createdAt` (number, required) - Unix timestamp
- `signature` (text, required) - Base64 ECDSA signature for verification

**Indexes:**
- `joinRequestId` - Find package by join request
- `groupId` - Find packages by group
- `recipientPublicKeyHash` - Find packages for a user

**API Rules:**
- Group members can create (POST) - send keys to new members
- Recipients can read (GET) - fetch their encrypted keys
- No updates/deletes

**Notes:**
- Contains all historical group keys (encrypted with recipient's public key)
- Uses ECDH to derive shared secret for encryption
- Signature ensures authenticity and integrity
- New members can decrypt old entries with historical keys

---

### 6. `loro_snapshots` (Future - Phase 6)
Optional: Periodic snapshots for faster initial sync of new clients.

**Fields:**
- `id` (text, 15 chars, primary key)
- `groupId` (text, required, indexed)
- `timestamp` (number, required, indexed)
- `snapshotData` (text, required) - Base64-encoded snapshot bytes
- `version` (json) - Loro version vector at snapshot time

**Notes:**
- Not needed for Phase 5
- Reduces initial sync time for groups with many updates
- Can be generated periodically server-side or client-side

---

## Sync Protocol

### Initial Sync (Client joins group)
1. Client fetches all `loro_updates` for the groupId
2. Client applies updates sequentially: `loro.import(updateData)`
3. Loro automatically handles CRDT merging and conflict resolution

### Incremental Sync (Real-time)
1. Client subscribes to `loro_updates` collection with filter: `groupId = 'xxx'`
2. On local change:
   - Client exports update: `loro.export({ mode: 'update', from: lastVersion })`
   - Client posts update to `loro_updates` collection
3. On remote change (subscription event):
   - Client receives new update
   - Client applies: `loro.import(updateData)`
   - UI updates reactively via Loro's state

### Offline Support
1. Client queues updates locally (IndexedDB)
2. On reconnect, client pushes queued updates to server
3. Server's real-time subscription replays missed updates to client
4. Loro's CRDT ensures convergence despite out-of-order delivery

---

## Security Model (Phase 4 MVP)

**Current (MVP):**
- No authentication
- Anyone can read/write any group
- Acceptable for Phase 4 development/testing

**Future (Phase 5):**
- Group membership verification via cryptographic signatures
- Public key exchange during invite flow
- Access control based on member list stored in CRDT
- Server validates signatures but doesn't see plaintext

---

## PocketBase Configuration

### Real-time Subscriptions
Enable real-time for `loro_updates`:
```javascript
// Client subscribes to updates
pb.collection('loro_updates').subscribe('*', (e) => {
  if (e.record.groupId === currentGroupId) {
    syncManager.applyRemoteUpdate(e.record.updateData);
  }
}, { filter: `groupId = '${groupId}'` });
```

### CORS Settings
- Allow all origins for MVP
- Restrict in production to web app domain

### Storage Considerations
- `updateData` can be large (Loro binary format)
- Consider PocketBase's max field size (default 2MB)
- May need file storage for large snapshots in future

---

## Migration Steps

1. Start PocketBase admin UI: `http://127.0.0.1:8090/_/`
2. Create `groups` collection with fields above
3. Create `loro_updates` collection with fields above
4. Set API rules (allow all for MVP)
5. Enable real-time for `loro_updates`
6. Test with Postman/curl before implementing client

---

## Next Steps After Schema Setup

1. Implement `/packages/client/src/api/pocketbase-client.ts`
   - Initialize PocketBase SDK
   - Methods: createGroup, pushUpdate, fetchUpdates, subscribe
2. Implement `/packages/client/src/core/sync/sync-manager.ts`
   - Orchestrate sync between Loro, storage, and API
   - Handle online/offline transitions
3. Integrate with AppContext for UI reactivity
