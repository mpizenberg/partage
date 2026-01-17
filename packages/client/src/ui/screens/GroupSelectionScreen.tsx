import { Component, Show, For, createSignal, createEffect, createResource } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useI18n, formatDate, formatNumber } from '../../i18n';
import { useAppContext, type ImportAnalysis } from '../context/AppContext';
import { Button } from '../components/common/Button';
import { ImportPreviewModal } from '../components/import/ImportPreviewModal';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';

export const GroupSelectionScreen: Component = () => {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { groups, identity, exportGroups, importGroups, confirmImport, deleteGroup, getGroupBalance } =
    useAppContext();
  const [importAnalysis, setImportAnalysis] = createSignal<ImportAnalysis | null>(null);
  const [showImportPreview, setShowImportPreview] = createSignal(false);
  const [groupToDelete, setGroupToDelete] = createSignal<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = createSignal<Set<string>>(new Set<string>());
  const [isAnalyzing, setIsAnalyzing] = createSignal(false);

  // Debug: Track modal state changes
  createEffect(() => {
    console.log('[GroupSelection] showImportPreview changed:', showImportPreview());
    console.log('[GroupSelection] importAnalysis:', importAnalysis());
  });

  const handleSelectGroup = (groupId: string) => {
    // Navigate to group view - GroupViewScreen will load the group
    navigate(`/groups/${groupId}`);
  };

  const truncateId = (id: string): string => {
    return id.substring(0, 8) + '...';
  };

  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const selectAllGroups = () => {
    const allIds = groups().map((g) => g.id);
    setSelectedGroupIds(new Set<string>(allIds));
  };

  const deselectAllGroups = () => {
    setSelectedGroupIds(new Set<string>());
  };

  const handleExportSelected = async () => {
    const selected = selectedGroupIds();
    if (selected.size === 0) {
      alert(t('export.noGroupsSelected'));
      return;
    }

    try {
      const groupIdsArray = Array.from(selected);
      const exportData = await exportGroups(groupIdsArray);

      // Download as JSON file
      const blob = new Blob([exportData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `partage-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('Export completed successfully:', groupIdsArray.length, 'groups');
      deselectAllGroups();
    } catch (err) {
      console.error('Export failed:', err);
      alert(t('export.failed') + ': ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleImport = async () => {
    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        setIsAnalyzing(true);
        console.log('[Import] Reading file:', file.name);
        const text = await file.text();
        console.log('[Import] File size:', text.length, 'bytes');

        console.log('[Import] Starting analysis...');
        const analysis = await importGroups(text);
        console.log('[Import] Analysis complete:', analysis);

        setImportAnalysis(analysis);
        setShowImportPreview(true);
        console.log('[Import] Modal should now be visible');
        console.log('[Import] showImportPreview():', showImportPreview());
        console.log('[Import] importAnalysis():', importAnalysis());
      } catch (err) {
        console.error('[Import] Import analysis failed:', err);
        alert(t('import.analysisFailed') + ': ' + (err instanceof Error ? err.message : 'Unknown error'));
      } finally {
        setIsAnalyzing(false);
      }
    };

    input.click();
  };

  const handleConfirmImport = async (mergeExisting: boolean) => {
    const analysis = importAnalysis();
    if (!analysis) return;

    try {
      await confirmImport(analysis.exportData, mergeExisting);
      setShowImportPreview(false);
      setImportAnalysis(null);
      alert(t('import.success'));
    } catch (err) {
      console.error('Import failed:', err);
      alert(t('import.failed') + ': ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    setGroupToDelete(groupId);
  };

  const confirmDelete = async () => {
    const groupId = groupToDelete();
    if (!groupId) return;

    try {
      await deleteGroup(groupId);
      setGroupToDelete(null);
      console.log('Group deleted successfully');
    } catch (err) {
      console.error('Delete failed:', err);
      alert(t('common.error') + ': ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const cancelDelete = () => {
    setGroupToDelete(null);
  };

  const getMemberCountText = (count: number): string => {
    return count === 1
      ? t('groups.memberCount', { count })
      : t('groups.memberCountPlural', { count });
  };

  // Helper component to display group balance as badge (replaces currency badge)
  const GroupBalanceBadge: Component<{ groupId: string; currency: string }> = (props) => {
    const [balance] = createResource(
      () => props.groupId,
      (id) => getGroupBalance(id)
    );

    return (
      <Show
        when={!balance.loading && balance()}
        fallback={<span class="currency-badge">{props.currency}</span>}
      >
        {(bal) => {
          const netBalance = bal().netBalance;
          const absBalance = Math.abs(netBalance);
          const isPositive = netBalance > 0.01;
          const isSettled = Math.abs(netBalance) < 0.01;

          return (
            <Show
              when={!isSettled}
              fallback={<span class="currency-badge">{props.currency}</span>}
            >
              <span
                class="currency-badge"
                style={{
                  'background-color': isPositive
                    ? 'var(--color-success-bg)'
                    : 'var(--color-danger-bg)',
                  'color': isPositive
                    ? 'var(--color-success)'
                    : 'var(--color-danger)',
                }}
              >
                {isPositive ? '+' : '-'}{props.currency} {formatNumber(absBalance, locale())}
              </span>
            </Show>
          );
        }}
      </Show>
    );
  };

  return (
    <>
        <div class="container">
          <div
            class="group-selection-screen"
            style="max-width: 600px; margin: 0 auto; padding-top: var(--space-xl);"
          >
            {/* Header with language switcher */}
            <div class="mb-xl">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--space-sm);">
                <h1 class="text-2xl font-bold">{t('groups.title')}</h1>
                <LanguageSwitcher />
              </div>
              <p class="text-base text-muted">{t('groups.subtitle')}</p>
              <Show when={identity()}>
                <p class="text-sm text-muted mt-sm">
                  {t('groups.yourId', { id: truncateId(identity()!.publicKeyHash) })}
                </p>
              </Show>
            </div>

            {/* Export/Import buttons */}
            <Show when={groups().length > 0}>
              <div class="mb-lg">
                <div class="flex gap-sm mb-sm">
                  <Button
                    variant="secondary"
                    onClick={handleImport}
                    class="flex-1"
                    disabled={isAnalyzing()}
                  >
                    {isAnalyzing() ? t('import.analyzing') : t('import.button')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleExportSelected}
                    class="flex-1"
                    disabled={selectedGroupIds().size === 0}
                  >
                    {t('export.exportSelected')} ({selectedGroupIds().size})
                  </Button>
                </div>
                <Show when={groups().length > 1}>
                  <div class="flex gap-sm text-sm">
                    <button class="link-button" onClick={selectAllGroups}>
                      {t('export.selectAll')}
                    </button>
                    <span class="text-muted">•</span>
                    <button class="link-button" onClick={deselectAllGroups}>
                      {t('export.deselectAll')}
                    </button>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Group list */}
            <Show
              when={groups().length > 0}
              fallback={
                <div class="empty-state mb-xl">
                  <div class="empty-state-icon">👥</div>
                  <h2 class="empty-state-title">{t('groups.noGroups')}</h2>
                  <p class="empty-state-message">
                    {t('groups.noGroupsMessage')}
                  </p>
                  <Button variant="secondary" onClick={handleImport} class="mt-md">
                    {t('import.button')}
                  </Button>
                </div>
              }
            >
              <div class="group-list mb-xl">
                <For each={groups()}>
                  {(group) => (
                    <div class="card group-card">
                      {/* Checkbox for selection */}
                      <div class="flex gap-md mb-sm">
                        <input
                          type="checkbox"
                          checked={selectedGroupIds().has(group.id)}
                          onChange={() => toggleGroupSelection(group.id)}
                          style="width: 20px; height: 20px; cursor: pointer; flex-shrink: 0;"
                        />
                        <div style="flex: 1; min-width: 0;">
                          <div class="clickable" onClick={() => handleSelectGroup(group.id)}>
                            <div class="flex-between mb-sm">
                              <h3 class="text-lg font-semibold">{group.name}</h3>
                              <GroupBalanceBadge groupId={group.id} currency={group.defaultCurrency} />
                            </div>
                            <p class="text-sm text-muted mb-xs">
                              {t('groups.createdAt', { date: formatDate(group.createdAt, locale()) })}
                            </p>
                            <p class="text-sm text-muted">
                              {(() => {
                                const membersToShow = (group.activeMembers || [])
                                  .filter((m) => m.status === 'active')
                                  .sort((a, b) => a.name.localeCompare(b.name));
                                return `${getMemberCountText(membersToShow.length)}: ${membersToShow.map((m) => m.name).join(', ')}`;
                              })()}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div
                        class="flex-between"
                        style="border-top: 1px solid var(--border-color); padding-top: var(--space-sm);"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div></div>
                        <Button
                          variant="danger"
                          size="small"
                          onClick={() => handleDeleteGroup(group.id)}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Create group button */}
            <Button
              variant="primary"
              size="large"
              onClick={() => navigate('/groups/new')}
              class="w-full"
            >
              + {t('groups.createNew')}
            </Button>
          </div>
        </div>

      {/* Import Preview Modal - Outside Show block for proper rendering */}
      <Show when={showImportPreview() && importAnalysis()}>
        <ImportPreviewModal
          isOpen={true}
          onClose={() => {
            console.log('[Import] Closing modal');
            setShowImportPreview(false);
            setImportAnalysis(null);
          }}
          analysis={importAnalysis()!}
          onConfirm={handleConfirmImport}
        />
      </Show>

      {/* Delete Confirmation Modal */}
      <Show when={groupToDelete()}>
        <div class="modal-overlay" onClick={cancelDelete}>
          <div class="modal-content" onClick={(e) => e.stopPropagation()}>
            <div class="modal-body">
              <h2 class="text-xl font-bold mb-md">{t('groups.deleteGroup')}?</h2>
              <p class="mb-lg">
                {t('groups.deleteConfirm')}
              </p>
              <div class="modal-actions">
                <Button variant="secondary" onClick={cancelDelete}>
                  {t('common.cancel')}
                </Button>
                <Button variant="danger" onClick={confirmDelete}>
                  {t('groups.deleteGroup')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};
