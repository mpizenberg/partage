/**
 * Group Event Types
 *
 * Group-level events that are managed via event sourcing (latest wins).
 * These are separate from member events and entry events.
 */

/**
 * A link with a label and URL
 */
export interface GroupLink {
  label: string;
  url: string;
}

/**
 * Base event interface with common fields
 */
export interface BaseGroupEvent {
  id: string; // Unique event ID
  groupId: string; // The group this event affects
  timestamp: number; // Unix timestamp
  actorId: string; // Who performed this action
}

/**
 * Group metadata updated event
 * Contains optional fields - only provided fields are updated
 */
export interface GroupMetadataUpdatedEvent extends BaseGroupEvent {
  type: 'group_metadata_updated';
  subtitle?: string;
  description?: string;
  links?: GroupLink[];
}

/**
 * Union type of all group events
 */
export type GroupEvent = GroupMetadataUpdatedEvent;

/**
 * Computed group metadata state from events
 */
export interface GroupMetadataState {
  subtitle?: string;
  description?: string;
  links: GroupLink[];
}
