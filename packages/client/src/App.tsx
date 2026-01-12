import { Component, Show, Match, Switch } from 'solid-js'
import { HashRouter, Route } from '@solidjs/router'
import { AppProvider, useAppContext } from './ui/context/AppContext'
import { SetupScreen } from './ui/screens/SetupScreen'
import { GroupSelectionScreen } from './ui/screens/GroupSelectionScreen'
import { GroupViewScreen } from './ui/screens/GroupViewScreen'
import { JoinGroupScreen } from './ui/screens/JoinGroupScreen'
import { LoadingSpinner } from './ui/components/common/LoadingSpinner'

const MainApp: Component = () => {
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
  return (
    <AppProvider>
      <HashRouter>
        <Route path="/join/:groupId/:groupKey" component={JoinGroupScreen} />
        <Route path="/*" component={MainApp} />
      </HashRouter>
    </AppProvider>
  )
}

export default App
