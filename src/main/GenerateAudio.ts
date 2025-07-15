import { GoogleGenAI } from '@google/genai'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'

// Rate limiting utility
class RateLimiter {
  private requests: number[] = []
  private readonly maxRequests: number
  private readonly windowMs: number

  constructor(maxRequests: number = 15, windowMs: number = 60000) {
    // 15 requests per minute to be safe
    this.maxRequests = maxRequests
    this.windowMs = windowMs
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now()

    // Remove requests older than the window
    this.requests = this.requests.filter(
      (timestamp) => now - timestamp < this.windowMs,
    )

    if (this.requests.length >= this.maxRequests) {
      // Calculate how long to wait
      const oldestRequest = Math.min(...this.requests)
      const waitTime = this.windowMs - (now - oldestRequest) + 1000 // Add 1 second buffer

      if (waitTime > 0) {
        console.log(
          `Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)} seconds...`,
        )
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
    }

    this.requests.push(now)
  }
}

// Retry utility with exponential backoff
const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 2000,
): Promise<T> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      const apiError = error as { status?: number; details?: unknown[] }

      // Handle 503 service overloaded errors with longer waits
      if (apiError.status === 503 && attempt < maxRetries) {
        const retryDelay = Math.min(baseDelay * Math.pow(2, attempt), 120000) // Cap at 2 minutes
        console.log(
          `Audio service overloaded (attempt ${attempt + 1}/${maxRetries + 1}). Waiting ${
            retryDelay / 1000
          } seconds...`,
        )
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        continue
      }

      if (apiError.status === 429 && attempt < maxRetries) {
        // Extract retry delay from error if available
        let retryDelay = baseDelay * Math.pow(2, attempt)

        if (apiError.details) {
          const retryInfo = apiError.details.find(
            (detail: unknown) =>
              (detail as { '@type'?: string })['@type'] ===
              'type.googleapis.com/google.rpc.RetryInfo',
          ) as { retryDelay?: string } | undefined

          if (retryInfo?.retryDelay) {
            // Parse retry delay (format: "56s")
            const delayMatch = retryInfo.retryDelay.match(/(\d+)s/)
            if (delayMatch) {
              retryDelay = parseInt(delayMatch[1]) * 1000
            }
          }
        }

        console.log(
          `Audio rate limit hit (attempt ${attempt + 1}/${maxRetries + 1}). Waiting ${
            retryDelay / 1000
          } seconds...`,
        )
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        continue
      }
      throw error
    }
  }
  throw new Error('Max retries exceeded')
}

interface AudioGenerationCallbacks {
  onProgress?: (message: string) => void
  onChunkGenerated?: (chunkIndex: number, totalChunks: number) => void
  onSectionComplete?: (sectionIndex: number, outputPath: string) => void
}

interface WavConversionOptions {
  numChannels: number
  sampleRate: number
  bitsPerSample: number
}

const saveBinaryFile = async (
  fileName: string,
  content: Buffer,
): Promise<void> => {
  try {
    // Ensure directory exists
    const dir = dirname(fileName)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    await writeFile(fileName, content)
    console.log(`File ${fileName} saved to file system.`)
  } catch (err) {
    console.error(`Error writing file ${fileName}:`, err)
    throw err
  }
}

const splitContentIntoChunks = (
  content: string,
  maxChunkSize: number = 3000,
): string[] => {
  // Split by sentences (periods, exclamation marks, question marks)
  const sentences = content.trim().split(/(?<=[.!?])\s+/)

  const chunks: string[] = []
  let currentChunk = ''

  for (const sentence of sentences) {
    // If adding this sentence would exceed max size, start a new chunk
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
      chunks.push(currentChunk.trim())
      currentChunk = sentence
    } else {
      currentChunk += currentChunk ? ' ' + sentence : sentence
    }
  }

  // Add the last chunk if it's not empty
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

