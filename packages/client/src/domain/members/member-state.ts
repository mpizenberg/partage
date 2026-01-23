/**
 * Member State Management
 *
 * This module provides centralized logic for computing member state from
 * immutable events. All member operations should go through this module
 * to ensure consistency.
 *
 * Rules:
 * - rename: always possible
 * - retire: only possible on currently active members
 * - unretire: only possible on currently retired members
 * - replace (alias): only possible on currently active members
 *
 * A member is "active" if:
 * - Not currently retired AND
 * - Not replaced (aliased to another member)
 *
 * Invalid events are silently ignored during state computation.
 */

import type {
  MemberEvent,
  MemberCreatedEvent,
  MemberRenamedEvent,
  MemberRetiredEvent,
  MemberUnretiredEvent,
  MemberReplacedEvent,
  MemberState,
  MemberOperationValidation,
} from '@partage/shared';

/**
 * Intermediate state used during event processing.
 *
 * Note: Metadata fields (phone, payment, info) are NOT included here.
 * Metadata is encrypted in CRDT events and must be decrypted separately
 * using LoroEntryStore.getMemberMetadata().
 */
interface ProcessingState {
  id: string;
  name: string;
  publicKey?: string;
  isVirtual: boolean;
  createdAt: number;
  createdBy: string;
  isRetired: boolean;
  retiredAt?: number;
  isReplaced: boolean;
  replacedById?: string;
  replacedAt?: number;
}

/**
 * Compute the current state of a member from their events
 *
 * Events are processed in timestamp order. Invalid events are silently ignored.
 *
 * @param memberId The member ID to compute state for
 * @param events All events (will be filtered to this member)
 * @returns The computed member state, or null if member doesn't exist
 */
export function computeMemberState(memberId: string, events: MemberEvent[]): MemberState | null {
  // Filter events for this member and sort by timestamp
  const memberEvents = events
    .filter((e) => e.memberId === memberId)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (memberEvents.length === 0) {
    return null;
  }

  // First event must be a creation event
  const firstEvent = memberEvents[0];
  if (!firstEvent || firstEvent.type !== 'member_created') {
    console.warn(`[member-state] First event for member ${memberId} is not member_created`);
    return null;
  }

  // TypeScript now knows firstEvent is MemberCreatedEvent
  const createdEvent = firstEvent as MemberCreatedEvent;

  // Initialize state from creation event
  const state: ProcessingState = {
    id: memberId,
    name: createdEvent.name,
    publicKey: createdEvent.publicKey,
    isVirtual: createdEvent.isVirtual,
    createdAt: createdEvent.timestamp,
    createdBy: createdEvent.actorId,
    isRetired: false,
    isReplaced: false,
  };

  // Process remaining events
  for (let i = 1; i < memberEvents.length; i++) {
    const event = memberEvents[i];
    if (event) {
      applyEvent(state, event);
    }
  }

  return {
    ...state,
    isActive: !state.isRetired && !state.isReplaced,
  };
}

/**
 * Compute the current state of all members from events
 *
 * @param events All member events
 * @returns Map of member ID to computed state
 */
export function computeAllMemberStates(events: MemberEvent[]): Map<string, MemberState> {
  // Get unique member IDs from creation events
  const memberIds = new Set<string>();
  for (const event of events) {
    if (event.type === 'member_created') {
      memberIds.add(event.memberId);
    }
  }

  // Compute state for each member
  const states = new Map<string, MemberState>();
  for (const memberId of memberIds) {
    const state = computeMemberState(memberId, events);
    if (state) {
      states.set(memberId, state);
    }
  }

  return states;
}

/**
 * Get all active members from a list of events
 *
 * @param events All member events
 * @returns Array of active member states
 */
export function getActiveMembers(events: MemberEvent[]): MemberState[] {
  const states = computeAllMemberStates(events);
  return Array.from(states.values()).filter((s) => s.isActive);
}

/**
 * Get all retired members from a list of events
 *
 * @param events All member events
 * @returns Array of retired member states
 */
export function getRetiredMembers(events: MemberEvent[]): MemberState[] {
  const states = computeAllMemberStates(events);
  return Array.from(states.values()).filter((s) => s.isRetired && !s.isReplaced);
}

/**
 * Get all replaced (aliased) members from a list of events
 *
 * @param events All member events
 * @returns Array of replaced member states
 */
