/**
 * Member Event Types
 *
 * All member operations are immutable events. The current state of a member
 * is computed by processing all events in order.
 *
 * Event types:
 * - MemberCreated: Initial member creation
 * - MemberRenamed: Name change (always valid)
 * - MemberRetired: Mark as inactive (only valid if currently active)
 * - MemberUnretired: Reactivate (only valid if currently retired)
 * - MemberReplaced: Link to another member (only valid if currently active)
 *
 * A member is "active" if:
 * - Not currently retired AND
 * - Not replaced (aliased to another member)
 */

/**
 * Base event interface with common fields
 */
export interface BaseMemberEvent {
  id: string; // Unique event ID
  memberId: string; // The member this event affects
  timestamp: number; // Unix timestamp
  actorId: string; // Who performed this action
}

/**
 * Initial member creation event
 */
export interface MemberCreatedEvent extends BaseMemberEvent {
  type: 'member_created';
  name: string;
  publicKey?: string; // Optional for virtual members
  isVirtual: boolean;
}

/**
 * Member rename event (always valid)
 */
export interface MemberRenamedEvent extends BaseMemberEvent {
  type: 'member_renamed';
  previousName: string;
  newName: string;
}

/**
 * Member retired event (only valid if currently active)
 */
export interface MemberRetiredEvent extends BaseMemberEvent {
  type: 'member_retired';
}

/**
 * Member unretired event (only valid if currently retired)
 */
export interface MemberUnretiredEvent extends BaseMemberEvent {
  type: 'member_unretired';
}

/**
 * Member replaced event (alias) - only valid if currently active
 * This links a new member (replacedById) to an existing member (memberId)
 * All historical data for memberId is now attributed to replacedById
 */
export interface MemberReplacedEvent extends BaseMemberEvent {
  type: 'member_replaced';
  replacedById: string; // The new member who is claiming this identity
}

/**
 * Union type of all member events
 */
export type MemberEvent =
  | MemberCreatedEvent
  | MemberRenamedEvent
  | MemberRetiredEvent
  | MemberUnretiredEvent
  | MemberReplacedEvent;

/**
 * Computed member state from events
 */
export interface MemberState {
  id: string;
  name: string;
  publicKey?: string;
  isVirtual: boolean;
  createdAt: number;
  createdBy: string;

  // Derived state
  isRetired: boolean;
  retiredAt?: number;
  isReplaced: boolean;
  replacedById?: string; // The member ID that replaced this one
  replacedAt?: number;

  // Convenience computed
  isActive: boolean; // !isRetired && !isReplaced
}

/**
 * Result of validating a member operation
 */
export interface MemberOperationValidation {
  valid: boolean;
  reason?: string;
}
