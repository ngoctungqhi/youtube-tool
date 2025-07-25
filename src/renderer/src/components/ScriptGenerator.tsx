import React, { useState, useEffect } from 'react'
import { Settings, Loader2, CheckCircle, Clock } from 'lucide-react'

interface ProgressData {
  type:
    | 'progress'
    | 'outline'
    | 'section'
    | 'audio-progress'
    | 'image-progress'
    | 'error'
    | 'retry'
  message?: string
  content?: string
  sectionNumber?: number
  chunkIndex?: number
  totalChunks?: number
  outputPath?: string
  errorType?: '503' | '429' | 'general'
  retryAttempt?: number
  maxRetries?: number
}

interface ScriptGeneratorProps {
  onOpenSettings: () => void
}

interface SettingsData {
  apiTokens: string[]
  scriptPromptTemplate: string
  imagePromptTemplate: string
  audioOutputPath: string
  imageOutputPath: string
}

interface ProgressState {
  currentMessage: string
  outline: string
  sections: Array<{ number: number; content: string }>
  currentSection: number
  audioProgress: { current: number; total: number; message: string }
  imageProgress: { current: number; total: number; message: string }
}

interface LoadingState {
  isGeneratingScript: boolean
  isGeneratingImages: boolean
  isGeneratingAudio: boolean
}

interface NotificationState {
  show: boolean
  type: 'info' | 'warning' | 'error'
  message: string
}