export function getReplacedMembers(events: MemberEvent[]): MemberState[] {
  const states = computeAllMemberStates(events);
  return Array.from(states.values()).filter((s) => s.isReplaced);
}

/**
 * Resolve a member ID to its canonical (current) ID
 *
 * Follows the replacement chain recursively. If member A was replaced by B,
 * and B was replaced by C, then resolving A returns C.
 *
 * @param memberId The member ID to resolve
 * @param events All member events
 * @param maxDepth Maximum recursion depth (default 10)
 * @returns The canonical member ID
 */
export function resolveCanonicalMemberId(
  memberId: string,
  events: MemberEvent[],
  maxDepth: number = 10
): string {
  if (maxDepth <= 0) {
    console.warn(`[member-state] Max recursion depth reached resolving ${memberId}`);
    return memberId;
  }

  const state = computeMemberState(memberId, events);
  if (!state) {
    // Member doesn't exist in events, return as-is
    return memberId;
  }

  if (!state.isReplaced || !state.replacedById) {
    // Not replaced, this is the canonical ID
    return memberId;
  }

  // Recursively resolve the replacer
  return resolveCanonicalMemberId(state.replacedById, events, maxDepth - 1);
}

/**
 * Build a map of all canonical member ID resolutions for efficient lookup
 *
 * @param events All member events
 * @returns Map from any member ID to its canonical ID
 */
export function buildCanonicalIdMap(events: MemberEvent[]): Map<string, string> {
  const states = computeAllMemberStates(events);
  const canonicalMap = new Map<string, string>();

  for (const [memberId, _state] of states) {
    canonicalMap.set(memberId, resolveCanonicalMemberId(memberId, events));
  }

  return canonicalMap;
}

/**
 * Find all member IDs that resolve to the same canonical ID
 *
 * This is useful for finding all "aliases" of a member, including
 * the member themselves.
 *
 * @param canonicalId The canonical member ID
 * @param events All member events
 * @returns Array of member IDs that resolve to canonicalId
 */
export function findAllAliasesFor(canonicalId: string, events: MemberEvent[]): string[] {
  const canonicalMap = buildCanonicalIdMap(events);
  const aliases: string[] = [];

  for (const [memberId, resolvedId] of canonicalMap) {
    if (resolvedId === canonicalId) {
      aliases.push(memberId);
    }
  }

  return aliases;
}

/**
 * Get the display name for a member ID
 *
 * If the member has been replaced, returns the name of the canonical member.
 * This ensures we always show the most up-to-date name.
 *
 * @param memberId The member ID to get name for
 * @param events All member events
 * @returns The display name, or undefined if member not found
 */
export function getMemberDisplayName(memberId: string, events: MemberEvent[]): string | undefined {
  const canonicalId = resolveCanonicalMemberId(memberId, events);
  const state = computeMemberState(canonicalId, events);
  return state?.name;
}

// ==================== Validation Functions ====================

/**
 * Check if a rename operation is valid
 *
 * Rename is always valid as long as the member exists.
 *
 * @param memberId The member to rename
 * @param events All member events
 * @returns Validation result
 */
export function canRenameMember(
  memberId: string,
  events: MemberEvent[]
): MemberOperationValidation {
  const state = computeMemberState(memberId, events);
  if (!state) {
    return { valid: false, reason: 'Member does not exist' };
  }
  return { valid: true };
}

/**
 * Check if a retire operation is valid
 *
 * Retire is only valid if the member is currently active.
 *
 * @param memberId The member to retire
 * @param events All member events
 * @returns Validation result
 */
export function canRetireMember(
  memberId: string,
  events: MemberEvent[]
): MemberOperationValidation {
  const state = computeMemberState(memberId, events);
  if (!state) {
    return { valid: false, reason: 'Member does not exist' };
  }
  if (!state.isActive) {
    if (state.isRetired) {
      return { valid: false, reason: 'Member is already retired' };
    }
    if (state.isReplaced) {
      return { valid: false, reason: 'Member has been replaced by another member' };
    }
    return { valid: false, reason: 'Member is not active' };
  }
  return { valid: true };
}

/**
 * Check if an unretire operation is valid
 *
 * Unretire is only valid if the member is currently retired.
 *
 * @param memberId The member to unretire
 * @param events All member events
 * @returns Validation result
 */
