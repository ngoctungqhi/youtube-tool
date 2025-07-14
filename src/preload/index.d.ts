import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      selectFolder: () => Promise<string | null>
      generateAudio: (requestData: {
        content: string
        apiKey: string
        settings?: { audioOutputPath?: string }
      }) => Promise<void>
    }
  }
}
