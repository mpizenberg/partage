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
- Creator becomes first member
- Encryption keys generated automatically

#### Join Group
- Click invite link / scan QR code / enter group code
- Pick member from already mentioned in expenses or enter new member name
- Generate encryption keypair automatically
- Existing members approve and share keys and historical data

#### Member Management
- View all members (active and departed)
- See join dates
- Invite new members (any member can invite)
- Leave group voluntarily
- When member joins: new group key version created
- When member leaves: new group key version created
- Departed members keep final balance snapshot (read-only)

#### Key Sharing
- Any member can share historical keys with:
  - New members requesting history
  - Existing members recovering from lost device
- Share all history or specific date range
- Activity log records all key sharing events

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
- Member joined
- Member left
- Historical keys shared
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
- "Carol shared Jan-Mar history with Dan - 2 days ago"
- "Dan joined as new member - 3 days ago"
- "Eve joined as 'Alice' (identified as existing person) - 4 days ago"

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

2. **Group Symmetric Key** (per group, versioned):
   - Generated on group creation
   - New version on each member join/leave
   - Encrypted for each member with their public key

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

**Key Rotation**:
- New member joins → new group key version
- Member leaves → new group key version
- Historical keys retained for decrypting old entries

**Key Sharing**:
- Any member can share historical keys
- Keys encrypted with recipient's public key
- Server never sees plaintext keys
- Activity log records sharing events

**Key Storage**:
- Client: all group keys (current + historical)
- Server: no key storing

### 4.4 Recovery

**Only Method: Group-Assisted Recovery**:

1. User loses device/private key
2. User gets new device, generates new keypair
3. User contacts group member (WhatsApp, phone, etc.)
4. User joins group with new identity
5. Member recognizes user (verifies externally)
6. Member shares historical keys with new identity
7. User regains access to all data

**No Recovery Key Needed**:
- Recovery key would just be the user's private key
- Same as exporting private key to another device
- Multi-device support achieves same goal more naturally

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
1. Click invite link
2. Enter name
3. Choose: "I'm a new member" or "I'm [existing person]"
5. Automatically make a historical data request
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

- Receipt attachments / photos
- Receipt OCR
- Recurring expenses
- Budget tracking
- Expense categories (beyond predefined)
- Comments on entries
- Dispute resolution workflow
- Rate limiting / abuse prevention
- Email notifications
- Group chat
- Map view
- Analytics dashboard
- Import from other apps
- Export to PDF/CSV
- Multi-group balance consolidation
- Tax categorization
- API for third-party integrations

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
- Client: Persistent encrypted storage
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
