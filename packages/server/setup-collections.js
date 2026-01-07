/**
 * PocketBase Collections Setup Script
 *
 * Automatically creates the required collections for Partage.
 * This script is idempotent - safe to run multiple times.
 *
 * Requirements:
 * - PocketBase server must be running
 * - .env file must contain POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD
 *
 * Usage:
 *   node packages/server/setup-collections.js
 *
 * Notes (key rotation):
 * - Key rotation “fanout” publishes one encrypted key package per recipient.
 * - To make this efficient and robust, we store `keyVersion` and allow de-duplication
 *   (same joinRequestId/groupId/recipient/keyVersion) at the application level.
 *   PocketBase itself doesn’t provide a strict unique constraint for base collections.
 */

import PocketBase from 'pocketbase';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

const POCKETBASE_URL =
  process.env.VITE_POCKETBASE_URL || process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || process.env.POCKETBASE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.POCKETBASE_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Error: PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD must be set in .env file');
  console.error('   See .env.example for reference');
  process.exit(1);
}

const pb = new PocketBase(POCKETBASE_URL);

/**
 * Check if a collection exists
 */
async function collectionExists(name) {
  try {
    await pb.collections.getOne(name);
    return true;
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Create the 'groups' collection
 */
async function createGroupsCollection() {
  const collectionName = 'groups';

  if (await collectionExists(collectionName)) {
    console.log(`✅ Collection '${collectionName}' already exists, skipping...`);
    return;
  }

  console.log(`📦 Creating collection '${collectionName}'...`);

  await pb.collections.create({
    name: collectionName,
    type: 'base',
    listRule: '', // Empty string = allow all (public read for MVP)
    viewRule: '', // Empty string = allow all
    createRule: '', // Empty string = allow all
    updateRule: '', // Empty string = allow all (for lastActivityAt updates in MVP)
    deleteRule: null, // null = no access (disabled for MVP)
    fields: [
      {
        name: 'name',
        type: 'text',
        required: true,
      },
      {
        name: 'createdAt',
        type: 'number',
        required: true,
      },
      {
        name: 'createdBy',
        type: 'text',
        required: true,
      },
      {
        name: 'lastActivityAt',
        type: 'number',
        required: true,
      },
      {
        name: 'memberCount',
        type: 'number',
        required: true,
      },
    ],
  });

  console.log(`✅ Collection '${collectionName}' created successfully`);
}

/**
 * Create the 'loro_updates' collection
 */
async function createLoroUpdatesCollection() {
  const collectionName = 'loro_updates';

  if (await collectionExists(collectionName)) {
    console.log(`✅ Collection '${collectionName}' already exists, skipping...`);
    return;
  }

  console.log(`📦 Creating collection '${collectionName}'...`);

  await pb.collections.create({
    name: collectionName,
    type: 'base',
    listRule: '', // Empty string = allow all (public read for MVP)
    viewRule: '', // Empty string = allow all
    createRule: '', // Empty string = allow all
    updateRule: null, // null = no access (disabled for MVP)
    deleteRule: null, // null = no access (disabled for MVP)
    fields: [
      {
        name: 'groupId',
        type: 'text',
        required: true,
      },
      {
        name: 'timestamp',
        type: 'number',
        required: true,
      },
      {
        name: 'actorId',
        type: 'text',
        required: true,
      },
      {
        name: 'updateData',
        type: 'text',
        required: true,
      },
      {
        name: 'version',
        type: 'json',
        required: false,
      },
    ],
  });

  console.log(`✅ Collection '${collectionName}' created successfully`);
  console.log(`   ⚠️  Real-time subscriptions are enabled by default`);
}

/**
 * Create the 'invitations' collection
 */
async function createInvitationsCollection() {
  const collectionName = 'invitations';

  if (await collectionExists(collectionName)) {
    console.log(`✅ Collection '${collectionName}' already exists, skipping...`);
    return;
  }

  console.log(`📦 Creating collection '${collectionName}'...`);

  await pb.collections.create({
    name: collectionName,
    type: 'base',
    listRule: '', // Allow all (public read for MVP)
    viewRule: '', // Allow all
    createRule: '', // Allow all (for MVP)
    updateRule: '', // Allow all (for revocation)
    deleteRule: null, // No deletes
    fields: [
      {
        name: 'groupId',
        type: 'text',
        required: true,
      },
      {
        name: 'inviterPublicKeyHash',
        type: 'text',
        required: true,
      },
      {
        name: 'createdAt',
        type: 'number',
        required: true,
      },
      {
        name: 'expiresAt',
        type: 'number',
        required: false,
      },
      {
        name: 'maxUses',
        type: 'number',
        required: false,
        options: {
          min: 0, // 0 could mean unlimited
        },
      },
      {
        name: 'usedCount',
        type: 'number',
        required: false, // Can't use required:true because it enforces nonzero
        options: {
          min: 0, // Allow 0 and positive values
        },
      },
      {
        name: 'status',
        type: 'text',
        required: true,
      },
    ],
  });

  console.log(`✅ Collection '${collectionName}' created successfully`);
}

/**
 * Create the 'join_requests' collection
 */
async function createJoinRequestsCollection() {
  const collectionName = 'join_requests';

  if (await collectionExists(collectionName)) {
    console.log(`✅ Collection '${collectionName}' already exists, skipping...`);
    return;
  }

  console.log(`📦 Creating collection '${collectionName}'...`);

  await pb.collections.create({
    name: collectionName,
    type: 'base',
    listRule: '', // Allow all (public read for MVP)
    viewRule: '', // Allow all
    createRule: '', // Allow all (anyone can request to join)
    updateRule: '', // Allow all (for approval/rejection)
    deleteRule: null, // No deletes
    fields: [
      {
        name: 'invitationId',
        type: 'text',
        required: true,
      },
      {
        name: 'groupId',
        type: 'text',
        required: true,
      },
      {
        name: 'requesterPublicKey',
        type: 'text',
        required: true,
      },
      {
        name: 'requesterPublicKeyHash',
        type: 'text',
        required: true,
      },
      {
        name: 'requesterName',
        type: 'text',
        required: true,
      },
      {
        name: 'requestedAt',
        type: 'number',
        required: true,
      },
      {
        name: 'status',
        type: 'text',
        required: true,
      },
      {
        name: 'approvedBy',
        type: 'text',
        required: false,
      },
      {
        name: 'approvedAt',
        type: 'number',
        required: false,
      },
      {
        name: 'rejectedBy',
        type: 'text',
        required: false,
      },
      {
        name: 'rejectedAt',
        type: 'number',
        required: false,
      },
      {
        name: 'rejectionReason',
        type: 'text',
        required: false,
      },
    ],
  });

  console.log(`✅ Collection '${collectionName}' created successfully`);
}

/**
 * Create the 'key_packages' collection
 */
async function createKeyPackagesCollection() {
  const collectionName = 'key_packages';

  if (await collectionExists(collectionName)) {
    console.log(`✅ Collection '${collectionName}' already exists, skipping...`);
    return;
  }

  console.log(`📦 Creating collection '${collectionName}'...`);

  await pb.collections.create({
    name: collectionName,
    type: 'base',
    listRule: '', // Allow all (public read for MVP)
    viewRule: '', // Allow all
    createRule: '', // Allow all (members send keys)
    updateRule: null, // No updates
    deleteRule: null, // No deletes
    fields: [
      {
        name: 'joinRequestId',
        type: 'text',
        required: true,
      },
      {
        name: 'groupId',
        type: 'text',
        required: true,
      },
      {
        name: 'recipientPublicKeyHash',
        type: 'text',
        required: true,
      },

      // Key rotation support: which group key version this package establishes as "current".
      // The encrypted payload still contains all historical keys; this field allows receivers
      // to quickly detect whether they already have the latest key.
      {
        name: 'keyVersion',
        type: 'number',
        required: true,
      },

      // Optional: why this package was created (join vs rotate). Useful for debugging/UX later.
      {
        name: 'reason',
        type: 'text',
        required: false,
      },

      {
        name: 'senderPublicKeyHash',
        type: 'text',
        required: true,
      },
      {
        name: 'senderPublicKey',
        type: 'text',
        required: true,
      },
      {
        name: 'senderSigningPublicKey',
        type: 'text',
        required: true,
      },
      {
        name: 'encryptedKeys',
        type: 'json',
        required: true,
      },
      {
        name: 'createdAt',
        type: 'number',
        required: true,
      },
      {
        name: 'signature',
        type: 'text',
        required: true,
      },
    ],
  });

  console.log(`✅ Collection '${collectionName}' created successfully`);
  console.log(`   ℹ️  Includes key rotation fields: keyVersion, reason`);
}

/**
 * Main setup function
 */
async function setup() {
  console.log('🚀 Starting PocketBase collection setup...\n');
  console.log(`📡 Connecting to PocketBase at ${POCKETBASE_URL}`);

  try {
    // Check server health
    await pb.health.check();
    console.log('✅ PocketBase server is healthy\n');
  } catch (error) {
    console.error('❌ Error: PocketBase server is not reachable');
    console.error('   Make sure the server is running: pnpm --filter server serve');
    process.exit(1);
  }

  try {
    // Authenticate as admin
    console.log('🔐 Authenticating as admin...');
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ Admin authentication successful\n');
  } catch (error) {
    console.error('❌ Error: Admin authentication failed');
    console.error('   Please check your credentials in .env file');
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }

  try {
    // Create collections
    await createGroupsCollection();
    await createLoroUpdatesCollection();
    await createInvitationsCollection();
    await createJoinRequestsCollection();
    await createKeyPackagesCollection();

    // NOTE:
    // If you previously created 'key_packages' without keyVersion/reason fields,
    // this setup script will skip it (idempotent). For schema changes, delete the
    // collection in PocketBase admin UI (or use the reset script) and rerun setup.

    console.log('\n✅ All collections are set up successfully!');
    console.log('\n📋 Collections created:');
    console.log('   - groups (group metadata)');
    console.log('   - loro_updates (CRDT sync)');
    console.log('   - invitations (Phase 5)');
    console.log('   - join_requests (Phase 5)');
    console.log('   - key_packages (Phase 5)');

    console.log('\n📋 Next steps:');
    console.log('   1. Start the client: pnpm --filter client dev');
    console.log('   2. Test multi-user invite flow');
    console.log('   3. Share invite links between devices!');

    console.log('\n🔍 Test with curl:');
    console.log(`   curl ${POCKETBASE_URL}/api/collections/groups/records`);
    console.log(`   curl ${POCKETBASE_URL}/api/collections/invitations/records`);
  } catch (error) {
    console.error('\n❌ Error during setup:', error.message);
    if (error.data) {
      console.error('   Details:', JSON.stringify(error.data, null, 2));
    }
    process.exit(1);
  }
}

// Run setup
setup().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
