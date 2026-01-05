import { createSignal, Show } from 'solid-js';
import { useAppContext } from '../context/AppContext';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
export const SetupScreen = () => {
    const { initializeIdentity, error, clearError } = useAppContext();
    const [isGenerating, setIsGenerating] = createSignal(false);
    const handleGetStarted = async () => {
        try {
            setIsGenerating(true);
            clearError();
            await initializeIdentity();
            // Identity created - App will automatically navigate to next screen
        }
        catch (err) {
            console.error('Failed to initialize identity:', err);
            // Error is already set in context
        }
        finally {
            setIsGenerating(false);
        }
    };
    return (<div class="container">
      <div class="flex-center" style="min-height: 100vh;">
        <div class="setup-container text-center">
          <h1 class="text-3xl font-bold text-primary mb-lg">Welcome to Partage</h1>

          <div class="mb-xl">
            <p class="text-lg mb-md">
              Split bills with friends, family, and groups
            </p>
            <p class="text-base text-muted">
              Fully encrypted and private. Your data stays on your device.
            </p>
          </div>

          <div class="setup-box mb-xl">
            <h2 class="text-xl font-semibold mb-md">Generate Your Secure Identity</h2>
            <p class="text-base text-muted mb-lg">
              We'll create a unique cryptographic key pair to secure your data.
              This process only takes a few seconds.
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
              <p class="text-sm text-muted">Generating your keys...</p>
            </Show>

            <Show when={!isGenerating()}>
              <Button variant="primary" size="large" onClick={handleGetStarted} class="w-full">
                Get Started
              </Button>
            </Show>
          </div>

          <p class="text-sm text-muted">
            Your keys are stored securely on this device only.
          </p>
        </div>
      </div>
    </div>);
};
