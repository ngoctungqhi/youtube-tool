import { GoogleGenAI, PersonGeneration } from '@google/genai'
import * as fs from 'fs'
import { writeFile } from 'fs/promises'
import * as path from 'path'

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
  apiKey: string,
  outputPath: string = 'images',
  progressCallback?: (current: number, total: number, message: string) => void,
): Promise<string[]> => {
  try {
    // Step 1: Generate image prompts
    const imagePrompts = await GenerateImagePrompts(prompt, apiKey)

    // Step 2: Generate images from prompts
    const ai = new GoogleGenAI({
      apiKey,
    })

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
        const result = await ai.models.generateImages({
          model: 'models/imagen-3.0-generate-002',
          prompt: imagePrompt,
          config: {
            numberOfImages: 4,
            outputMimeType: 'image/jpeg',
            aspectRatio: '16:9',
            personGeneration: PersonGeneration.ALLOW_ADULT,
          },
        })

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
          const fileName = `prompt_${promptIndex}_image_${imgIndex}.jpg`
          const filePath = path.join(outputPath, fileName)

          // Convert image bytes to Buffer and save to file
          const imageBytes = generatedImage.image.imageBytes
          const buffer = Buffer.from(imageBytes, 'base64')
          await writeFile(filePath, buffer)

          savedImagePaths.push(filePath)
          console.log(
            `Image saved as ${filePath} (Prompt ${promptIndex}, Image ${imgIndex + 1})`,
          )
        }
      } catch (imageError) {
        console.error(
          `Error generating image for prompt "${imagePrompt}":`,
          imageError,
        )
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
