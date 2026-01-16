import OpenAI from "openai"

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini"

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing")
  }
  return new OpenAI({ apiKey })
}

export type StoryGenerationResult = {
  text: string
  model: string
  usage: {
    promptTokens?: number
    completionTokens?: number
    totalTokens: number
    inputTokens?: number
    outputTokens?: number
  }
  requestId?: string
  responseId?: string
}

export async function generateStoryText(prompt: string): Promise<StoryGenerationResult> {
  const client = getOpenAIClient()
  const model = DEFAULT_MODEL
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You generate bedtime stories." },
      { role: "user", content: prompt },
    ],
  })

  const text = response.choices[0]?.message?.content?.trim() || ""
  const usage = response.usage

  return {
    text,
    model,
    usage: {
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens ?? 0,
      inputTokens: usage?.prompt_tokens, // For compatibility with input_tokens naming
      outputTokens: usage?.completion_tokens, // For compatibility with output_tokens naming
    },
    requestId: response.id,
    responseId: response.id,
  }
}

export type StoryMeta = {
  title: string
  summary: string
  setting: string
  conflict: string
  tone: "nyugodt" | "vidam" | "kalandos"
}

export type StoryMetaResult = {
  meta: StoryMeta
  model: string
  usage: {
    promptTokens?: number
    completionTokens?: number
    totalTokens: number
    inputTokens?: number
    outputTokens?: number
  }
  requestId?: string
  responseId?: string
}

export async function extractStoryMeta(storyText: string): Promise<StoryMetaResult> {
  const client = getOpenAIClient()
  const model = DEFAULT_MODEL
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: "Extract structured metadata in Hungarian.",
      },
      {
        role: "user",
        content: `
Extract JSON with:
title (max 6 words),
summary (1 sentence),
setting (1-4 words),
conflict (1-6 words),
tone (nyugodt|vidam|kalandos).

Story:
${storyText}
        `.trim(),
      },
    ],
    response_format: { type: "json_object" },
  })

  const raw = response.choices[0]?.message?.content || "{}"
  const usage = response.usage
  
  try {
    const parsed = JSON.parse(raw) as Partial<StoryMeta>
    // Validate required fields
    if (!parsed.title || !parsed.summary || !parsed.setting || !parsed.conflict || !parsed.tone) {
      throw new Error("Story metadata missing required fields")
    }
    // Validate tone enum
    if (!["nyugodt", "vidam", "kalandos"].includes(parsed.tone)) {
      throw new Error(`Invalid tone: ${parsed.tone}`)
    }
    return {
      meta: {
        title: parsed.title,
        summary: parsed.summary,
        setting: parsed.setting,
        conflict: parsed.conflict,
        tone: parsed.tone as "nyugodt" | "vidam" | "kalandos",
      },
      model,
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens ?? 0,
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
      },
      requestId: response.id,
      responseId: response.id,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse story metadata: ${error.message}`)
    }
    throw new Error("Failed to parse story metadata")
  }
}

