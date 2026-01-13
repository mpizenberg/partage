import { Component, For, Show } from 'solid-js';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { ImportAnalysis } from '../../context/AppContext';

interface ImportPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: ImportAnalysis | null;
  onConfirm: (mergeExisting: boolean) => void;
}

export const ImportPreviewModal: Component<ImportPreviewModalProps> = (props) => {
  console.log('[ImportPreviewModal] Rendering, isOpen:', props.isOpen, 'analysis:', props.analysis);

  const getRelationshipBadge = (relationship: string) => {
    switch (relationship) {
      case 'new':
        return <span class="badge badge-success">New Group</span>;
      case 'local_subset':
        return <span class="badge badge-info">Will Add New Activity</span>;
      case 'import_subset':
        return <span class="badge badge-muted">Already Up to Date</span>;
      case 'diverged':
        return <span class="badge badge-warning">Has Diverged</span>;
      default:
        return <span class="badge badge-muted">Unknown</span>;
    }
  };

  const getRelationshipDescription = (relationship: string) => {
    switch (relationship) {
      case 'new':
        return 'This group will be added as a new group to your local database.';
      case 'local_subset':
        return 'Your local copy is behind. Import will add new entries and members to your existing group.';
      case 'import_subset':
        return 'Your local copy already includes all data from the import. Nothing will be changed.';
      case 'diverged':
        return 'Both local and import have unique data. Import will merge both histories (CRDT will handle conflicts).';
      default:
        return '';
    }
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const hasNewOrMergeable = () => {
    return props.analysis?.groups.some(
      (g) => g.relationship === 'new' || g.relationship === 'local_subset' || g.relationship === 'diverged'
    );
  };

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title="Import Groups">
      <Show when={props.analysis}>
        <div class="import-preview">
          {/* Export metadata */}
          <div class="mb-lg">
            <p class="text-sm text-muted">
              Export created: {formatDate(props.analysis!.exportData.exportedAt)}
            </p>
            <p class="text-sm text-muted">
              Version: {props.analysis!.exportData.version}
            </p>
            <p class="text-sm text-muted">
              Groups: {props.analysis!.groups.length}
            </p>
          </div>

          {/* Groups list */}
          <div class="import-groups-list">
            <For each={props.analysis!.groups}>
              {(item) => (
                <div class="card mb-md">
                  <div class="flex-between mb-sm">
                    <h3 class="text-lg font-semibold">{item.group.name}</h3>
                    {getRelationshipBadge(item.relationship)}
                  </div>

                  <p class="text-sm mb-sm">{getRelationshipDescription(item.relationship)}</p>

                  <div class="group-details text-sm text-muted">
                    <p>Currency: {item.group.defaultCurrency}</p>
                    <p>Members: {item.group.activeMembers?.length || 0}</p>
                    <p>Created: {formatDate(item.group.createdAt)}</p>

                    <Show when={item.exists}>
                      <p class="mt-sm">
                        <strong>Status:</strong> {item.relationship === 'import_subset'
                          ? 'No changes needed'
                          : 'Will be merged'}
                      </p>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* Actions */}
          <div class="modal-actions">
            <Button variant="secondary" onClick={props.onClose}>
              Cancel
            </Button>
            <Show when={hasNewOrMergeable()}>
              <Button
                variant="primary"
                onClick={() => props.onConfirm(true)}
              >
                Import & Merge
              </Button>
            </Show>
            <Show when={!hasNewOrMergeable()}>
              <p class="text-sm text-muted">
                All groups are already up to date. Nothing to import.
              </p>
            </Show>
          </div>
        </div>
      </Show>
    </Modal>
  );
};
