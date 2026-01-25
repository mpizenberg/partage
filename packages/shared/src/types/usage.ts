/**
 * Usage tracking types for estimating server costs
 * All data stored locally, never sent to server
 */

/**
 * Pricing constants for server cost estimation (per month)
 * Based on typical low-cost VPS pricing
 */
export const USAGE_PRICING = {
  /** Base VPS cost allocated per user ($/month) */
  BASE_COST: 0.1,

  /** Storage cost ($/MB/month) - typical VPS storage */
  STORAGE_PER_MB: 0.0002, // ~$0.10/GB/month

  /** Network bandwidth cost ($/MB) - typical VPS bandwidth */
  BANDWIDTH_PER_MB: 0.0001, // ~$0.10/GB

  /** CPU + Mem multiplier relative to storage cost (dimensionless) */
  CPU_MULTIPLIER: 5.0, // CPU + Mem costs ≈ 5 x storage costs

  /** Minimum interval between storage estimates (milliseconds) */
  STORAGE_ESTIMATE_INTERVAL: 24 * 60 * 60 * 1000, // 1 day
} as const;

/**
 * Storage cost estimation snapshot
 * Recalculated at most once per day or on page refresh (if >1 day elapsed)
 */
export interface StorageEstimate {
  /** Timestamp when this estimate was calculated */
  timestamp: number;

  /** Total size of encrypted data in bytes */
  sizeBytes: number;
}

/**
 * Usage statistics tracked locally (minimal stored state)
 * Other values are derived from these base metrics
 */
export interface UsageStats {
  /** Total network bytes transferred (downloads, tracked via Performance API) */
  totalBytesTransferred: number;

  /** Timestamp when tracking started */
  trackingSince: number;

  /** Latest storage estimate (updated at most once per day) */
  lastStorageEstimate: StorageEstimate | null;
}

/**
 * Cost breakdown for display (all derived values)
 */
export interface CostBreakdown {
  /** Base VPS allocation cost ($/month) */
  baseCost: number;

  /** Storage cost accumulated (USD) */
  storageCost: number;

  /** CPU cost estimate (USD) */
  cpuCost: number;

  /** Network bandwidth cost (USD) */
  networkCost: number;

  /** Total estimated cost (USD) */
  totalCost: number;

  /** Months since tracking started */
  monthsSinceStart: number;

  /** Average cost per month (USD/month) */
  averagePerMonth: number;
}
