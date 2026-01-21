/**
 * InstallPrompt - PWA installation prompt component
 * Shows installation prompt for mobile browsers with platform-specific instructions
 */

import { Component, createSignal, Show, onMount } from 'solid-js';
import { useI18n } from '../../../i18n';
import { Button } from './Button';

export const InstallPrompt: Component = () => {
  const { t } = useI18n();
  const [deferredPrompt, setDeferredPrompt] = createSignal<any>(null);
  const [showPrompt, setShowPrompt] = createSignal(false);
  const [isIOS, setIsIOS] = createSignal(false);
  const [isInStandaloneMode, setIsInStandaloneMode] = createSignal(false);

  onMount(() => {
    // Check if already installed
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone ||
      document.referrer.includes('android-app://');

    setIsInStandaloneMode(isStandalone);

    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);

    // Check if user previously dismissed
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    const dismissedTime = dismissed ? parseInt(dismissed, 10) : 0;
    const oneMinuteAgo = Date.now() - 60 * 1000; // 1 minute for testing

    if (isStandalone || (dismissed && dismissedTime > oneMinuteAgo)) {
      return;
    }

    // Listen for beforeinstallprompt (Android/Desktop Chrome)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // For iOS, show manual instructions after a delay
    if (iOS && !isStandalone) {
      setTimeout(() => setShowPrompt(true), 30000); // Show after 30 seconds
    }

    // Cleanup
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  });

  const handleInstall = async () => {
    const prompt = deferredPrompt();
    if (prompt) {
      prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === 'accepted') {
        setDeferredPrompt(null);
        setShowPrompt(false);
      }
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  return (
    <Show when={showPrompt() && !isInStandaloneMode()}>
      <div
        class="install-prompt card"
        style={{
          position: 'fixed',
          bottom: 'var(--space-md)',
          left: 'var(--space-md)',
          right: 'var(--space-md)',
          'z-index': '1000',
          'box-shadow': '0 4px 12px rgba(0,0,0,0.15)',
          'max-width': 'calc(100vw - 2 * var(--space-md))',
        }}
      >
        <Show
          when={!isIOS()}
          fallback={
            // iOS Instructions
            <>
              <h3 style={{ margin: '0 0 var(--space-sm) 0' }}>{t('install.title')}</h3>
              <p
                style={{
                  margin: '0 0 var(--space-sm) 0',
                  'font-size': 'var(--font-size-sm)',
                  color: 'var(--color-text-light)',
                }}
              >
                {t('install.iosInstructions')}
              </p>
              <div
                style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: 'var(--space-xs)',
                  margin: 'var(--space-sm) 0',
                  padding: 'var(--space-sm)',
                  background: 'var(--color-bg-secondary)',
                  'border-radius': 'var(--border-radius)',
                }}
              >
                <span style={{ 'font-size': '1.5rem' }}>📱</span>
                <span>→</span>
                <span style={{ 'font-size': '1.5rem' }}>📤</span>
                <span>→</span>
                <span style={{ 'font-size': 'var(--font-size-sm)' }}>
                  {t('install.addToHomeScreen')}
                </span>
              </div>
              <Button variant="secondary" onClick={handleDismiss} class="btn-full-width">
                {t('install.dismiss')}
              </Button>
            </>
          }
        >
          {/* Android/Desktop Chrome */}
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'center',
              gap: 'var(--space-md)',
              'flex-wrap': 'wrap',
            }}
          >
            <div style={{ flex: '1', 'min-width': '200px' }}>
              <h3 style={{ margin: '0 0 var(--space-xs) 0' }}>{t('install.title')}</h3>
              <p
                style={{
                  margin: '0',
                  'font-size': 'var(--font-size-sm)',
                  color: 'var(--color-text-light)',
                }}
              >
                {t('install.description')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <Button variant="secondary" onClick={handleDismiss}>
                {t('install.dismiss')}
              </Button>
              <Button variant="primary" onClick={handleInstall}>
                {t('install.install')}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};
