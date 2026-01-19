/**
 * Centralized formatting utilities with locale awareness
 *
 * These replace the duplicated formatCurrency/formatDate implementations
 * scattered across 5+ component files.
 */

import type { Locale } from './context';

/**
 * Map our locale codes to Intl locale tags
 */
function getIntlLocale(locale: Locale): string {
  switch (locale) {
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    default:
      return 'en-US';
  }
}

/**
 * Format a currency amount
 *
 * @param amount - The numeric amount to format
 * @param currency - ISO 4217 currency code (e.g., 'USD', 'EUR')
 * @param locale - The locale to use for formatting
 * @returns Formatted currency string (e.g., "$1,234.56" or "1 234,56 €")
 */
export function formatCurrency(amount: number, currency: string, locale: Locale): string {
  const intlLocale = getIntlLocale(locale);
  return new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency: currency,
  }).format(amount);
}

/**
 * Format a date
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param locale - The locale to use for formatting
 * @param format - 'short' (Jan 15, 2024), 'long' (January 15, 2024), or 'monthYear' (January 2024)
 * @returns Formatted date string
 */
export function formatDate(
  timestamp: number,
  locale: Locale,
  format: 'short' | 'long' | 'monthYear' = 'short'
): string {
  const intlLocale = getIntlLocale(locale);
  const date = new Date(timestamp);

  if (format === 'short') {
    return date.toLocaleDateString(intlLocale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  if (format === 'long') {
    return date.toLocaleDateString(intlLocale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  // monthYear
  return date.toLocaleDateString(intlLocale, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format relative time (e.g., "5 minutes ago", "il y a 5 minutes")
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param locale - The locale to use for formatting
 * @param t - Translation function for localized strings
 * @returns Formatted relative time string, or null if older than 24 hours
 */
export function formatRelativeTime(
  timestamp: number,
  locale: Locale,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return t('time.justNow');
  }

  if (minutes < 60) {
    return minutes === 1
      ? t('time.minuteAgo', { count: minutes })
      : t('time.minutesAgo', { count: minutes });
  }

  if (hours < 24) {
    return hours === 1 ? t('time.hourAgo', { count: hours }) : t('time.hoursAgo', { count: hours });
  }

  if (days === 1) {
    return t('time.yesterday');
  }

  if (days < 7) {
    return t('time.daysAgo', { count: days });
  }

  // Fall back to formatted date for older entries
  return formatDate(timestamp, locale, 'short');
}

/**
 * Format relative time without requiring the t function
 * Uses hardcoded strings - useful for non-UI contexts
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param locale - The locale to use for formatting
 * @returns Formatted relative time string
 */
export function formatRelativeTimeSimple(timestamp: number, locale: Locale): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (locale === 'fr') {
    if (seconds < 60) return "À l'instant";
    if (minutes < 60) return `Il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
    if (hours < 24) return `Il y a ${hours} heure${hours > 1 ? 's' : ''}`;
    if (days === 1) return 'Hier';
    if (days < 7) return `Il y a ${days} jours`;
    return formatDate(timestamp, locale, 'short');
  }

  if (locale === 'es') {
    if (seconds < 60) return 'Justo ahora';
    if (minutes < 60) return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
    if (days === 1) return 'Ayer';
    if (days < 7) return `Hace ${days} días`;
    return formatDate(timestamp, locale, 'short');
  }

  // English
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(timestamp, locale, 'short');
}

/**
 * Get the date group label for entry grouping
 * (Today, Yesterday, This Week, or month/year)
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @param locale - The locale to use for formatting
 * @param t - Translation function for localized strings
 * @returns Group label string
 */
export function getDateGroupLabel(
  timestamp: number,
  locale: Locale,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const now = new Date();
  const date = new Date(timestamp);

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (entryDate.getTime() === today.getTime()) {
    return t('entries.today');
  }

  if (entryDate.getTime() === yesterday.getTime()) {
    return t('entries.yesterday');
  }

  if (entryDate.getTime() > weekAgo.getTime()) {
    return t('entries.thisWeek');
  }

  // Return month and year for older entries
  return formatDate(timestamp, locale, 'monthYear');
}

/**
 * Format a number with locale-appropriate decimal/thousands separators
 *
 * @param value - The number to format
 * @param locale - The locale to use for formatting
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted number string
 */
export function formatNumber(value: number, locale: Locale, decimals: number = 2): string {
  const intlLocale = getIntlLocale(locale);
  return new Intl.NumberFormat(intlLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
