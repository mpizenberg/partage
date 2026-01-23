/**
 * Member Metadata Types
 *
 * Additional metadata for members like payment info and contact details.
 * This metadata is stored via member events (MemberMetadataUpdatedEvent).
 */

import type { MemberPaymentInfo } from './member-events.js';

/**
 * Complete member metadata
 */
export interface MemberMetadata {
  phone?: string;
  payment?: MemberPaymentInfo;
  info?: string; // Free text field for any additional info
}
