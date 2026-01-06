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
 */

import PocketBase from 'pocketbase';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

const POCKETBASE_URL = process.env.VITE_POCKETBASE_URL || process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
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

    console.log('\n✅ All collections are set up successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Start the client: pnpm --filter client dev');
    console.log('   2. Open two browser tabs to test multi-device sync');
    console.log('   3. Create a group in one tab, see it appear in the other!');

    console.log('\n🔍 Test with curl:');
    console.log(`   curl ${POCKETBASE_URL}/api/collections/groups/records`);
    console.log(`   curl ${POCKETBASE_URL}/api/collections/loro_updates/records`);

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