export function canUnretireMember(
  memberId: string,
  events: MemberEvent[]
): MemberOperationValidation {
  const state = computeMemberState(memberId, events);
  if (!state) {
    return { valid: false, reason: 'Member does not exist' };
  }
  if (!state.isRetired) {
    return { valid: false, reason: 'Member is not retired' };
  }
  if (state.isReplaced) {
    return { valid: false, reason: 'Member has been replaced by another member' };
  }
  return { valid: true };
}

/**
 * Check if a replace (alias) operation is valid
 *
 * Replace is only valid if the target member is currently active.
 *
 * @param memberId The member being replaced
 * @param replacedById The new member taking over
 * @param events All member events
 * @returns Validation result
 */
export function canReplaceMember(
  memberId: string,
  replacedById: string,
  events: MemberEvent[]
): MemberOperationValidation {
  const state = computeMemberState(memberId, events);
  if (!state) {
    return { valid: false, reason: 'Member does not exist' };
  }
  if (!state.isActive) {
    if (state.isRetired) {
      return { valid: false, reason: 'Cannot replace a retired member' };
    }
    if (state.isReplaced) {
      return { valid: false, reason: 'Member has already been replaced' };
    }
    return { valid: false, reason: 'Member is not active' };
  }
  if (memberId === replacedById) {
    return { valid: false, reason: 'Cannot replace member with themselves' };
  }
  return { valid: true };
}

// ==================== Event Creation Helpers ====================

/**
 * Create a member created event
 */
export function createMemberCreatedEvent(
  memberId: string,
  name: string,
  actorId: string,
  options: { publicKey?: string; isVirtual: boolean }
): MemberCreatedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_created',
    memberId,
    name,
    timestamp: Date.now(),
    actorId,
    publicKey: options.publicKey,
    isVirtual: options.isVirtual,
  };
}

/**
 * Create a member renamed event
 */
export function createMemberRenamedEvent(
  memberId: string,
  previousName: string,
  newName: string,
  actorId: string
): MemberRenamedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_renamed',
    memberId,
    previousName,
    newName,
    timestamp: Date.now(),
    actorId,
  };
}

/**
 * Create a member retired event
 */
export function createMemberRetiredEvent(memberId: string, actorId: string): MemberRetiredEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_retired',
    memberId,
    timestamp: Date.now(),
    actorId,
  };
}

/**
 * Create a member unretired event
 */
export function createMemberUnretiredEvent(
  memberId: string,
  actorId: string
): MemberUnretiredEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_unretired',
    memberId,
    timestamp: Date.now(),
    actorId,
  };
}

/**
 * Create a member replaced event
 */
export function createMemberReplacedEvent(
  memberId: string,
  replacedById: string,
  actorId: string
): MemberReplacedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'member_replaced',
    memberId,
    replacedById,
    timestamp: Date.now(),
    actorId,
  };
}

// ==================== Private Helper Functions ====================

/**
 * Apply an event to a member's processing state
 *
 * Invalid events are silently ignored (this is intentional for CRDT
 * convergence - different replicas may receive events in different orders).
 */
function applyEvent(state: ProcessingState, event: MemberEvent): void {
  switch (event.type) {
    case 'member_renamed':
      // Rename is always valid
      state.name = event.newName;
      break;

    case 'member_retired':
      // Only valid if currently active (not retired and not replaced)
      if (!state.isRetired && !state.isReplaced) {
        state.isRetired = true;
        state.retiredAt = event.timestamp;
      }
      break;

    case 'member_unretired':
      // Only valid if currently retired (and not replaced)
      if (state.isRetired && !state.isReplaced) {
        state.isRetired = false;
        state.retiredAt = undefined;
      }
      break;

    case 'member_replaced':
      // Only valid if currently active (not retired and not replaced)
      if (!state.isRetired && !state.isReplaced) {
        state.isReplaced = true;
        state.replacedById = event.replacedById;
        state.replacedAt = event.timestamp;
      }
      break;

    case 'member_metadata_updated':
      // Metadata is now encrypted and handled separately via getMemberMetadata().
      // Each event stores complete state (not deltas), so only the latest event is needed.
      break;

    case 'member_created':
      // Ignore duplicate creation events
      console.warn(`[member-state] Ignoring duplicate member_created event for ${event.memberId}`);
      break;

    default:
      console.warn(`[member-state] Unknown event type: ${(event as any).type}`);
  }
}
