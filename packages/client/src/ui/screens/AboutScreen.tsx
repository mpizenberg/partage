import { Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useI18n } from '../../i18n';
import { Button } from '../components/common/Button';

export const AboutScreen: Component = () => {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div class="container">
      <div class="about-content">
        <div class="about-header">
          <Button variant="secondary" onClick={() => navigate('/')}>
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            {t('common.back')}
          </Button>
          <h1 class="about-title">{t('about.title')}</h1>
        </div>
        <section class="about-section">
          <p class="text-lg mb-md">{t('about.greeting')}</p>
          <p class="text-base mb-md">{t('about.motivation')}</p>
        </section>

        <section class="about-section">
          <p class="text-base mb-md">
            {t('about.openSource')}{' '}
            <a
              href="https://github.com/mpizenberg/partage"
              target="_blank"
              rel="noopener noreferrer"
              class="text-link"
            >
              {t('about.completelyOpenSource')}
            </a>
            {t('about.privacyInfo')}
          </p>
        </section>

        <section class="about-section">
          <h2 class="text-xl font-semibold mb-md">{t('about.supportTitle')}</h2>
          <p class="text-base mb-md">{t('about.serverCosts')}</p>
          <p class="text-base mb-lg">{t('about.donationRequest')}</p>

          <div class="about-donation-box mb-lg">
            <h3 class="text-lg font-semibold mb-sm">{t('about.githubSponsors')}</h3>
            <p class="text-sm text-muted mb-md">{t('about.githubInfo')}</p>
            <a
              href="https://github.com/sponsors/mpizenberg"
              target="_blank"
              rel="noopener noreferrer"
              class="button button-primary w-full"
              style="text-align: center; display: block;"
            >
              {t('about.donateOnGitHub')}
            </a>
          </div>
        </section>

        <section class="about-section">
          <h2 class="text-xl font-semibold mb-md">{t('about.feedbackTitle')}</h2>
          <p class="text-base mb-md">{t('about.feedbackInfo')}</p>
          <a
            href="https://github.com/mpizenberg/partage/discussions"
            target="_blank"
            rel="noopener noreferrer"
            class="button button-secondary w-full"
            style="text-align: center; display: block;"
          >
            {t('about.visitDiscussions')}
          </a>
        </section>
      </div>
    </div>
  );
};
