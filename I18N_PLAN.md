# Internationalization (i18n) Implementation Plan

## Overview

Add French language support to Partage using `@solid-primitives/i18n`, with browser locale auto-detection and language switcher in both onboarding and group settings.

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Library | `@solid-primitives/i18n` | Lightweight (~2KB), SolidJS-native, sufficient for ~200 strings |
| Locale storage | `localStorage` | Synchronous access on app load, no IndexedDB schema changes |
| Detection | `navigator.language` | Auto-detect with English fallback |
| Loading | Dynamic imports | Lazy-load locale files, only load active language |

## File Structure

```
packages/client/src/
├── i18n/
│   ├── index.ts              # Exports: I18nProvider, useI18n, Locale type
│   ├── context.tsx           # I18nContext, provider, locale detection
│   ├── formatters.ts         # formatCurrency, formatDate, formatRelativeTime
│   └── locales/
│       ├── en.json           # English (~200 strings)
│       └── fr.json           # French (~200 strings)
└── ui/components/common/
    └── LanguageSwitcher.tsx  # Dropdown component
```

## Implementation Phases

### Phase 1: Foundation (Core Infrastructure)

**1.1 Install dependency**
```bash
pnpm add @solid-primitives/i18n --filter @partage/client
```

**1.2 Create i18n context** (`src/i18n/context.tsx`)
- Define `Locale` type: `'en' | 'fr'`
- Browser locale detection with fallback to 'en'
- Dynamic import for locale JSON files
- `localStorage` for persistence (key: `partage-locale`)
- Expose: `locale()`, `setLocale()`, `t()` function

**1.3 Create locale files** (`src/i18n/locales/en.json`, `fr.json`)
- Start with core namespaces: `common`, `setup`, `groups`, `validation`, `categories`, `tabs`
- Use dot notation keys: `"setup.title"`, `"validation.required"`
- Support interpolation: `"You owe {amount}"`

**1.4 Create main exports** (`src/i18n/index.ts`)
```typescript
export { I18nProvider, useI18n } from './context'
export type { Locale } from './context'
export * from './formatters'
```

**Files to create:**
- `packages/client/src/i18n/context.tsx`
- `packages/client/src/i18n/index.ts`
- `packages/client/src/i18n/locales/en.json`
- `packages/client/src/i18n/locales/fr.json`

### Phase 2: Formatting Utilities

**2.1 Create centralized formatters** (`src/i18n/formatters.ts`)

Replace 5+ duplicate `formatCurrency` implementations:
```typescript
export function formatCurrency(amount: number, currency: string, locale: Locale): string
export function formatDate(timestamp: number, locale: Locale, format?: 'short' | 'long'): string
export function formatRelativeTime(timestamp: number, locale: Locale): string
```

Key locale mappings:
- `'en'` → `'en-US'` (for Intl APIs)
- `'fr'` → `'fr-FR'`

**Files to create:**
- `packages/client/src/i18n/formatters.ts`

### Phase 3: Integration & Language Switcher

**3.1 Update App.tsx** - Wrap with I18nProvider
```typescript
<I18nProvider>
  <AppProvider>
    <HashRouter>...</HashRouter>
  </AppProvider>
</I18nProvider>
```

**3.2 Create LanguageSwitcher** (`src/ui/components/common/LanguageSwitcher.tsx`)
- Simple dropdown: English / Français
- Uses existing `Select` component
- Calls `setLocale()` on change

**3.3 Add switcher to screens**
- `SetupScreen.tsx` - Top right corner, before "Get Started"
- `GroupViewScreen.tsx` - In header dropdown menu

**Files to modify:**
- `packages/client/src/App.tsx`
- `packages/client/src/ui/screens/SetupScreen.tsx`
- `packages/client/src/ui/screens/GroupViewScreen.tsx`

**Files to create:**
- `packages/client/src/ui/components/common/LanguageSwitcher.tsx`

### Phase 4: String Extraction - Screens

Extract strings in user journey order. Pattern:
```typescript
// Before
<h1>Welcome to Partage</h1>

// After
const { t } = useI18n()
<h1>{t('setup.title')}</h1>
```

**4.1 SetupScreen.tsx** (~12 strings)
- `setup.title`, `setup.subtitle`, `setup.privacy`
- `setup.generateIdentity`, `setup.generateDescription`
- `setup.getStarted`, `setup.generatingKeys`, `setup.keysStored`

**4.2 CreateGroupScreen.tsx** (~20 strings)
- `createGroup.title`, `createGroup.subtitle`
- `createGroup.groupName`, `createGroup.yourName`, `createGroup.defaultCurrency`
- Validation: `validation.groupNameRequired`, `validation.selectCurrency`

**4.3 JoinGroupScreen.tsx** (~15 strings)
- `joinGroup.title`, `joinGroup.selectIdentity`
- `joinGroup.newMember`, `joinGroup.existingMember`

**4.4 GroupSelectionScreen.tsx** (~25 strings)
- `groups.title`, `groups.subtitle`, `groups.noGroups`
- `groups.memberCount` (with interpolation)

**4.5 GroupViewScreen.tsx** (~15 strings)
- `balance.youOwe`, `balance.youAreOwed`, `balance.allSettled`
- Tab labels: `tabs.balance`, `tabs.entries`, `tabs.settle`, `tabs.members`, `tabs.activity`

**Files to modify:**
- `packages/client/src/ui/screens/SetupScreen.tsx`
- `packages/client/src/ui/screens/CreateGroupScreen.tsx`
- `packages/client/src/ui/screens/JoinGroupScreen.tsx`
- `packages/client/src/ui/screens/GroupSelectionScreen.tsx`
- `packages/client/src/ui/screens/GroupViewScreen.tsx`