const ScriptGenerator: React.FC<ScriptGeneratorProps> = ({
  onOpenSettings,
}) => {
  const [topic, setTopic] = useState('')
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isGeneratingScript: false,
    isGeneratingImages: false,
    isGeneratingAudio: false,
  })
  const [audioFiles, setAudioFiles] = useState<string[]>([])
  const [imageFiles, setImageFiles] = useState<string[]>([])
  const [progressState, setProgressState] = useState<ProgressState>({
    currentMessage: '',
    outline: '',
    sections: [],
    currentSection: 0,
    audioProgress: { current: 0, total: 0, message: '' },
    imageProgress: { current: 0, total: 0, message: '' },
  })
  const [notification, setNotification] = useState<NotificationState>({
    show: false,
    type: 'info',
    message: '',
  })

  // Auto-hide notification after 5 seconds
  useEffect(() => {
    if (notification.show) {
      const timer = setTimeout(() => {
        setNotification((prev) => ({ ...prev, show: false }))
      }, 5000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [notification.show])

  useEffect(() => {
    // Listen for progress events from the main process
    const handleProgress = (_event: unknown, data: ProgressData): void => {
      switch (data.type) {
        case 'progress':
          setProgressState((prev) => ({
            ...prev,
            currentMessage: data.message || '',
          }))
          break
        case 'outline':
          setProgressState((prev) => ({ ...prev, outline: data.content || '' }))
          break
        case 'section':
          setProgressState((prev) => ({
            ...prev,
            sections: [
              ...prev.sections,
              { number: data.sectionNumber || 0, content: data.content || '' },
            ],
            currentSection: data.sectionNumber || 0,
          }))
          break
        case 'audio-progress':
          setProgressState((prev) => ({
            ...prev,
            audioProgress: {
              current: data.chunkIndex || 0,
              total: data.totalChunks || 0,
              message: data.message || '',
            },
          }))
          break
        case 'image-progress':
          setProgressState((prev) => ({
            ...prev,
            imageProgress: {
              current: data.chunkIndex || 0,
              total: data.totalChunks || 0,
              message: data.message || '',
            },
          }))
          break
        case 'error':
          if (data.errorType === '503') {
            setNotification({
              show: true,
              type: 'warning',
              message:
                'Google AI service is overloaded. The system will automatically retry...',
            })
          } else if (data.errorType === '429') {
            setNotification({
              show: true,
              type: 'warning',
              message:
                'Rate limit reached. The system will automatically retry...',
            })
          }
          break
        case 'retry':
          if (data.retryAttempt && data.maxRetries) {
            setNotification({
              show: true,
              type: 'info',
              message: `Retrying... (${data.retryAttempt}/${data.maxRetries})`,
            })
          }
          break
      }
    }

    window.electron.ipcRenderer.on('script-progress', handleProgress)
    window.electron.ipcRenderer.on('audio-progress', handleProgress)
    window.electron.ipcRenderer.on('image-progress', handleProgress)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('script-progress')
      window.electron.ipcRenderer.removeAllListeners('audio-progress')
      window.electron.ipcRenderer.removeAllListeners('image-progress')
    }
  }, [])

  // Centralized function to refresh file displays
  const refreshFiles = React.useCallback(async (): Promise<void> => {
    const settings = getSettings()

    // Check for audio files
    if (settings.audioOutputPath) {
      try {
        const audioPaths = await window.electron.ipcRenderer.invoke(
          'check-audio-file',
          settings.audioOutputPath,
        )
        setAudioFiles(audioPaths)
      } catch (error) {
        console.log('No audio file found or error checking:', error)
        setAudioFiles([])
      }
    }

    // Check for image files
    if (settings.imageOutputPath) {
      try {
        const imagePaths = await window.electron.ipcRenderer.invoke(
          'check-image-files',
          settings.imageOutputPath,
        )
        setImageFiles(imagePaths)
      } catch (error) {
        console.log('No image files found or error checking:', error)
        setImageFiles([])
      }
    }
  }, [])

  // Check for existing files on component mount
  useEffect(() => {
    refreshFiles()
  }, [refreshFiles])

  const getSettings = (): SettingsData => {
    const savedSettings = localStorage.getItem('youtube-tool-settings')
    if (savedSettings) {
      try {
        return JSON.parse(savedSettings)
      } catch (error) {
        console.error('Error loading settings:', error)
      }
    }
    return {
      apiTokens: [],
      scriptPromptTemplate: '',
      imagePromptTemplate: '',
      audioOutputPath: '',
      imageOutputPath: '',
    }
  }

  const handleGenerate = async (): Promise<void> => {
    if (!topic.trim()) {
      alert('Please enter a topic')
      return
    }

    const settings = getSettings()
    if (settings.apiTokens.length === 0) {
      alert('Please set your API token in settings')
      onOpenSettings()
      return
    }

    // Reset all states
    setLoadingState({
      isGeneratingScript: true,
      isGeneratingImages: false,
      isGeneratingAudio: false,
    })
    setProgressState({
      currentMessage: 'Starting script generation...',
      outline: '',
      sections: [],
      currentSection: 0,
      audioProgress: { current: 0, total: 0, message: '' },
      imageProgress: { current: 0, total: 0, message: '' },
    })
    setAudioFiles([])
    setImageFiles([])

    try {
      // Step 1: Generate Script
      setProgressState((prev) => ({
        ...prev,
        currentMessage: 'Generating script content...',
      }))

      const prompt = settings.scriptPromptTemplate.replace(/\[TOPIC\]/g, topic)
      console.log(settings)
      const script = await window.electron.ipcRenderer.invoke(
        'generate-script',
        {
          prompt,
          apiKey: settings.apiTokens[0],
          outputPath: settings.audioOutputPath,
        },
      )

      // const splitScripts = script.split('\n\n\n')

      // setProgressState((prev) => ({
      //   ...prev,
      //   currentMessage:
      //     'Script generation completed! Starting image generation...',
      // }))

      // // Step 2: Generate Images sequentially
      // setLoadingState({
      //   isGeneratingScript: false,
      //   isGeneratingImages: true,
      //   isGeneratingAudio: false,
      // })

      // for (let i = 0; i < splitScripts.length; i++) {
      //   const section = splitScripts[i]
      //   const cleanedSection = section
      //     .replace(/^Section\s+\d+\s*\n?/i, '')
      //     .trim()

      //   setProgressState((prev) => ({
      //     ...prev,
      //     currentMessage: `Generating images for section ${i + 1}/${splitScripts.length}...`,
      //     imageProgress: {
      //       current: i,
      //       total: splitScripts.length,
      //       message: `Processing section ${i + 1}/${splitScripts.length}`,
      //     },
      //   }))

      //   await generateImage(cleanedSection, i + 1, splitScripts.length)
      //   // Final refresh to ensure all files are displayed
      //   await refreshFiles()
      // }

      // setProgressState((prev) => ({
      //   ...prev,
      //   currentMessage:
      //     'Image generation completed! Starting audio generation...',
      // }))

      // // Step 3: Generate Audio sequentially
      // setLoadingState({
      //   isGeneratingScript: false,
      //   isGeneratingImages: false,
      //   isGeneratingAudio: true,
      // })

      // for (let i = 0; i < splitScripts.length; i++) {
      //   const section = splitScripts[i]
      //   const cleanedSection = section
      //     .replace(/^Section\s+\d+\s*\n?/i, '')
      //     .trim()

      //   setProgressState((prev) => ({
      //     ...prev,
      //     currentMessage: `Generating audio for section ${i + 1}/${splitScripts.length}...`,
      //     audioProgress: {
      //       current: i,
      //       total: splitScripts.length,
      //       message: `Processing section ${i + 1}/${splitScripts.length}`,
      //     },
      //   }))

      //   await generateAudio(cleanedSection, i + 1, splitScripts.length)
      //   // Final refresh to ensure all files are displayed
      //   await refreshFiles()
      // }

      // setProgressState((prev) => ({
      //   ...prev,
      //   currentMessage: 'All content generation completed successfully!',
      // }))
    } catch (error) {
      console.error('Content generation error:', error)

      // Handle specific error types
      const apiError = error as { status?: number; message?: string }
      let errorMessage = 'Unknown error'

      if (apiError.status === 503) {
        errorMessage =
          'Google AI service is currently overloaded. Please try again in a few minutes.'
      } else if (apiError.status === 429) {
        errorMessage =
          'Rate limit exceeded. Please wait a moment and try again.'
      } else if (error instanceof Error) {
        errorMessage = error.message
      }

      alert(`Error generating content: ${errorMessage}`)
      setProgressState((prev) => ({
        ...prev,
        currentMessage: `Error: ${errorMessage}`,
      }))
    } finally {
      setLoadingState({
        isGeneratingScript: false,
        isGeneratingImages: false,
        isGeneratingAudio: false,
      })
    }
  }

  const generateAudio = async (
    content: string,
    sectionIndex?: number,
    totalSections?: number,
  ): Promise<void> => {
    const settings = getSettings()
    if (settings.apiTokens.length === 0) {
      alert('Please set your API token in settings')
      onOpenSettings()
      return
    }

    try {
      await window.electron.ipcRenderer.invoke('generate-audio', {
        content,
        sectionIndex,
        apiKey: settings.apiTokens[0],
        outputDir: settings.audioOutputPath,
      })

      // Refresh audio files display after successful generation
      await refreshFiles()

      // Update completion progress
      if (sectionIndex && totalSections) {
        setProgressState((prev) => ({
          ...prev,
          audioProgress: {
            current: sectionIndex,
            total: totalSections,
            message: `Audio section ${sectionIndex}/${totalSections} completed`,
          },
        }))
      }
    } catch (error) {
      console.error('Audio generation error:', error)

      // Handle specific error types for audio generation
      const apiError = error as { status?: number; message?: string }
      let errorMessage = 'Unknown error'

      if (apiError.status === 503) {
        errorMessage =
          'Audio service is overloaded. The system will automatically retry.'
      } else if (apiError.status === 429) {
        errorMessage =
          'Audio rate limit exceeded. The system will automatically retry.'
      } else if (error instanceof Error) {
        errorMessage = error.message
      }

      console.warn(`Audio generation warning: ${errorMessage}`)
      // Don't show alert for audio errors, just log them
    }
  }

  const generateImage = async (
    content: string,
    sectionIndex?: number,
    totalSections?: number,
  ): Promise<void> => {
    const settings = getSettings()
    if (settings.apiTokens.length === 0) {
      alert('Please set your API token in settings')
      onOpenSettings()
      return
    }

    if (!settings.imagePromptTemplate) {
      alert('Please set your image prompt template in settings')
      onOpenSettings()
      return
    }

    try {
      const prompt = settings.imagePromptTemplate.replace(
        /\[Replace Script\]/g,
        content.trim(),
      )
      await window.electron.ipcRenderer.invoke('generate-image', {
        prompt,
        sectionIndex,
        apiKey:
          settings.apiTokens.length > 1
            ? settings.apiTokens[1]
            : settings.apiTokens[0],
        outputPath: settings.imageOutputPath,
      })

      // Refresh image files display after successful generation
      await refreshFiles()

      // Update completion progress
      if (sectionIndex && totalSections) {
        setProgressState((prev) => ({
          ...prev,
          imageProgress: {
            current: sectionIndex,
            total: totalSections,
            message: `Images for section ${sectionIndex}/${totalSections} completed`,
          },
        }))
      }
    } catch (error) {
      console.error('Image generation error:', error)

      // Handle specific error types for image generation
      const apiError = error as { status?: number; message?: string }
      let errorMessage = 'Unknown error'

      if (apiError.status === 503) {
        errorMessage =
          'Image service is overloaded. The system will automatically retry.'
      } else if (apiError.status === 429) {
        errorMessage =
          'Image rate limit exceeded. The system will automatically retry.'
      } else if (error instanceof Error) {
        errorMessage = error.message
      }

      console.warn(`Image generation warning: ${errorMessage}`)
      // Don't show alert for image errors, just log them
    }
  }

  // Helper function to check if any generation is in progress
  const isAnyGenerating =
    loadingState.isGeneratingScript ||
    loadingState.isGeneratingImages ||
    loadingState.isGeneratingAudio

  return (
    <div className="flex flex-col h-screen w-screen p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl text-blue-600 font-bold">
          YouTube Content Generator
        </h1>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5" />
          Settings
        </button>
      </div>

      {/* Input Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-center gap-2.5">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter your video topic..."
            disabled={isAnyGenerating}
          />

          <button
            onClick={handleGenerate}
            disabled={isAnyGenerating || !topic.trim()}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {isAnyGenerating && <Loader2 className="w-5 h-5 animate-spin" />}
            {isAnyGenerating ? 'Generating...' : 'Generate Elements'}
          </button>
        </div>
      </div>

      {/* Output Section */}
      <div className="bg-white flex flex-col rounded-lg shadow-md p-6 flex-1 overflow-hidden">
        {/* Notification */}
        {notification.show && (
          <div
            className={`mb-4 p-3 rounded-lg border ${
              notification.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : notification.type === 'warning'
                  ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="text-sm">{notification.message}</span>
            </div>
          </div>
        )}

        {/* Progress Display */}
        {isAnyGenerating && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span className="font-medium text-blue-800">
                {loadingState.isGeneratingScript && 'Generating Script'}
                {loadingState.isGeneratingImages && 'Generating Images'}
                {loadingState.isGeneratingAudio && 'Generating Audio'}
              </span>
            </div>
            {progressState.currentMessage && (
              <p className="text-sm text-blue-600 mb-3">
                {progressState.currentMessage}
              </p>
            )}
            {progressState.outline && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-green-700">
                    Outline Generated
                  </span>
                </div>
              </div>
            )}
            {progressState.sections.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium text-blue-700">
                    Sections Generated: {progressState.sections.length}/15
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${(progressState.sections.length / 15) * 100}%`,
                    }}
                  ></div>
                </div>
              </div>
            )}
            {/* Image Generation Progress */}
            {loadingState.isGeneratingImages &&
              progressState.imageProgress.total > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-green-500" />
                    <span className="text-sm font-medium text-green-700">
                      Images: {progressState.imageProgress.current}/
                      {progressState.imageProgress.total}
                    </span>
                  </div>
                  {progressState.imageProgress.message && (
                    <p className="text-xs text-green-600 mb-2">
                      {progressState.imageProgress.message}
                    </p>
                  )}
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(progressState.imageProgress.current / progressState.imageProgress.total) * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>
              )}
            {/* Audio Generation Progress */}
            {loadingState.isGeneratingAudio &&
              progressState.audioProgress.total > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-purple-500" />
                    <span className="text-sm font-medium text-purple-700">
                      Audio: {progressState.audioProgress.current}/
                      {progressState.audioProgress.total}
                    </span>
                  </div>
                  {progressState.audioProgress.message && (
                    <p className="text-xs text-purple-600 mb-2">
                      {progressState.audioProgress.message}
                    </p>
                  )}
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(progressState.audioProgress.current / progressState.audioProgress.total) * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>
              )}
          </div>
        )}

        <div className="flex gap-3 overflow-hidden h-full">
          {/* Audio File Display */}
          <div className="w-1/3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-800">
                Generated Audio
              </h3>
              <button
                onClick={refreshFiles}
                className="text-sm text-blue-600 hover:underline"
              >
                Refresh Audio
              </button>
            </div>

            {audioFiles.length === 0 && (
              <p className="text-gray-500">No audio files generated yet.</p>
            )}

            {audioFiles.length > 0 && (
              <div className="flex-1 grid grid-cols-1 gap-3 overflow-y-auto">
                {audioFiles.map((audioFile) => (
                  <audio controls className="w-full max-w-md" key={audioFile}>
                    <source src={audioFile} type="audio/mpeg" />
                    Your browser does not support the audio tag.
                  </audio>
                ))}
              </div>
            )}

            {loadingState.isGeneratingAudio && (
              <div className="text-center text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                <p>Generating audio files...</p>
              </div>
            )}
          </div>

          {/* Image File Display */}
          <div className="flex flex-col flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-800">
                Generated Images
              </h3>
              <button
                onClick={refreshFiles}
                className="text-sm text-blue-600 hover:underline"
              >
                Refresh Images
              </button>
            </div>

            {imageFiles.length === 0 && (
              <p className="text-gray-500">No images generated yet.</p>
            )}

            {imageFiles.length > 0 && (
              <div className="flex-1 grid grid-cols-3 gap-3 overflow-y-auto">
                {imageFiles.map((imageFile) => (
                  <img
                    src={imageFile}
                    alt="Generated"
                    className="w-full aspect-[16/9] object-cover rounded-lg shadow-md"
                    key={imageFile}
                  />
                ))}
              </div>
            )}

            {loadingState.isGeneratingImages && (
              <div className="text-center text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                <p>Generating images...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScriptGenerator
