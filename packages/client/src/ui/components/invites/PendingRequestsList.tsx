/**
 * Pending Requests List - Shows join requests awaiting approval
 * Allows existing group members to approve or reject join requests
 */

import { Component, For, Show } from 'solid-js';
import type { JoinRequest } from '@partage/shared';
import { Button } from '../common/Button';

export interface PendingRequestsListProps {
  requests: JoinRequest[];
  onApprove: (requestId: string) => Promise<void>;
  onReject: (requestId: string, reason?: string) => Promise<void>;
  loading?: boolean;
}

export const PendingRequestsList: Component<PendingRequestsListProps> = (props) => {
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    return date.toLocaleDateString();
  };

  return (
    <div class="pending-requests">
      <Show
        when={props.requests.length > 0}
        fallback={
          <div class="empty-state">
            <p class="text-secondary">No pending join requests</p>
          </div>
        }
      >
        <For each={props.requests}>
          {(request) => (
            <div class="request-card">
              <div class="request-header">
                <div class="request-info">
                  <h4 class="request-name">{request.requesterName}</h4>
                  <p class="request-time text-secondary text-small">
                    {formatTimestamp(request.requestedAt)}
                  </p>
                </div>
                <span class="request-status-badge pending">Pending</span>
              </div>

              <div class="request-details">
                <p class="text-secondary text-small">
                  Public Key: <code class="public-key-hash">{request.requesterPublicKeyHash.slice(0, 12)}...</code>
                </p>
              </div>

              <div class="request-actions">
                <Button
                  variant="primary"
                  size="small"
                  onClick={() => props.onApprove(request.id)}
                  disabled={props.loading}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="small"
                  onClick={() => props.onReject(request.id, 'Rejected by member')}
                  disabled={props.loading}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
};