### Phase 5: String Extraction - Components

**5.1 Form components** (~80 strings)
- `ExpenseForm.tsx` - Labels, placeholders, validation, categories
- `TransferForm.tsx` - Similar form strings
- `AddEntryModal.tsx` - Modal title, tabs
- `MemberManager.tsx` - Member strings

**5.2 Balance components** (~25 strings)
- `BalanceCard.tsx` - Balance display, actions
- `SettlementPlan.tsx` - Settlement UI
- `SettleTab.tsx` - Settlement screen

**5.3 Entry components** (~30 strings)
- `EntryCard.tsx` - Entry display, delete confirmation
- `EntryList.tsx` - Date groupings ("Today", "Yesterday", etc.)
- `EntriesTab.tsx` - Empty states

**5.4 Activity components** (~20 strings)
- `ActivityCard.tsx` - Activity descriptions
- `ActivitiesTab.tsx` - Empty states

**5.5 Member components** (~15 strings)
- `MembersTab.tsx`, `MemberList.tsx`
- `InviteModal.tsx`

**Files to modify:** (grouped by directory)
```
forms/: ExpenseForm.tsx, TransferForm.tsx, AddEntryModal.tsx, MemberManager.tsx
balance/: BalanceCard.tsx, BalanceTab.tsx, SettlementPlan.tsx
entries/: EntryCard.tsx, EntryList.tsx, EntriesTab.tsx, EntriesFilter.tsx
activities/: ActivityCard.tsx, ActivityList.tsx, ActivitiesTab.tsx
settle/: SettleTab.tsx
members/: MembersTab.tsx, MemberList.tsx
invites/: InviteModal.tsx
```

### Phase 6: Replace Formatting Calls

Update components to use centralized formatters with locale:
```typescript
// Before (duplicated in 5+ files)
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

// After
import { formatCurrency } from '../../i18n'
const { locale } = useI18n()
formatCurrency(amount, currency, locale())
```

**Files with formatting to update:**
- `BalanceCard.tsx` - currency formatting
- `SettlementPlan.tsx` - currency formatting
- `EntryCard.tsx` - currency, relative time
- `ActivityCard.tsx` - currency, date, relative time
- `GroupSelectionScreen.tsx` - date, currency
- `GroupViewScreen.tsx` - currency
- `MemberList.tsx` - date
- `EntryList.tsx` - date grouping labels

Also update:
- `domain/calculations/activity-generator.ts` - `formatRelativeTime` (keep for non-UI use, or make locale a parameter)

## Translation Keys Structure

```json
{
  "common": { "cancel", "save", "delete", "edit", "loading", "error" },
  "setup": { "title", "subtitle", "privacy", "generateIdentity", "getStarted" },
  "groups": { "title", "noGroups", "createNew", "memberCount" },
  "createGroup": { "title", "groupName", "yourName", "defaultCurrency" },
  "joinGroup": { "title", "newMember", "existingMember" },
  "validation": { "required", "amountGreaterThanZero", "selectPayer" },
  "categories": { "food", "transport", "accommodation", ... },
  "tabs": { "balance", "entries", "settle", "members", "activity" },
  "balance": { "youOwe", "youAreOwed", "allSettled", "noTransactions" },
  "settle": { "title", "paymentCount", "markAsPaid", "allSettledTitle" },
  "entries": { "addExpense", "addTransfer", "deleteConfirm" },
  "time": { "justNow", "minutesAgo", "hoursAgo", "yesterday", "daysAgo" }
}
```

## Pluralization Approach

French and English have different plural rules:
- English: 0 = plural, 1 = singular, 2+ = plural
- French: 0 = singular, 1 = singular, 2+ = plural

Use separate keys for singular/plural:
```json
{
  "groups": {
    "memberCount": "{count} member",
    "memberCountPlural": "{count} members"
  }
}
```

Helper function in components:
```typescript
const memberCountText = count === 1
  ? t('groups.memberCount', { count })
  : t('groups.memberCountPlural', { count })
```

## Verification

### Automated Tests
1. Run existing test suite: `pnpm test --filter @partage/client`
2. Add formatter tests for both locales
3. Verify TypeScript: `pnpm tsc --noEmit`

### Manual Testing Checklist
- [ ] App loads with browser locale (test with `navigator.language = 'fr'`)
- [ ] Language switcher works in SetupScreen
- [ ] Language switcher works in GroupViewScreen
- [ ] Language persists after page refresh
- [ ] All screens display correctly in French
- [ ] Currency formatting: €1 234,56 (FR) vs €1,234.56 (EN)
- [ ] Date formatting: 15 janv. 2024 (FR) vs Jan 15, 2024 (EN)
- [ ] Relative time: "il y a 5 minutes" (FR) vs "5 minutes ago" (EN)
- [ ] Pluralization correct in both languages
- [ ] No untranslated strings (search for English text in FR mode)
- [ ] Build succeeds: `pnpm build --filter @partage/client`

## Estimated Effort

| Phase | Files | Estimated Time |
|-------|-------|----------------|
| Phase 1: Foundation | 4 new | 3-4 hours |
| Phase 2: Formatters | 1 new | 1-2 hours |
| Phase 3: Integration | 3 modified, 1 new | 2-3 hours |
| Phase 4: Screens | 5 modified | 4-5 hours |
| Phase 5: Components | ~15 modified | 8-10 hours |
| Phase 6: Formatting | ~8 modified | 2-3 hours |
| **Total** | ~20 files | **20-27 hours** |
