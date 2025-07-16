import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  protocol,
  net,
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { GenerateScript } from './GenerateScript'
import { GenerateAudio } from './GenerateAudio'
import { GenerateImage } from './GenerateImage'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      webSecurity: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    const pathToMedia = new URL(request.url).pathname
    return net.fetch(`file://${pathToMedia}`)
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    // Open the DevTools by default in development mode
    if (is.dev) {
      window.webContents.openDevTools()
    }
  })
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// Add Gemini API handler
ipcMain.handle('generate-script', async (event, requestData) => {
  const { prompt, apiKey, outputPath } = requestData
  const progressCallbacks = {
    onProgress: (message: string) => {
      event.sender.send('script-progress', { type: 'progress', message })
    },
    onOutlineGenerated: (outline: string) => {
      event.sender.send('script-progress', {
        type: 'outline',
        content: outline,
      })
    },
    onSectionGenerated: (sectionNumber: number, content: string) => {
      event.sender.send('script-progress', {
        type: 'section',
        sectionNumber,
        content,
      })
    },
  }

  const generatedText = await GenerateScript(
    prompt,
    apiKey,
    outputPath,
    progressCallbacks,
  )

  return generatedText
})

// Add audio generation handler
ipcMain.handle('generate-audio', async (event, requestData) => {
  const { content, sectionIndex, apiKey, outputDir } = requestData

  const audioProgressCallbacks = {
    onProgress: (message: string) => {
      event.sender.send('audio-progress', { type: 'audio-progress', message })
    },
    onChunkGenerated: (chunkIndex: number, totalChunks: number) => {
      event.sender.send('audio-progress', {
        type: 'audio-progress',
        chunkIndex,
        totalChunks,
        message: `Processing audio chunk ${chunkIndex}/${totalChunks}`,
      })
    },
    onSectionComplete: (sectionIndex: number, outputPath: string) => {
      event.sender.send('audio-progress', {
        type: 'audio-progress',
        sectionIndex,
        outputPath,
        message: 'Audio generation completed!',
      })
    },
  }

  await GenerateAudio(
    content,
    sectionIndex,
    apiKey,
    outputDir,
    audioProgressCallbacks,
  )
})

// Add image generation handler
ipcMain.handle('generate-image', async (event, requestData) => {
  const { prompt, sectionIndex, apiKey, outputPath } = requestData

  const imageProgressCallback = (
    current: number,
    total: number,
    message: string,
  ): void => {
    event.sender.send('image-progress', {
      type: 'image-progress',
      chunkIndex: current,
      totalChunks: total,
      message,
    })
  }

  await GenerateImage(
    prompt,
    sectionIndex,
    apiKey,
    outputPath,
    imageProgressCallback,
  )
})

// Add folder selection handlers
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Output Folder',
  })

  if (result.canceled) {
    return null
  }

  return result.filePaths[0]
})

// Add audio file checking handler
ipcMain.handle('check-audio-file', async (_, outputDir: string) => {
  const fs = await import('fs/promises')
  const path = await import('path')

  try {
    // Read all files in the directory
    const files = await fs.readdir(outputDir)

    // Filter for WAV files and get their full paths
    const wavFiles = files
      .filter((file) => path.extname(file).toLowerCase() === '.wav')
      .map((file) => path.join(outputDir, file))

    return wavFiles
  } catch {
    return [] // Return empty array if directory doesn't exist or can't be read
  }
})

ipcMain.handle('check-image-files', async (_, outputDir: string) => {
  const fs = await import('fs/promises')
  const path = await import('path')

  try {
    // Read all files in the directory
    const files = await fs.readdir(outputDir)

    // Filter for image files and get their full paths
    const imageFiles = files
      .filter((file) => /\.(jpg|jpeg|png|gif)$/i.test(path.extname(file)))
      .map((file) => path.join(outputDir, file))

    return imageFiles
  } catch {
    return [] // Return empty array if directory doesn't exist or can't be read
  }
})
