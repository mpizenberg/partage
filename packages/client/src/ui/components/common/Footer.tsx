import { Component } from 'solid-js'
import { useI18n } from '../../../i18n'

export const Footer: Component = () => {
  const { t } = useI18n()

  return (
    <footer class="footer">
      <div class="footer-content">
        <span class="footer-brand">
          <img src="/favicon.svg" alt="Partage" class="footer-icon" />
          partage
        </span>
        <span class="footer-separator">|</span>
        <a
          href="https://github.com/mpizenberg/partage"
          target="_blank"
          rel="noopener noreferrer"
          class="footer-link"
        >
          {t('footer.viewOnGitHub')}
        </a>
      </div>
    </footer>
  )
}
