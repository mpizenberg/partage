/**
 * Internationalization (i18n) module for Partage
 *
 * Usage:
 *
 * 1. Wrap your app with I18nProvider:
 *    <I18nProvider>
 *      <App />
 *    </I18nProvider>
 *
 * 2. Use the useI18n hook in components:
 *    const { t, locale, setLocale } = useI18n()
 *
 * 3. Translate strings:
 *    <h1>{t('setup.title')}</h1>
 *
 * 4. With interpolation:
 *    <p>{t('balance.youOwe', { amount: '$50.00' })}</p>
 *
 * 5. Change locale:
 *    setLocale('fr')
 */

export { I18nProvider, useI18n } from './context'
export type { Locale } from './context'
export {
  formatCurrency,
  formatDate,
  formatRelativeTime,
  formatRelativeTimeSimple,
  getDateGroupLabel,
  formatNumber,
} from './formatters'
