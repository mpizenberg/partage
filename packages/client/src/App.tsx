import { Component, Show, Match, Switch } from 'solid-js'
import { AppProvider, useAppContext } from './ui/context/AppContext'
import { SetupScreen } from './ui/screens/SetupScreen'
import { GroupSelectionScreen } from './ui/screens/GroupSelectionScreen'
import { GroupViewScreen } from './ui/screens/GroupViewScreen'
import { LoadingSpinner } from './ui/components/common/LoadingSpinner'

const AppRouter: Component = () => {
  const { identity, activeGroup, isLoading } = useAppContext()

  return (
    <Show
      when={!isLoading()}
      fallback={
        <div class="container flex-center" style="min-height: 100vh;">
          <LoadingSpinner size="large" />
        </div>
      }
    >
      <Switch>
        {/* No identity - show setup screen */}
        <Match when={!identity()}>
          <SetupScreen />
        </Match>

        {/* Has identity, no active group - show group selection */}
        <Match when={identity() && !activeGroup()}>
          <GroupSelectionScreen />
        </Match>

        {/* Has active group - show group view */}
        <Match when={identity() && activeGroup()}>
          <GroupViewScreen />
        </Match>
      </Switch>
    </Show>
  )
}

const App: Component = () => {
  console.log('[App] App component rendering...')
  console.log('[App] About to render AppProvider')
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  )
}

export default App
