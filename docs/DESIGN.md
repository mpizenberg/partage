# Bill-Splitting Application - Product Specification

## 1. Product Vision

A fully encrypted, local-first bill-splitting application for trusted groups that provides:

- Complete privacy through end-to-end encryption
- Conflict-free synchronization using CRDTs (Loro)
- Immutable audit trail
- Offline-first operation
- Zero knowledge server (relay only)

## 2. Architecture Overview

### 2.1 Client-Server Model

- **Client**: All encryption, decryption, balance calculation, UI
- **Server**: Encrypted data relay, no access to plaintext
- **Storage**: Client-side encrypted database, server stores encrypted CRDT operations

### 2.2 Data Encryption

**Fully Encrypted**:

- All expense data (amounts, descriptions, everything)
- All member information (names, emails)
- All settings and metadata
- All attachments (future)

**Unencrypted** (sync metadata only):

- Operation IDs
- Timestamps (for causal ordering)
- Actor IDs (anonymous identifiers)
- CRDT operation metadata
- Cryptographic signatures

### 2.3 Technology Stack

- **CRDT**: Loro (Replayable Event Graph)
- **Encryption**: AES-256-GCM (symmetric), RSA-4096 or ECDH (asymmetric)
- **Platform**: Web (PWA)
- **Storage**: IndexedDB (client), Pocketbase (server)

## 3. Functional Requirements

### 3.1 Group Management

#### Create Group

- User creates group with:
  - Group name
  - Default currency (ISO 4217 code)
  - Optional metadata:
    - Subtitle (short description shown in header)
    - Description (longer text shown on Members tab)
    - Links (array of label/URL pairs, displayed as clickable chips)
- Creator becomes first member
- Encryption keys generated automatically

#### Group Metadata

Groups can have optional metadata that provides context and useful links:

**Fields**:

- **Subtitle**: Short description displayed below group name in header (e.g., "Summer 2024 vacation")
- **Description**: Longer text displayed on the Members tab (e.g., "Expenses for our trip to Barcelona")
- **Links**: Array of {label, url} pairs displayed as clickable chips (e.g., "Shared Album", "Airbnb Booking")

**Implementation**:

- Stored via event-sourcing (`group_metadata_updated` events)
- Each event stores complete state (not deltas) - enables clearing fields
- Encrypted with group key (AES-256-GCM) - server cannot read content
- Timestamps unencrypted for efficient latest-event lookup
- Editable via modal on Members tab

#### Join Group

- Click invite link / scan QR code (link contains encrypted group key in URL fragment)
- Automatically fetch and decrypt group data
- Pick existing virtual member to claim identity or enter new member name
- Join immediately without approval (trusted group model)
- Access all historical data instantly

#### Member Management

- View all members (active and departed)
- See join dates
- Invite new members (any member can invite)
- Leave group voluntarily
- Virtual members can be added before they join (name-only placeholders)
- Member aliases: Link new joining members to existing virtual member identities
- When member claims virtual identity: all historical data transfers to new member
- Departed members keep final balance snapshot (read-only)

#### Member Event System

All member operations use an immutable event-sourced system. Member states are derived from processing all events in order.

**Event Types**:

- `member_created`: Creates a new member (virtual or real)
- `member_renamed`: Changes member display name
- `member_retired`: Marks member as retired (soft delete)
- `member_unretired`: Restores retired member to active
- `member_replaced`: Links member to another (for identity claims)
- `member_metadata_updated`: Updates member contact/payment info

**Member States (derived from events)**:

- **Active**: Not retired AND not replaced (visible in most UIs)
- **Retired**: Retired but not replaced (hidden by default, can be shown)
- **Replaced**: Has been claimed/linked to another member (hidden everywhere)

**Canonical ID Resolution**:

- When member A claims member B's identity, B is "replaced" by A
- All operations use canonical ID resolution: `B → A`
- Resolution is recursive: if A later replaced by C, then `B → A → C`
- Balance calculations, activity feeds, and entry displays all resolve to canonical IDs
- The canonical member's current name is displayed for all historical entries

