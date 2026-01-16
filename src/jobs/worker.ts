import amqp from "amqplib"

import { db } from "../lib/db"
import { generateStoryText, extractStoryMeta } from "../services/openai"
import { createStoryRepo } from "./processors/story-repo"
import { processStoryJob } from "./processors/story"
import { QUEUE_NAME } from "./queue"
import { createCoverRepo, processCoverJob } from "../services/cover/coverService"
import { uploadBuffer, buildPublicUrl } from "../services/s3"

const repo = createStoryRepo(db)

const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672"

async function startWorker() {
  const conn = await amqp.connect(rabbitUrl)
  const channel = await conn.createChannel()
  await channel.assertQueue(QUEUE_NAME, { durable: true })
  await channel.prefetch(2)

  console.log(`[story-worker] waiting for messages on ${QUEUE_NAME}`)

  channel.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return
    try {
      const payload = JSON.parse(msg.content.toString()) as { storyId: string }
      if (!payload.storyId) throw new Error("Missing storyId")

      await processStoryJob(payload.storyId, {
        repo,
        openai: { generateStoryText, extractStoryMeta },
        cover: {
          processCoverJob: async (params, deps) => {
            const coverRepo = createCoverRepo(db)
            const coverDeps = deps ? { ...(deps as object) } : {}
            return processCoverJob(params, {
              repo: coverRepo,
              s3: { uploadBuffer, buildPublicUrl },
              ...coverDeps,
            })
          },
        },
        s3: { uploadBuffer, buildPublicUrl },
      })
      channel.ack(msg)
      console.log(`[story-worker] completed ${payload.storyId}`)
    } catch (err) {
      console.error("[story-worker] failed", err)
      channel.nack(msg, false, false)
    }
  })
}

startWorker().catch((err) => {
  console.error("[story-worker] fatal", err)
  process.exit(1)
})