const joinWavFiles = async (
  filePaths: string[],
  outputPath: string,
): Promise<void> => {
  if (filePaths.length === 0) return

  const fs = await import('fs/promises')

  if (filePaths.length === 1) {
    await fs.copyFile(filePaths[0], outputPath)
    return
  }

  // Read all WAV files and extract audio data
  const audioDataChunks: Buffer[] = []
  let totalDataLength = 0
  let wavOptions: WavConversionOptions | null = null

  for (const filePath of filePaths) {
    const fileBuffer = await fs.readFile(filePath)

    // Extract WAV format info from first file
    if (!wavOptions) {
      wavOptions = extractWavFormat(fileBuffer)
    }

    // Extract audio data (skip 44-byte header)
    const audioData = fileBuffer.slice(44)
    audioDataChunks.push(audioData)
    totalDataLength += audioData.length
  }

  if (!wavOptions) {
    throw new Error('Could not extract WAV format information')
  }

  // Create new WAV header for combined audio
  const newHeader = createWavHeader(totalDataLength, wavOptions)
  const combinedAudio = Buffer.concat([newHeader, ...audioDataChunks])

  await fs.writeFile(outputPath, combinedAudio)
  console.log(`Joined audio saved to: ${outputPath}`)
}

const extractWavFormat = (wavBuffer: Buffer): WavConversionOptions => {
  // Read WAV header to extract format information
  const numChannels = wavBuffer.readUInt16LE(22)
  const sampleRate = wavBuffer.readUInt32LE(24)
  const bitsPerSample = wavBuffer.readUInt16LE(34)

  return {
    numChannels,
    sampleRate,
    bitsPerSample,
  }
}

const convertToWav = (rawData: string, mimeType: string): Buffer => {
  const options = parseMimeType(mimeType)
  const buffer = Buffer.from(rawData, 'base64')
  // Use the actual PCM data length, not the base64 string length
  const wavHeader = createWavHeader(buffer.length, options)

  return Buffer.concat([wavHeader, buffer])
}

const parseMimeType = (mimeType: string): WavConversionOptions => {
  const [fileType, ...params] = mimeType.split(';').map((s) => s.trim())
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, format] = fileType.split('/')

  const options: WavConversionOptions = {
    numChannels: 1,
    sampleRate: 24000,
    bitsPerSample: 16,
  }

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10)
    if (!isNaN(bits)) {
      options.bitsPerSample = bits
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map((s) => s.trim())
    if (key === 'rate') {
      const rate = parseInt(value, 10)
      if (!isNaN(rate)) {
        options.sampleRate = rate
      }
    }
  }

  return options
}

const createWavHeader = (
  dataLength: number,
  options: WavConversionOptions,
): Buffer => {
  const { numChannels, sampleRate, bitsPerSample } = options

  // http://soundfile.sapp.org/doc/WaveFormat

  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const buffer = Buffer.alloc(44)

  buffer.write('RIFF', 0) // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4) // ChunkSize
  buffer.write('WAVE', 8) // Format
  buffer.write('fmt ', 12) // Subchunk1ID
  buffer.writeUInt32LE(16, 16) // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22) // NumChannels
  buffer.writeUInt32LE(sampleRate, 24) // SampleRate
  buffer.writeUInt32LE(byteRate, 28) // ByteRate
  buffer.writeUInt16LE(blockAlign, 32) // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34) // BitsPerSample
  buffer.write('data', 36) // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40) // Subchunk2Size

  return buffer
}

const getFileExtension = (mimeType: string): string | null => {
  // Manual mapping for common audio mime types
  const mimeToExt: Record<string, string> = {
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/webm': 'webm',
  }

  return mimeToExt[mimeType.toLowerCase()] || null
}