**Member Display Rules by Screen**:

- **Group Selection**: Active members only (count and list)
- **Members Tab**: Active by default, checkbox to show retired
- **Balance Tab**: Canonical members only (resolved from entries)
- **Settle Tab**: Canonical for balances, active only for preferences
- **Activity Tab**: Canonical members (resolved from events)
- **Entries Tab**: Canonical members (payers/beneficiaries resolved)
- **New Entry Modal**: Active first (with "you" at top), retired collapsed

**Name Uniqueness**:

- All active member names must be unique (case-insensitive)
- Adding a virtual member checks against existing active names
- Retired or replaced members don't block name reuse

#### Member Metadata

Members can have optional metadata for contact and payment information:

**Fields**:

- **Phone**: Phone number (displayed as clickable tel: link)
- **Payment Info**: Payment methods for receiving money
  - IBAN (bank transfer)
  - Wero (European instant payment)
  - Lydia (French payment app)
  - Revolut
  - PayPal
  - Venmo
  - BTC (Bitcoin address)
  - Cardano (ADA address)
- **Info**: Free-text notes

**Implementation**:

- Stored via `member_metadata_updated` events
- Each event stores complete state (not deltas) - enables clearing fields
- Encrypted with group key (AES-256-GCM) - server cannot read content
- Timestamps unencrypted for efficient latest-event lookup
- Viewable by clicking on member card (opens detail modal)
- Editable in the same modal
- Metadata indicators shown on member cards (phone icon, payment icon)

**Use Cases**:

- Share payment details for settlements (IBAN, PayPal, etc.)
- Quick access to phone numbers for coordination
- Notes about member preferences or availability

### 3.2 Financial Entries

Two types of entries:

#### 3.2.1 Expense Entry

**Required Fields**:

- Amount (positive number, 2 decimal places)
- Currency (ISO 4217 code)
- Description (text)
- Date (defaults to now, user can change)
- Payers (one or more, with amounts)
- Beneficiaries (one or more, with split method)

**Optional Fields**:

- Category (food, transport, accommodation, entertainment, shopping, groceries, utilities, healthcare, other)
- Notes (longer description)
- Location (text)

**Beneficiaries - Split Methods**:

1. **Shares (default)**:
   - Each beneficiary gets N shares
   - Default: 1 share per person
   - UI: +/- buttons to adjust shares
   - Example: Bob (2 shares), Carol (1 share) → Bob pays 2/3, Carol pays 1/3

2. **Exact Amounts**:
   - Specify exact amount per beneficiary
   - Must sum to total expense amount
   - UI: Number input with cents precision
   - Example: Alice: $40.00, Bob: $35.50, Carol: $24.50

#### 3.2.2 Money Transfer Entry

Direct transfer between two members (not an expense).

**Required Fields**:

- Amount (positive number, 2 decimal places)
- Currency
- From member
- To member
- Date (defaults to now)

**Optional Fields**:

- Notes

### 3.3 Entry Lifecycle

#### Create Entry

- User fills form
- Client encrypts all fields
- Client signs with private key
- Client adds to local CRDT
- CRDT syncs encrypted operation to server
- Server broadcasts to other clients
- Other clients decrypt and update

#### Modify Entry

- Cannot modify original (immutability)
- Create new version that supersedes original
- New version references original ID
- Both versions retained in ledger
- UI shows current version by default
- Any member can modify any entry (configurable per group)

#### Delete Entry

- Cannot truly delete (immutability)
- Mark as deleted with optional reason
- Original remains in audit trail
- UI hides by default (can show deleted)
- Can be un-deleted
- Any member can delete (configurable per group)

### 3.4 Currency Handling

#### Currency Conversion

- Each entry can use any currency
- For entries in non-default currency:
  - User must provide exchange rate at transaction time
  - If online: fetch historical rate from API
  - If offline: queue for rate lookup when online
  - Both the default currency amount and the original amount in the currency of the entry are stored with entry (immutable)

#### Display

- All amounts displayed in group's default currency
- Original currency shown as secondary info
- Conversion rate from transaction time is the ratio of values in default / original currency

#### Rounding

- Round to cents (2 decimals)
- Total always sums correctly

### 3.5 Balance Calculation

**Computed locally from encrypted ledger**:

For each member:

- **Total Paid**: Sum of all payer amounts
- **Total Owed**: Sum of all beneficiary shares
- **Net Balance**: Total Paid - Total Owed
  - Positive: owed money (others owe you)
  - Negative: owes money (you owe others)

**Who Owes Whom**:

- Simplified debt graph
- Minimize number of transactions
- Show optimal settlement plan
- Example: A→B: $10, B→C: $10 simplifies to A→C: $10

We may also add constraints (and validate solutions exist) such as:

- only Alice can transfer money to Bob (hard constraint)
- Bob can only transfer money to Carol (hard constraint)
- Alice and Bob can easily transfer money to each other (prioritization)

### 3.6 Settlement

#### Settlement UI

**Two modes**:

**Mode 1: Settle Your Own Debt**

- "I owe Bob $45.00"
- Click "Settle with Bob"
- Creates transfer entry: You → Bob, $45.00
- Balance updates automatically

**Mode 2: Settle Another Member's Credit**

- "Bob is owed $30.00"
- "I'll pay Bob to settle his balance"
- Click "Pay Bob to settle their balance"
- Creates transfer entry: You → Bob, $30.00
- Bob’s balance is cleared
- You are now owed $30.00 more

#### Settlement Actions

- Record transfer (creates transfer entry)
- Optional: Add payment method (cash, Venmo, etc.)
- Optional: Add confirmation/reference number

### 3.7 Viewing & Filtering

#### Expense List

Default summary view:

- All entries (expenses + transfers) chronological, grouped by date
- For each entry show:
  - Description
  - Amount (in default currency)
  - Category icon
  - Indicator if you are concerned by entry

Personal view:

- Entries where I’m concerned (expenses + transfers) chronological, grouped by date
- For each entry show:
  - Description
  - Amount (in default currency)
  - Original currency (if different)
  - Category icon
  - Payer(s)
  - Beneficiaries
  - Your personal share (highlighted)

Personal view as if someone else is also possible. This is convenient for quick overview of another member’s transactions, especially if that other member has not personally joined the group. Their name is used for tracking purposes. Convenient for example for couples where only 1 has joined the group, and manages their finances together. Or when the application has issues for someone, who cannot formally join.

#### Filters

All filters combinable:

**By Person**:

- "Entries involving Alice"
  - Where Alice paid
  - OR where Alice owes
- "Entries paid by Alice"
- "Entries where Alice owes"

**By Category**:

- Transfer or one of the expenses categories
- Select one or multiple
- Applies to expenses only

**By Date**:

- Last 7 days
- Last 30 days
- This month
- Custom range (start/end date)

**By Currency**:

- Original currency ("Show only USD entries")

#### Search

- Search by description, notes or location
- Search by amount (exact or range)

#### Sorting

- Date (newest/oldest)
- Amount (highest/lowest)
- Category

### 3.8 Activity Feed

Track and display all group actions:

**Activity Types**:

- Entry added (expense or transfer)
- Entry modified
- Entry deleted
- Entry un-deleted
- Member joined (new member)
- Member linked (claimed virtual identity)
- Group settings changed

**Display Format**:

- Timestamp (relative or absolute)
- Actor (who did it)
- Action (what happened)
- Details (what changed)
- Link to entry

**Examples**:

- "Alice added 'Dinner at Mario's' - €45.00 - 2 hours ago"
- "Bob modified 'Taxi' (amount: $30 → $35) - Yesterday"
- "Carol joined the group - 2 days ago"
- "Dan joined and claimed identity of 'Dan (virtual)' - 3 days ago"
- "Eve joined as new member - 4 days ago"

