import { Component, createSignal, Show } from 'solid-js'
import { useI18n } from '../../i18n'
import { useAppContext } from '../context/AppContext'
import { Button } from '../components/common/Button'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { LanguageSwitcher } from '../components/common/LanguageSwitcher'

export const SetupScreen: Component = () => {
  const { t } = useI18n()
  const { initializeIdentity, error, clearError } = useAppContext()
  const [isGenerating, setIsGenerating] = createSignal(false)

  const handleGetStarted = async () => {
    try {
      setIsGenerating(true)
      clearError()
      await initializeIdentity()
      // Identity created - App will automatically navigate to next screen
    } catch (err) {
      console.error('Failed to initialize identity:', err)
      // Error is already set in context
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div class="container">
      <div class="flex-center" style="min-height: 100vh;">
        <div class="setup-container text-center">
          {/* Language switcher in top-right corner */}
          <div style="position: absolute; top: 1rem; right: 1rem;">
            <LanguageSwitcher />
          </div>

          <h1 class="text-3xl font-bold text-primary mb-lg">{t('setup.title')}</h1>

          <div class="mb-xl">
            <p class="text-lg mb-md">
              {t('setup.subtitle')}
            </p>
            <p class="text-base text-muted">
              {t('setup.privacy')}
            </p>
          </div>

          <div class="setup-box mb-xl">
            <h2 class="text-xl font-semibold mb-md">{t('setup.generateIdentity')}</h2>
            <p class="text-base text-muted mb-lg">
              {t('setup.generateDescription')} {t('setup.generateDescriptionExtra')}
            </p>

            <Show when={error()}>
              <div class="error-message mb-md">
                {error()}
              </div>
            </Show>

            <Show when={isGenerating()}>
              <div class="flex-center mb-md">
                <LoadingSpinner />
              </div>
              <p class="text-sm text-muted">{t('setup.generatingKeys')}</p>
            </Show>

            <Show when={!isGenerating()}>
              <Button
                variant="primary"
                size="large"
                onClick={handleGetStarted}
                class="w-full"
              >
                {t('setup.getStarted')}
              </Button>
            </Show>
          </div>

          <p class="text-sm text-muted">
            {t('setup.keysStored')}
          </p>
        </div>
      </div>
    </div>
  )
}
