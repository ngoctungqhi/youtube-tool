import { GoogleGenAI } from '@google/genai'
import * as fs from 'fs'
import * as path from 'path'

interface GenerationProgress {
  onProgress?: (message: string) => void
  onOutlineGenerated?: (outline: string) => void
  onSectionGenerated?: (sectionNumber: number, content: string) => void
}

export const GenerateScript = async (
  prompt: string,
  apiKey: string,
  outputPath: string,
  callbacks?: GenerationProgress,
): Promise<string> => {
  try {
    const ai = new GoogleGenAI({
      apiKey,
    })

    const tools = [
      {
        googleSearch: {},
      },
    ]

    const config = {
      thinkingConfig: {
        thinkingBudget: -1,
      },
      tools,
      responseMimeType: 'text/plain',
    }

    const outlineResponse = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      config,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
    })

    if (!outlineResponse.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('No outline generated.')
    }

    const outline = outlineResponse.candidates[0].content.parts[0].text.trim()

    callbacks?.onOutlineGenerated?.(outline)

    // Save outline to file
    const scriptFilePath = path.join(outputPath, 'script.txt')
    fs.writeFileSync(
      scriptFilePath,
      `OUTLINE:\n${outline}\n\n--- SCRIPT ---\n\n`,
      'utf8',
    )

    // Initialize conversation history and script
    const conversationHistory = [
      {
        role: 'user' as const,
        parts: [{ text: prompt }],
      },
      {
        role: 'model' as const,
        parts: [{ text: outline }],
      },
    ]

    let fullScript = ''
    let sectionCount = 1

    // Step 2: Auto-generate all 15 sections
    while (sectionCount <= 15) {
      // Add CONTINUE to conversation
      conversationHistory.push({
        role: 'user',
        parts: [{ text: 'CONTINUE' }],
      })

      try {
        // Generate the section
        const sectionResponse = await ai.models.generateContent({
          model: 'gemini-2.5-pro',
          config: {
            ...config,
            thinkingConfig: {
              thinkingBudget: -1,
            },
          },
          contents: conversationHistory,
        })

        if (sectionResponse.candidates?.[0]?.content?.parts?.[0]?.text) {
          const sectionContent =
            sectionResponse.candidates[0].content.parts[0].text.trim()

          // Add to full script and conversation history
          fullScript += sectionContent + '\n\n\n'
          conversationHistory.push({
            role: 'model',
            parts: [{ text: sectionContent }],
          })

          // Append section to file
          fs.appendFileSync(scriptFilePath, sectionContent + '\n\n\n', 'utf8')

          callbacks?.onSectionGenerated?.(sectionCount, sectionContent)
          sectionCount++

          // Brief pause to show progress
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } else {
          console.log(`Failed to generate Section ${sectionCount}. Retrying...`)
          callbacks?.onProgress?.(
            `Failed to generate Section ${sectionCount}. Retrying...`,
          )

          // Remove the failed CONTINUE from history and try again
          conversationHistory.pop()
          continue
        }
      } catch (error) {
        const apiError = error as { status?: number; message?: string }
        console.error(`Error generating Section ${sectionCount}:`, error)

        // Check if it's a 503 service unavailable error
        if (apiError.status === 503) {
          callbacks?.onProgress?.(
            `Service overloaded for Section ${sectionCount}. Waiting 30 seconds before retry...`,
          )
          // Wait longer for 503 errors (30 seconds)
          await new Promise((resolve) => setTimeout(resolve, 30000))
        } else {
          callbacks?.onProgress?.(
            `Error generating Section ${sectionCount}. Retrying in 5 seconds...`,
          )
          // Wait 5 seconds for other errors
          await new Promise((resolve) => setTimeout(resolve, 5000))
        }

        // Remove the failed CONTINUE from history and try again
        conversationHistory.pop()
        continue
      }
    }

    // Save the complete script to file
    try {
      callbacks?.onProgress?.(
        `Script saved to ${scriptFilePath} with ${sectionCount - 1} sections completed.`,
      )
      return fullScript.trim()
    } catch (error) {
      console.warn('Could not save script to file:', error)
    }

    return fullScript.trim()
  } catch (error) {
    console.error('Error in automated script generation:', error)
    callbacks?.onProgress?.(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
    throw new Error(
      `Script generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }
}