**Filtering**:

- By activity type
- By actor
- By date range
- By entry

**Notifications**:

- Push notifications enabled by default
- Notify on:
  - New entry added where you are involved
  - Entry modified where you are involved
  - Someone joined
  - Someone shared keys and history with you

### 3.9 Audit Trail

**Complete History**:

- Every operation recorded permanently
- Cryptographically signed
- Cannot be deleted or modified
- Includes:
  - Operation type
  - Timestamp
  - Actor ID
  - Signature

**Entry History View**:
For any entry:

- Original version
- All modifications (versions)
- Who modified when
- What changed (diff view)
- Deletion reason (if deleted)

**Member Action Log**:

- View all actions by specific member
- Useful for verification/disputes

### 3.10 Export

**JSON Export**:

- Export entire group ledger
- Includes:
  - All entries (decrypted)
  - All members
  - All operations
  - Audit trail
  - Balance calculations
- Format: structured JSON
- Can be filtered before export
- Includes metadata (export date, group info)

**Export Scope**:

- All entries
- Filtered entries (current filters applied)
- Date range
- Specific member's transactions

## 4. Security & Privacy

### 4.1 Authentication & Identity

**No Traditional Authentication**:

- No username/password
- No server-side accounts
- User identity = cryptographic keypair
- User generates keypair on first use (in browser/app)

**Anti-Spam Protection** (Proof-of-Work):

- Group creation requires solving a PoW challenge
- Challenge: Find nonce where SHA256(challenge + nonce) has N leading zero bits
- Difficulty: 18 bits (~2-4 seconds to solve on modern hardware)
- Challenge signed by server (HMAC) to prevent forgery
- Unique challenge stored per group (prevents reuse)
- Group users created automatically after group exists

**User Identity Persistence**:

- Private key stored in browser/app secure storage
- Same identity can be used across multiple groups
- Identity is anonymous to server (just public key hash)

**Multi-Device**:

- User exports private key from device A
- Imports to device B (via QR code or file)
- Both devices have same identity
- Can participate in same groups

### 4.2 Encryption

**Key Types**:

1. **User Keypair** (per user):
   - Private key: stored locally only
   - Public key: shared with groups

2. **Group Symmetric Key** (per group, single key):
   - Generated on group creation
   - Never rotated (trusted group model)
   - Shared via URL fragment (never sent to server)
   - Base64URL encoded for URL safety

**Encryption Flow**:

1. **Creating Entry**:
   - Serialize entry data
   - Encrypt with current group key (AES-256-GCM)
   - Sign with user's private key
   - Send to server

2. **Reading Entry**:
   - Receive encrypted entry from server
   - Verify signature with creator's public key
   - Decrypt with appropriate group key version
   - Deserialize and display

### 4.3 Key Management

**Trusted Group Model**:

- Single group key created at group creation
- No key rotation (simplifies flow for trusted groups)
- Key embedded in URL fragment (never sent to server)
- Anyone with link can join and access all data

**Security Trade-offs**:

- **Acceptable for trusted groups**: Friends, family, roommates who share links via secure channels
- **Simplicity benefit**: No approval workflow, instant join, no key versioning complexity
- **Risk**: If link leaks, group data is accessible to anyone with the link

**Key Sharing**:

- Join link contains the group key in URL fragment
- Server never sees plaintext keys
- All members have same level of access to historical data

**Key Storage**:

- Client: single group key per group
- Server: no key storage (only encrypted CRDT operations)

### 4.4 Recovery

**Simplified Recovery with Trusted Groups**:

1. User loses device/private key
2. User contacts group member to get invite link again
3. User joins group with new device
4. User can claim existing virtual member identity (if previously linked)
5. All historical data immediately accessible

**Alternative: Multi-Device Export**:

