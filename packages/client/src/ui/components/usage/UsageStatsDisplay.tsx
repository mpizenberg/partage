import { Component, createSignal, onMount, Show } from 'solid-js';
import { useI18n } from '../../../i18n';
import type { CostBreakdown } from '@partage/shared';

interface UsageStatsDisplayProps {
  onLoad: () => Promise<CostBreakdown>;
  onReset: () => Promise<void>;
}

export const UsageStatsDisplay: Component<UsageStatsDisplayProps> = (props) => {
  const { t } = useI18n();
  const [stats, setStats] = createSignal<CostBreakdown | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      const breakdown = await props.onLoad();
      setStats(breakdown);
    } catch (err) {
      console.error('Failed to load usage stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  onMount(async () => {
    await loadStats();
  });

  const handleReset = async () => {
    if (!window.confirm(t('usage.resetConfirm'))) {
      return;
    }

    try {
      await props.onReset();
      await loadStats();
    } catch (err) {
      console.error('Failed to reset usage stats:', err);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(amount);
  };

  return (
    <div class="usage-stats-box">
      <h3 class="text-lg font-semibold mb-sm">{t('usage.title')}</h3>
      <p class="text-sm text-muted mb-md">{t('usage.description')}</p>

      <Show
        when={!isLoading()}
        fallback={<div class="text-center text-muted">{t('common.loading')}</div>}
      >
        <Show when={stats()}>
          {(s) => (
            <div class="usage-stats-breakdown">
              <div class="usage-stat-row usage-stat-total">
                <span class="usage-stat-label">{t('usage.totalCost')}</span>
                <span class="usage-stat-value usage-stat-value-total">
                  {formatCurrency(s().totalCost)}
                </span>
              </div>

              <Show when={s().monthsSinceStart >= 2}>
                <div class="usage-stat-row">
                  <span class="usage-stat-label text-sm">{t('usage.averagePerMonth')}</span>
                  <span class="usage-stat-value text-sm">
                    {formatCurrency(s().averagePerMonth)}
                  </span>
                </div>
              </Show>

              <details class="usage-details mt-sm">
                <summary class="text-sm text-muted cursor-pointer">
                  {t('usage.showDetails')}
                </summary>
                <div class="usage-details-content mt-sm">
                  <div class="usage-stat-row-small">
                    <span>{t('usage.trackingSince')}</span>
                    <span>
                      {s().monthsSinceStart.toFixed(1)} {t('usage.months')}
                    </span>
                  </div>
                  <div class="usage-stat-row-small">
                    <span>{t('usage.baseAllocation')}</span>
                    <span>{formatCurrency(s().baseCost)}</span>
                  </div>
                  <div class="usage-stat-row-small">
                    <span>{t('usage.storage')}</span>
                    <span>{formatCurrency(s().storageCost)}</span>
                  </div>
                  <div class="usage-stat-row-small">
                    <span>{t('usage.compute')}</span>
                    <span>{formatCurrency(s().cpuCost)}</span>
                  </div>
                  <div class="usage-stat-row-small">
                    <span>{t('usage.bandwidth')}</span>
                    <span>{formatCurrency(s().networkCost)}</span>
                  </div>
                </div>
              </details>

              <button class="button button-secondary w-full mt-md" onClick={handleReset}>
                {t('usage.reset')}
              </button>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
};
