import { z } from "zod"

// Effects schema
export const StoryEffectsSchema = z.object({
  fear: z.number().int().min(-2).max(2),
  confidence: z.number().int().min(-2).max(2),
  kindness: z.number().int().min(-2).max(2),
})

export type StoryEffects = z.infer<typeof StoryEffectsSchema>

// Choice schema
export const StoryChoiceSchema = z.object({
  id: z.string(),
  text: z.string(),
  nextNodeId: z.string(),
  effects: StoryEffectsSchema,
})

export type StoryChoice = z.infer<typeof StoryChoiceSchema>

// Node schema (can be decision node or leaf node)
export const StoryNodeSchema = z.object({
  id: z.string(),
  text: z.string(),
  choices: z.array(StoryChoiceSchema).optional(),
})

export type StoryNode = z.infer<typeof StoryNodeSchema>

// StoryTree schema
export const StoryTreeSchema = z.object({
  type: z.literal("tree"),
  startNodeId: z.string(),
  nodes: z.array(StoryNodeSchema).refine(
    (nodes) => {
      const nodeIds = new Set(nodes.map((n) => n.id))
      // Validate startNodeId exists
      if (!nodeIds.has(nodes[0]?.id || "")) return false
      // Validate all nextNodeIds exist
      for (const node of nodes) {
        if (node.choices) {
          for (const choice of node.choices) {
            if (!nodeIds.has(choice.nextNodeId)) return false
          }
        }
      }
      // Validate exactly 2 nodes have choices
      const decisionNodes = nodes.filter((n) => n.choices && n.choices.length > 0)
      if (decisionNodes.length !== 2) return false
      // Validate each decision node has exactly 3 choices
      for (const node of decisionNodes) {
        if (!node.choices || node.choices.length !== 3) return false
      }
      // Validate 7-9 nodes total
      if (nodes.length < 7 || nodes.length > 9) return false
      // Validate at least 3 leaf nodes (nodes without choices)
      const leafNodes = nodes.filter((n) => !n.choices || n.choices.length === 0)
      if (leafNodes.length < 3) return false
      return true
    },
    {
      message: "Invalid story tree structure",
    },
  ),
})

export type StoryTree = z.infer<typeof StoryTreeSchema>

// StoryLinear schema (backward compatible)
export const StoryLinearSchema = z.object({
  type: z.literal("linear"),
  text: z.string(),
})

export type StoryLinear = z.infer<typeof StoryLinearSchema>

// Discriminated union
export const StorySchema = z.discriminatedUnion("type", [
  StoryLinearSchema,
  StoryTreeSchema,
])

export type Story = StoryLinear | StoryTree

// Type guards
export function isStoryTree(story: Story): story is StoryTree {
  return story.type === "tree"
}

export function isStoryLinear(story: Story): story is StoryLinear {
  return story.type === "linear"
}

// Engine functions
export function getNode(tree: StoryTree, nodeId: string): StoryNode | null {
  return tree.nodes.find((n) => n.id === nodeId) ?? null
}

export function applyChoice(
  tree: StoryTree,
  nodeId: string,
  choiceId: string,
): { nextNodeId: string; effects: StoryEffects } | null {
  const node = getNode(tree, nodeId)
  if (!node || !node.choices) return null

  const choice = node.choices.find((c) => c.id === choiceId)
  if (!choice) return null

  return {
    nextNodeId: choice.nextNodeId,
    effects: choice.effects,
  }
}

// Convert linear story to tree format (for backward compatibility)
export function convertLinearToTree(linear: StoryLinear): StoryTree {
  const paragraphs = linear.text.split("\n").filter((p) => p.trim().length > 0)
  const nodeCount = Math.min(Math.max(paragraphs.length, 7), 9)
  const nodes: StoryNode[] = []

  // Create nodes from paragraphs
  for (let i = 0; i < nodeCount; i++) {
    const paragraphIndex = Math.floor((i * paragraphs.length) / nodeCount)
    const text = paragraphs[paragraphIndex] || paragraphs[paragraphs.length - 1] || ""

    const nodeId = `node_${i}`
    const isFirstDecision = i === 2 // Second decision point (0-indexed, so node 2)
    const isSecondDecision = i === 5 // Second decision point

    if (isFirstDecision || isSecondDecision) {
      // Decision node with 3 choices
      const choices: StoryChoice[] = []
      for (let j = 0; j < 3; j++) {
        const choiceId = `choice_${i}_${j}`
        const nextNodeId = i < nodeCount - 1 ? `node_${i + 1 + j}` : `node_${nodeCount - 1}`
        choices.push({
          id: choiceId,
          text: `Választás ${j + 1}`,
          nextNodeId,
          effects: {
            fear: j === 0 ? -1 : j === 1 ? 0 : 1,
            confidence: j === 0 ? 1 : j === 1 ? 0 : -1,
            kindness: j === 0 ? 0 : j === 1 ? 1 : -1,
          },
        })
      }
      nodes.push({
        id: nodeId,
        text,
        choices,
      })
    } else {
      // Leaf node
      nodes.push({
        id: nodeId,
        text,
      })
    }
  }

  // Ensure we have at least 3 leaf nodes
  const leafCount = nodes.filter((n) => !n.choices || n.choices.length === 0).length
  if (leafCount < 3) {
    // Convert some nodes to leaf nodes if needed
    for (let i = nodes.length - 1; i >= 0 && leafCount < 3; i--) {
      if (nodes[i].choices) {
        delete nodes[i].choices
        break
      }
    }
  }

  return {
    type: "tree",
    startNodeId: nodes[0]?.id || "node_0",
    nodes,
  }
}
