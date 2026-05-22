import { ModStatusPage } from '@/features/mod-status/ui/ModStatusPage'
import { UpdateToast } from '@/features/app-update/ui/UpdateToast'
import { useAppUpdate } from '@/features/app-update/model/use-app-update'
import './App.css'

function App() {
  const update = useAppUpdate({ autoCheck: true, delayMs: 3000 })

  const toastVisible =
    update.status === 'available' ||
    update.status === 'downloading' ||
    update.status === 'installing' ||
    (update.status === 'error' && !update.dismissed)

  return (
    <div className="App">
      <ModStatusPage appUpdate={update} />
      <UpdateToast
        visible={toastVisible}
        status={update.status}
        latestVersion={update.latestVersion}
        downloadProgress={update.downloadProgress}
        errorMessage={update.errorMessage}
        onInstall={() => void update.install()}
        onDismiss={update.dismiss}
      />
    </div>
  )
}

export default App
