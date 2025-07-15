import { GoogleGenAI, PersonGeneration } from '@google/genai'
import * as fs from 'fs'
import { writeFile } from 'fs/promises'
import * as path from 'path'

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
        const retryDelay = Math.min(baseDelay * Math.pow(2, attempt), 60000) // Cap at 60 seconds
        console.log(
          `Service overloaded (attempt ${attempt + 1}/${maxRetries + 1}). Waiting ${
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
          `Rate limit hit (attempt ${attempt + 1}/${maxRetries + 1}). Waiting ${
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

export const GenerateImagePrompts = async (
  prompt: string,
  apiKey: string,
): Promise<string[]> => {
  try {
    const ai = new GoogleGenAI({
      apiKey,
    })

    const config = {
      responseMimeType: 'text/plain',
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      config,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    })

    if (!response.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('No image prompts generated.')
    }

    const generatedText = response.candidates[0].content.parts[0].text

    // Split the response into individual prompts (assuming they're separated by newlines)
    const prompts = generatedText
      .split('\n')
      .map((prompt) => prompt.trim())
      .filter((prompt) => prompt.length > 0)

    return prompts
  } catch (error) {
    console.error('Error generating image prompts:', error)
    throw error
  }
}

export const GenerateImage = async (
  prompt: string,
  sectionIndex: number,
  apiKey: string,
  outputPath: string = 'images',
  progressCallback?: (current: number, total: number, message: string) => void,
): Promise<string[]> => {
  try {
    // Step 1: Generate image prompts
    const imagePrompts = await GenerateImagePrompts(prompt, apiKey)

    // Step 2: Generate images from prompts with rate limiting
    const ai = new GoogleGenAI({
      apiKey,
    })

    // Initialize rate limiter for image generation
    const rateLimiter = new RateLimiter(15, 60000) // 15 requests per minute

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true })
    }
    const savedImagePaths: string[] = []

    progressCallback?.(0, imagePrompts.length, 'Starting image generation...')

    for (
      let promptIndex = 0;
      promptIndex < imagePrompts.length;
      promptIndex++
    ) {
      const imagePrompt = imagePrompts[promptIndex]

      progressCallback?.(
        promptIndex,
        imagePrompts.length,
        `Generating images for prompt ${promptIndex + 1}/${imagePrompts.length}`,
      )

      try {
        // Wait for rate limit before making request
        await rateLimiter.waitIfNeeded()

        // Use retry logic for image generation
        const result = await retryWithBackoff(
          async () => {
            return await ai.models.generateImages({
              model: 'models/imagen-3.0-generate-002',
              prompt: imagePrompt,
              config: {
                numberOfImages: 1, // Reduced to 1 to minimize API load
                outputMimeType: 'image/jpeg',
                aspectRatio: '16:9',
                personGeneration: PersonGeneration.ALLOW_ADULT,
              },
            })
          },
          5, // Increased retries
          2000, // Increased base delay
        )

        if (!result.generatedImages || result.generatedImages.length === 0) {
          console.log(`No images generated for prompt ${promptIndex}`)
          continue
        }

        for (
          let imgIndex = 0;
          imgIndex < result.generatedImages.length;
          imgIndex++
        ) {
          const generatedImage = result.generatedImages[imgIndex]
          if (
            !generatedImage ||
            !generatedImage.image ||
            !generatedImage.image.imageBytes
          ) {
            console.log(
              `No valid image data for prompt ${promptIndex}, image ${imgIndex + 1}`,
            )
            continue
          }

          // Generate filename with prompt index and image index
          const fileName = `section_${sectionIndex}_prompt_${promptIndex}_image_${imgIndex}.jpg`
          const filePath = path.join(outputPath, fileName)

          // Convert image bytes to Buffer and save to file
          const imageBytes = generatedImage.image.imageBytes
          const buffer = Buffer.from(imageBytes, 'base64')
          await writeFile(filePath, buffer)

          savedImagePaths.push(filePath)
          console.log(
            `Image saved as ${filePath} (Prompt ${promptIndex}, Image ${imgIndex + 1})`,
          )
        } // Add longer delay between successful requests when service might be overloaded
        await new Promise((resolve) => setTimeout(resolve, 3000))
      } catch (imageError) {
        const apiError = imageError as { status?: number }
        console.error(
          `Error generating image for prompt "${imagePrompt}":`,
          imageError,
        )

        // If it's a 503 error, wait longer before continuing
        if (apiError.status === 503) {
          console.log(
            'Service overloaded, waiting 60 seconds before continuing...',
          )
          await new Promise((resolve) => setTimeout(resolve, 60000))
        }

        // Continue with other prompts even if one fails
      }
    }

    if (savedImagePaths.length === 0) {
      throw new Error('No images were successfully generated.')
    }

    progressCallback?.(
      imagePrompts.length,
      imagePrompts.length,
      'Image generation completed!',
    )

    return savedImagePaths
  } catch (error) {
    console.error('Error in GenerateImage:', error)
    throw error
  }
}