- Export private key from device A (QR code or file)
- Import to device B
- Both devices have same identity
- Can participate in same groups

### 4.5 Privacy Guarantees

**Server Cannot See**:

- Entry amounts
- Entry descriptions
- Member names
- Categories, notes, locations
- Any business data whatsoever

**Server Can See**:

- Number of operations
- Approximate group size (from encrypted key count)
- Sync timing patterns
- Network metadata (IP addresses, device types)

### 4.6 Access Control

**Group-Level Permissions** (configurable):

- Anyone can add entries (default: yes)
- Anyone can modify entries (default: yes)
- Anyone can delete entries (default: yes)
- Anyone can invite members (default: yes)
- Anyone can share historical keys (default: yes)

**Per-Entry Permissions**:

- Creator can always modify/delete
- Others depend on group settings

### 4.7 Audit & Verification

**Signatures**:

- Every operation signed by creator
- Signature proves:
  - Who created it
  - Entry hasn't been tampered with
  - Entry is part of valid chain

**Verification**:

- Clients verify all signatures on receipt
- Invalid signatures rejected
- Prevents:
  - Forgery (pretending to be someone else)
  - Tampering (modifying past entries)
  - Repudiation (denying you created something)

**Audit Trail**:

- Complete operation log
- Locally verifiable
- Cannot be retroactively modified
- Disputes resolved by examining signed operations

## 5. User Experience

### 5.1 First Use

**New User Flow**:

1. Opens app → Keypair generated automatically (2 seconds)
2. "Create a group" or "Join a group" (paste invite link)
3. No account creation needed

**Joining First Group**:

1. Click invite link (contains group key in URL fragment)
2. Automatically decrypt and view existing members
3. Choose: "I'm a new member" or claim existing virtual member identity
4. Enter your name (if new) or confirm existing name
5. Join instantly with immediate access to all historical data
6. Start using

### 5.2 Adding Entry

**Quick Expense** (< 10 seconds):

1. Tap "+" button
2. Enter amount
3. Enter description
4. Select who paid (defaults to you)
5. Adjust shares with +/- buttons (defaults to equal)
6. Tap "Save"

**Detailed Expense** (< 30 seconds):

- Change currency
- Change date
- Multiple payers
- Switch to exact amounts
- Add category, notes, location

**Quick Transfer** (< 10 seconds):

1. Tap "Transfer" tab
2. Enter amount
3. Select from/to members
4. Tap "Save"

### 5.3 Viewing Balance

**Overview Screen**:

- Your net balance: large, prominent
  - "You owe $45.00" (red)
  - "You're owed $30.00" (green)
  - "All settled up ✓" (if zero)
- Per-member balances
- Settlement suggestions

### 5.4 Internationalization (i18n)

**Supported Languages**:

- English (en) - Default
- French (fr)

**Language Detection**:

- Auto-detect browser locale on first launch via `navigator.language`
- Fall back to English if locale not supported
- Persist user preference in `localStorage` (key: `partage-locale`)

**Language Switching**:

- Language selector available in:
  - Setup screen (before identity generation)
  - Group settings (header dropdown menu)
- Switching language updates UI immediately without page reload

**Implementation**:

- Library: `@solid-primitives/i18n` (~2KB, SolidJS-native)
- Locale files: JSON format with dot-notation keys (e.g., `"setup.title"`, `"balance.youOwe"`)
- Dynamic imports: Only active language loaded (lazy-load locale files)
- Interpolation support: `"You owe {amount}"` with parameter substitution
- Pluralization: Separate keys for singular/plural forms to handle language-specific rules

**Formatting**:

- Currency: Locale-aware via `Intl.NumberFormat` (e.g., €1,234.56 vs €1 234,56)
- Dates: Locale-aware via `Intl.DateTimeFormat` (e.g., Jan 15, 2024 vs 15 janv. 2024)
- Relative time: Locale-aware (e.g., "5 minutes ago" vs "il y a 5 minutes")