const generateChunkAudio = async (
  content: string,
  sectionIndex: number,
  chunkIndex: number,
  apiKey: string,
  outputDir: string,
  rateLimiter: RateLimiter,
): Promise<string[]> => {
  const ai = new GoogleGenAI({
    apiKey,
  })
  const config = {
    temperature: 1,
    responseModalities: ['audio'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Enceladus',
        },
      },
    },
  }

  // Use the model name from your working example
  const model = 'gemini-2.5-pro-preview-tts'
  const contents = [
    {
      role: 'user' as const,
      parts: [
        {
          text: content,
        },
      ],
    },
  ]

  const chunkFiles: string[] = []
  let fileIndex = 0

  // Wait for rate limit before making request
  await rateLimiter.waitIfNeeded()

  // Use retry logic for audio generation
  const response = await retryWithBackoff(
    async () => {
      return await ai.models.generateContentStream({
        model,
        config,
        contents,
      })
    },
    5, // Increased retries
    2000, // Increased base delay
  )

  for await (const chunk of response) {
    if (
      !chunk.candidates ||
      !chunk.candidates[0].content ||
      !chunk.candidates[0].content.parts
    ) {
      continue
    }

    if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
      const fileName = `SECTION_${sectionIndex}_CHUNK_${chunkIndex}_${fileIndex}`
      fileIndex++
      const inlineData = chunk.candidates[0].content.parts[0].inlineData
      let dataBuffer: Buffer = Buffer.from(inlineData.data || '', 'base64')
      let fileExtension = getFileExtension(inlineData.mimeType || '')
      if (!fileExtension) {
        fileExtension = 'wav'
        dataBuffer = convertToWav(
          inlineData.data || '',
          inlineData.mimeType || '',
        ) as Buffer
      }

      const filePath = join(outputDir, `${fileName}.${fileExtension}`)
      await saveBinaryFile(filePath, dataBuffer)
      chunkFiles.push(filePath)
    } else {
      console.log(chunk.text)
    }
  }

  // Add longer delay between successful requests to be extra safe for audio
  await new Promise((resolve) => setTimeout(resolve, 3000))

  return chunkFiles
}

export const GenerateAudio = async (
  content: string,
  apiKey: string,
  outputDir: string,
  callbacks?: AudioGenerationCallbacks,
): Promise<void> => {
  try {
    callbacks?.onProgress?.('Starting audio generation...')

    // Initialize rate limiter for audio generation
    const rateLimiter = new RateLimiter(10, 60000) // 10 requests per minute for audio (more conservative)

    // Split content into manageable chunks
    const chunks = splitContentIntoChunks(content)
    callbacks?.onProgress?.(`Split into ${chunks.length} chunks`)

    const allChunkFiles: string[] = []

    // Generate audio for each chunk
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      callbacks?.onProgress?.(
        `Generating audio for chunk ${chunkIndex + 1}/${chunks.length}`,
      )
      callbacks?.onChunkGenerated?.(chunkIndex + 1, chunks.length)

      try {
        const chunkContent = chunks[chunkIndex]
        const chunkFiles = await generateChunkAudio(
          chunkContent,
          0,
          chunkIndex,
          apiKey,
          outputDir,
          rateLimiter,
        )
        allChunkFiles.push(...chunkFiles)
      } catch (chunkError) {
        console.error(
          `Error generating audio for chunk ${chunkIndex}:`,
          chunkError,
        )
        callbacks?.onProgress?.(
          `Warning: Failed to generate audio for chunk ${chunkIndex + 1}. Continuing with remaining chunks...`,
        )
        // Continue with other chunks even if one fails
      }
    }

    // Join all chunk files into a single audio file
    if (allChunkFiles.length > 0) {
      const outputFile = join(outputDir, 'COMPLETE_AUDIO.wav')
      await joinWavFiles(allChunkFiles, outputFile)
      callbacks?.onSectionComplete?.(0, outputFile)

      // Clean up individual chunk files
      const fs = await import('fs/promises')
      for (const chunkFile of allChunkFiles) {
        try {
          await fs.unlink(chunkFile)
          console.log(`Cleaned up: ${chunkFile}`)
        } catch (error) {
          console.warn(`Could not clean up ${chunkFile}:`, error)
        }
      }

      callbacks?.onProgress?.('Audio generation completed successfully!')
    } else {
      throw new Error('No audio chunks were successfully generated.')
    }
  } catch (error) {
    console.error('Error in audio generation:', error)
    callbacks?.onProgress?.(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
    throw error
  }
}
