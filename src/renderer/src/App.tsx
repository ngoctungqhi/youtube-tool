import { useState } from 'react'
import SettingsDialog from './components/SettingsDialog'
import ScriptGenerator from './components/ScriptGenerator'

function App(): React.JSX.Element {
  // const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Main Script Generator */}
      <ScriptGenerator onOpenSettings={() => setIsSettingsOpen(true)} />

      {/* Settings Dialog */}
      <SettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  )
}

export default App