**Key Namespaces**:

- `common`: Shared UI strings (Cancel, Save, Delete, etc.)
- `setup`: Onboarding flow
- `groups`: Group management
- `balance`, `entries`, `settle`: Tab-specific strings
- `expenseForm`, `transferForm`: Form labels and validation
- `categories`: Expense categories
- `time`: Relative time expressions

## 6. Miscellaneous

### Currency exchange rates

For currency exchange rates, enter both currencies amounts manually for now.
In the future, we can use freecurrencyapi.com with an API key to help with settlement amounts in secondary currency.

### Member Identification

When user joins, for now assume they are good actors and trust them.
The new joiner must be online, and not use a duplicated name.

### Concurrent Modifications

When two people modify the same entry offline simultaneously, use the CRDT conflict resolution. All modifications kept for audit trail. Notify members involved by the conflict and its resolution.

### Settlement Deep Links

If an app is detected (is that possible in a PWA?) suggest using it with a deep link if supported.
Especially if the beneficiary of a transfer has provided information making it easy.

## 6. Out of Scope (Future)

**Current Limitations**:

- Receipt attachments / photos
- Receipt OCR
- Recurring expenses
- Budget tracking
- Expense categories (beyond predefined)
- Comments on entries
- Dispute resolution workflow
- Email notifications
- Group chat
- Map view
- Analytics dashboard
- Import from other apps
- Export to PDF/CSV
- Multi-group balance consolidation
- Tax categorization
- API for third-party integrations

**Future: Less-Trusted Groups**:
For groups with less trust (larger groups, semi-public):

- Key rotation on member join/leave
- Approval workflow for join requests
- Subgroup encryption (different keys for different member subsets)
- Per-entry encryption (only involved members can decrypt)
- Forward secrecy guarantees

## 7. Technical Constraints

### CRDT (Loro)

- Use Loro for all replicated data structures
- Map Loro types to our data model
- Leverage Replayable Event Graph for audit trail

Loro information: https://loro.dev/llms.txt

### Encryption

- AES-256-GCM for symmetric encryption
- ECDH P-256 for asymmetric
- WebCrypto API

### Storage

- Client: Persistent encrypted storage (IndexedDB)
  - **Base snapshots**: Full Loro CRDT state per group
  - **Incremental updates**: Delta updates between mutations (write optimization)
  - **Consolidation strategy**: Merge incrementals into base snapshot every 50 updates, on app load, or when idle
  - **Performance**: ~98% reduction in write volume vs. full snapshots on every mutation
- Server: Append-only encrypted operation log. Using Pocketbase (https://pocketbase.io/docs/js-overview/)
- No database queries on server (just store & relay)

### Platform

Progressive Web App (PWA) for modern browsers (Chrome, Firefox, Safari, Edge).

### Web App Tech Choices

Using SolidJS, with Vite, making the app mobile first.
Using Pnpm for package management.

## Appendix: Example Use Cases

### Use Case 1: Weekend Trip

- 4 friends, 3 days, ~20 entries
- Alice creates group "Beach Weekend"
- Invites Bob, Carol, Dan via link
- Throughout trip: quick expense entries
- Sunday evening: settle up
- Dan transfers to Alice, Bob transfers to Carol
- All settled ✓

### Use Case 2: Roommates

- 3 people sharing apartment
- Carol creates group "Apartment 42"
- Invites Alice and Bob
- Monthly: rent (equal split), utilities (exact amounts)
- Ad-hoc: groceries, supplies
- End of month: check balance, settle
- Pattern repeats

### Use Case 3: Group Vacation

- 6 people, international, 2 weeks
- Mix of currencies (USD, EUR, JPY)
- Large shared expenses (hotel: 6-way split)
- Small individual items (coffee: 1 person)
- Some activities only some people join
- Mid-trip: Alice loses phone
- Bob helps her rejoin with new device
- End of trip: complex settlement
- App suggests optimal payment plan
