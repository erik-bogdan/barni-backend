import OpenAI from "openai"
import { getLogger } from "../lib/logger"

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini"

function formatRequestText(systemPrompt: string, userPrompt: string) {
  return `System:\n${systemPrompt}\n\nUser:\n${userPrompt}`
}

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing")
  }
  return new OpenAI({ apiKey })
}

export type StoryGenerationResult = {
  text: string
  requestText: string
  responseText: string
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

export async function generateStoryText(prompt: string): Promise<StoryGenerationResult> {
  const logger = getLogger()
  const client = getOpenAIClient()
  const model = DEFAULT_MODEL
  const operation = "story.generate_text"
  const systemPrompt = "You generate bedtime stories."
  const userPrompt = `
${prompt}

Extract JSON with:
title (max 6 words),
summary (1 sentence),
setting (1-4 words),
conflict (1-6 words),
tone (nyugodt|vidam|kalandos),
text (full story).
  `.trim()
  const requestText = formatRequestText(systemPrompt, userPrompt)
  const start = Date.now()
  let response: Awaited<ReturnType<typeof client.chat.completions.create>>
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    })
  } catch (error) {
    const durationMs = Date.now() - start
    logger.error({ err: error, operation, model, durationMs }, "openai.failed")
    throw error
  }

  const responseText = response.choices[0]?.message?.content?.trim() || ""
  const raw = responseText || "{}"
  const usage = response.usage
  const durationMs = Date.now() - start
  logger.info(
    {
      operation,
      model,
      durationMs,
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens ?? 0,
      },
    },
    "openai.completed",
  )

  try {
    const parsed = JSON.parse(raw) as Partial<StoryMeta> & { text?: string }
    if (!parsed.title || !parsed.summary || !parsed.setting || !parsed.conflict || !parsed.tone) {
      throw new Error("Story metadata missing required fields")
    }
    if (!["nyugodt", "vidam", "kalandos"].includes(parsed.tone)) {
      throw new Error(`Invalid tone: ${parsed.tone}`)
    }
    if (!parsed.text || typeof parsed.text !== "string") {
      throw new Error("Story text missing")
    }
    return {
      text: parsed.text.trim(),
      meta: {
        title: parsed.title,
        summary: parsed.summary,
        setting: parsed.setting,
        conflict: parsed.conflict,
        tone: parsed.tone as "nyugodt" | "vidam" | "kalandos",
      },
      requestText,
      responseText: raw,
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
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse story response: ${error.message}`)
    }
    throw new Error("Failed to parse story response")
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
  requestText: string
  responseText: string
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
  const logger = getLogger()
  const client = getOpenAIClient()
  const model = DEFAULT_MODEL
  const operation = "story.extract_meta"
  const systemPrompt = "Extract structured metadata in Hungarian."
  const userPrompt = `
Extract JSON with:
title (max 6 words),
summary (1 sentence),
setting (1-4 words),
conflict (1-6 words),
tone (nyugodt|vidam|kalandos).

Story:
${storyText}
        `.trim()
  const requestText = formatRequestText(systemPrompt, userPrompt)
  const start = Date.now()
  let response: Awaited<ReturnType<typeof client.chat.completions.create>>
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      response_format: { type: "json_object" },
    })
  } catch (error) {
    const durationMs = Date.now() - start
    logger.error({ err: error, operation, model, durationMs }, "openai.failed")
    throw error
  }

  const raw = response.choices[0]?.message?.content || "{}"
  const usage = response.usage
  const durationMs = Date.now() - start
  logger.info(
    {
      operation,
      model,
      durationMs,
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens ?? 0,
      },
    },
    "openai.completed",
  )
  
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
      requestText,
      responseText: raw,
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

export type StoryTreeGenerationResult = {
  storyTree: {
    type: "tree"
    startNodeId: string
    nodes: Array<{
      id: string
      text: string
      choices?: Array<{
        id: string
        text: string
        nextNodeId: string
        effects: {
          fear: number
          confidence: number
          kindness: number
        }
      }>
    }>
  }
  meta: StoryMeta
  requestText: string
  responseText: string
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

export async function generateStoryTree(prompt: string): Promise<StoryTreeGenerationResult> {
  const logger = getLogger()
  const client = getOpenAIClient()
  const model = DEFAULT_MODEL
  const operation = "story.generate_tree"
  const systemPrompt =
    "You generate interactive decision-tree bedtime stories in Hungarian. Return valid JSON matching the StoryTree schema."
  const userPrompt = `
${prompt}

Extend the JSON with these top-level fields:
title (max 6 words),
summary (1 sentence),
setting (1-4 words),
conflict (1-6 words),
tone (nyugodt|vidam|kalandos).
  `.trim()
  const requestText = formatRequestText(systemPrompt, userPrompt)
  const start = Date.now()
  let response: Awaited<ReturnType<typeof client.chat.completions.create>>
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      response_format: { type: "json_object" },
    })
  } catch (error) {
    const durationMs = Date.now() - start
    logger.error({ err: error, operation, model, durationMs }, "openai.failed")
    throw error
  }

  const raw = response.choices[0]?.message?.content || "{}"
  const usage = response.usage
  const durationMs = Date.now() - start
  logger.info(
    {
      operation,
      model,
      durationMs,
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens ?? 0,
      },
    },
    "openai.completed",
  )

  try {
    const parsed = JSON.parse(raw) as Partial<
      StoryTreeGenerationResult["storyTree"] &
        StoryMeta
    >
    
    if (!parsed.title || !parsed.summary || !parsed.setting || !parsed.conflict || !parsed.tone) {
      throw new Error("Story metadata missing required fields")
    }
    if (!["nyugodt", "vidam", "kalandos"].includes(parsed.tone)) {
      throw new Error(`Invalid tone: ${parsed.tone}`)
    }

    // Basic validation
    if (!parsed.type || parsed.type !== "tree") {
      throw new Error("Invalid story tree type")
    }
    if (!parsed.startNodeId || !parsed.nodes || !Array.isArray(parsed.nodes)) {
      throw new Error("Invalid story tree structure")
    }
    if (parsed.nodes.length < 7 || parsed.nodes.length > 9) {
      throw new Error(`Invalid node count: ${parsed.nodes.length} (must be 7-9)`)
    }

    // Validate nodes
    const nodeIds = new Set(parsed.nodes.map((n) => n.id))
    if (!nodeIds.has(parsed.startNodeId)) {
      throw new Error("startNodeId does not exist in nodes")
    }

    const decisionNodes = parsed.nodes.filter((n) => n.choices && n.choices.length > 0)
    if (decisionNodes.length !== 2) {
      throw new Error(`Invalid decision node count: ${decisionNodes.length} (must be exactly 2)`)
    }

    for (const node of decisionNodes) {
      if (!node.choices || node.choices.length !== 3) {
        throw new Error(`Invalid choice count in node ${node.id}: ${node.choices?.length || 0} (must be 3)`)
      }
      for (const choice of node.choices) {
        if (!nodeIds.has(choice.nextNodeId)) {
          throw new Error(`Invalid nextNodeId in choice ${choice.id}: ${choice.nextNodeId}`)
        }
        // Validate effects
        if (
          choice.effects.fear < -2 || choice.effects.fear > 2 ||
          choice.effects.confidence < -2 || choice.effects.confidence > 2 ||
          choice.effects.kindness < -2 || choice.effects.kindness > 2
        ) {
          throw new Error(`Invalid effects in choice ${choice.id}: must be -2 to 2`)
        }
      }
    }

    const leafNodes = parsed.nodes.filter((n) => !n.choices || n.choices.length === 0)
    if (leafNodes.length < 3) {
      throw new Error(`Invalid leaf node count: ${leafNodes.length} (must be at least 3)`)
    }

    return {
      storyTree: {
        type: parsed.type,
        startNodeId: parsed.startNodeId,
        nodes: parsed.nodes,
      },
      meta: {
        title: parsed.title,
        summary: parsed.summary,
        setting: parsed.setting,
        conflict: parsed.conflict,
        tone: parsed.tone as "nyugodt" | "vidam" | "kalandos",
      },
      requestText,
      responseText: raw,
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
      throw new Error(`Failed to parse story tree: ${error.message}`)
    }
    throw new Error("Failed to parse story tree")
  }
}
