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

### 3. `loro_snapshots` (Future - Phase 5)
Optional: Periodic snapshots for faster initial sync of new clients.

**Fields:**
- `id` (text, 15 chars, primary key)
- `groupId` (text, required, indexed)
- `timestamp` (number, required, indexed)
- `snapshotData` (text, required) - Base64-encoded snapshot bytes
- `version` (json) - Loro version vector at snapshot time

**Notes:**
- Not needed for MVP (Phase 4)
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
