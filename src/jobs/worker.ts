import amqp from "amqplib"

import { db } from "../lib/db"
import { generateStoryText, generateStoryTree, extractStoryMeta } from "../services/openai"
import { createStoryRepo } from "./processors/story-repo"
import { processStoryJob } from "./processors/story"
import { QUEUE_NAME } from "./queue"
import { createCoverRepo, processCoverJob } from "../services/cover/coverService"
import { uploadBuffer, buildPublicUrl } from "../services/s3"
import { createLogger, setLogger } from "../lib/logger"

const logger = createLogger("worker-story")
setLogger(logger)

const repo = createStoryRepo(db)

const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672"
const heartbeatUrl = process.env.UPTIME_KUMA_PUSH_URL_STORY_WORKER

async function startHeartbeat(url?: string) {
  if (!url) return

  setInterval(async () => {
    try {
      await fetch(url)
    } catch {
      // direkt lenyeljük – ha nem megy ki, Kuma úgyis DOWN lesz
    }
  }, 60_000) // 60s
}

async function startWorker() {
  logger.info({ queue: QUEUE_NAME }, "worker.starting")
  const conn = await amqp.connect(rabbitUrl)
  logger.info({ queue: QUEUE_NAME }, "rabbit.connected")
  const channel = await conn.createChannel()

  startHeartbeat(heartbeatUrl)

  await channel.assertQueue(QUEUE_NAME, { durable: true })
  await channel.prefetch(2)

  logger.info({ queue: QUEUE_NAME }, "queue.asserted")
  logger.info({ queue: QUEUE_NAME }, "queue.consuming")

  channel.consume(QUEUE_NAME, async (msg) => {
    if (!msg) return
    try {
      const payload = JSON.parse(msg.content.toString()) as { storyId: string }
      if (!payload.storyId) throw new Error("Missing storyId")

      const jobLogger = logger.child({ storyId: payload.storyId, queue: QUEUE_NAME })
      jobLogger.info("job.received")
      jobLogger.info("job.started")

      await processStoryJob(payload.storyId, {
        repo,
        openai: { generateStoryText, generateStoryTree, extractStoryMeta },
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
      jobLogger.info("job.completed")
    } catch (err) {
      logger.error({ err }, "job.failed")
      channel.nack(msg, false, false)
    }
  })
}

startWorker().catch((err) => {
  logger.fatal({ err }, "worker.fatal")
  process.exit(1)
})

