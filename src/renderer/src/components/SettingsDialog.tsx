import React, { useState, useEffect } from 'react'
import { X, Save, Folder } from 'lucide-react'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface SettingsData {
  apiTokens: string[]
  scriptPromptTemplate: string
  imagePromptTemplate: string
  audioOutputPath: string
  imageOutputPath: string
}

type TabType = 'apiToken' | 'scriptTemplate' | 'imageTemplate' | 'outputPaths'

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('apiToken')
  const [settings, setSettings] = useState<SettingsData>({
    apiTokens: [],
    scriptPromptTemplate: '',
    imagePromptTemplate: '',
    audioOutputPath: '',
    imageOutputPath: '',
  })

  // Load settings from localStorage on component mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('youtube-tool-settings')
    if (savedSettings) {
      try {
        const parsedSettings = JSON.parse(savedSettings)
        setSettings(parsedSettings)
      } catch (error) {
        console.error('Error loading settings:', error)
      }
    } else {
      // Set default templates if no settings exist
      setSettings((prev) => ({
        ...prev,
        scriptPromptTemplate: '',
        imagePromptTemplate: '',
        audioOutputPath: '',
        imageOutputPath: '',
      }))
    }
  }, [])

  const handleInputChange = (
    field: keyof SettingsData,
    value: string,
  ): void => {
    setSettings((prev) => ({
      ...prev,
      [field]: field === 'apiTokens' ? value.split('\n') : value,
    }))
  }

  const handleSave = (): void => {
    try {
      localStorage.setItem('youtube-tool-settings', JSON.stringify(settings))
      onClose()
    } catch (error) {
      console.error('Error saving settings:', error)
    }
  }

  const handleClose = (): void => {
    // Reload settings from localStorage when closing without saving
    const savedSettings = localStorage.getItem('youtube-tool-settings')
    if (savedSettings) {
      try {
        const parsedSettings = JSON.parse(savedSettings)
        setSettings(parsedSettings)
      } catch (error) {
        console.error('Error loading settings:', error)
      }
    }
    onClose()
  }

  const handleSelectFolder = async (
    field: 'audioOutputPath' | 'imageOutputPath',
  ): Promise<void> => {
    try {
      const selectedPath = await window.api.selectFolder()
      if (selectedPath) {
        handleInputChange(field, selectedPath)
      }
    } catch (error) {
      console.error('Error selecting folder:', error)
    }
  }

  if (!isOpen) return null

  const tabs = [
    { id: 'apiToken' as TabType, label: 'API Token' },
    { id: 'scriptTemplate' as TabType, label: 'Script Template' },
    { id: 'imageTemplate' as TabType, label: 'Image Template' },
    { id: 'outputPaths' as TabType, label: 'Output Paths' },
  ]

  const renderTabContent = (): React.JSX.Element | null => {
    switch (activeTab) {
      case 'apiToken':
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI API Token
            </label>
            <textarea
              value={
                settings.apiTokens && settings.apiTokens.length > 0
                  ? settings.apiTokens.join('\n')
                  : ''
              }
              onChange={(e) => handleInputChange('apiTokens', e.target.value)}
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
              placeholder="Enter your AI API token...

You can enter multiple tokens on separate lines if needed."
            />
            <p className="text-xs text-gray-500 mt-1">
              This token will be used to authenticate with AI services
            </p>
          </div>
        )

      case 'scriptTemplate':
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Script Prompt Template
            </label>
            <textarea
              value={settings.scriptPromptTemplate}
              onChange={(e) =>
                handleInputChange('scriptPromptTemplate', e.target.value)
              }
              rows={14}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
              placeholder="Enter your script generation prompt template...

Example:
Create a YouTube script about {topic}.
Make it engaging and informative.
Target audience: {audience}
Duration: {duration} minutes"
            />
          </div>
        )

      case 'imageTemplate':
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Image Prompt Template
            </label>
            <textarea
              value={settings.imagePromptTemplate}
              onChange={(e) =>
                handleInputChange('imagePromptTemplate', e.target.value)
              }
              rows={14}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
              placeholder="Enter your image generation prompt template...

Example:
Create a thumbnail image for a YouTube video about {topic}.
Style: modern, eye-catching, high contrast
Include text overlay with: {title}"
            />
          </div>
        )

      case 'outputPaths':
        return (
          <div className="space-y-6">
            {/* Audio Output Path */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Audio Output Path
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.audioOutputPath}
                  onChange={(e) =>
                    handleInputChange('audioOutputPath', e.target.value)
                  }
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter the path where audio files will be saved..."
                />
                <button
                  type="button"
                  onClick={() => handleSelectFolder('audioOutputPath')}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <Folder className="w-4 h-4" />
                  Browse
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Specify the directory where generated audio files will be saved
              </p>
            </div>

            {/* Image Output Path */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Image Output Path
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.imageOutputPath}
                  onChange={(e) =>
                    handleInputChange('imageOutputPath', e.target.value)
                  }
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter the path where image files will be saved..."
                />
                <button
                  type="button"
                  onClick={() => handleSelectFolder('imageOutputPath')}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200 transition-colors"
                >
                  <Folder className="w-4 h-4" />
                  Browse
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Specify the directory where generated images will be saved
              </p>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-800">Settings</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="border-b">
          <nav className="flex space-x-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">{renderTabContent()}</div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog
