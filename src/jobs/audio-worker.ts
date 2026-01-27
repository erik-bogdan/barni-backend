import amqp from "amqplib"

import { db } from "../lib/db"
import {
  createAudioRepo,
  processStoryAudioJob,
  createFreeStoryAudioRepo,
  processFreeStoryAudioJob,
  refundAudioFailureOnce,
} from "../services/audio"
import { buildPublicUrl, uploadBuffer } from "../services/s3"
import { AUDIO_QUEUE } from "./audio-queue"
import { createCoverRepo, processCoverJob, createFreeStoryCoverRepo, processFreeStoryCoverJob } from "../services/cover/coverService"

const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672"
const heartbeatUrl = process.env.UPTIME_KUMA_PUSH_URL_AUDIO_WORKER

const audioRepo = createAudioRepo(db)
const freeStoryAudioRepo = createFreeStoryAudioRepo(db)

type AudioJobPayload = {
  jobId: string
  jobType?: string
  storyId: string
  userId?: string
  force?: boolean
}

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

async function startAudioWorker() {
  const conn = await amqp.connect(rabbitUrl)
  const channel = await conn.createChannel()

  startHeartbeat(heartbeatUrl)
  
  await channel.assertQueue(AUDIO_QUEUE, { durable: true })
  await channel.prefetch(2)

  console.log(`[audio-worker] waiting for messages on ${AUDIO_QUEUE}`)

  channel.consume(AUDIO_QUEUE, async (msg) => {
    if (!msg) return
    const headers = msg.properties.headers ?? {}
    const attempts = Number(headers.attempts ?? 0)
    try {
      const payload = JSON.parse(msg.content.toString()) as AudioJobPayload
      if (!payload.storyId) throw new Error("Missing storyId")

      // Handle cover generation jobs
      if (payload.jobType === "cover.generate") {
        // Check if it's a free story or regular story
        const freeStoryRepo = createFreeStoryCoverRepo(db)
        const freeStory = await freeStoryRepo.getStoryById(payload.storyId)
        
        if (freeStory) {
          // Free story cover
          await processFreeStoryCoverJob(
            { storyId: payload.storyId },
            {
              repo: freeStoryRepo,
              s3: { uploadBuffer, buildPublicUrl },
            },
          )
        } else {
          // Regular story cover
          const coverRepo = createCoverRepo(db)
          await processCoverJob(
            { storyId: payload.storyId },
            {
              repo: coverRepo,
              s3: { uploadBuffer, buildPublicUrl },
            },
          )
        }
        channel.ack(msg)
        console.log(`[audio-worker] cover completed ${payload.storyId}`)
        return
      }

      // Handle audio generation jobs
      if (!payload.userId) throw new Error("Missing userId for audio job")

      // Check if it's a free story (userId is empty string) or regular story
      if (payload.userId === "") {
        // Free story audio
        await processFreeStoryAudioJob(
          { storyId: payload.storyId },
          {
            repo: freeStoryAudioRepo,
            s3: { uploadBuffer, buildPublicUrl },
          },
        )
      } else {
        // Regular story audio
        await processStoryAudioJob(
          { storyId: payload.storyId, userId: payload.userId, force: payload.force },
          {
            repo: audioRepo,
            s3: { uploadBuffer, buildPublicUrl },
          },
        )
      }

      channel.ack(msg)
      console.log(`[audio-worker] completed ${payload.storyId}`)
    } catch (err) {
      const error = err as Error
      let payload: AudioJobPayload | null = null
      try {
        payload = JSON.parse(msg.content.toString()) as AudioJobPayload
        
        // Only update audio status if it's an audio job (not cover)
        if (payload.jobType !== "cover.generate" && payload.storyId) {
          if (payload.userId === "") {
            // Free story
            await freeStoryAudioRepo.updateAudio(payload.storyId, {
              audioStatus: "failed",
              audioError: error?.message ?? "Audio generation failed",
              audioUpdatedAt: new Date(),
            })
          } else if (payload.userId) {
            // Regular story
            await audioRepo.updateAudio(payload.storyId, {
              audioStatus: "failed",
              audioError: error?.message ?? "Audio generation failed",
              audioUpdatedAt: new Date(),
            })
          }
        }
      } catch (updateErr) {
        console.error("[audio-worker] failed to mark story", updateErr)
      }
      if (attempts < 2) {
        const nextAttempts = attempts + 1
        const delayMs = Math.min(1000 * 2 ** attempts, 8000)
        setTimeout(() => {
          channel.sendToQueue(AUDIO_QUEUE, msg.content, {
            persistent: true,
            headers: { attempts: nextAttempts },
          })
        }, delayMs)
        channel.ack(msg)
        console.warn(`[audio-worker] retrying (${nextAttempts})`, error?.message)
        return
      }
      if (payload?.storyId && payload.userId && payload.userId !== "" && payload.jobType !== "cover.generate") {
        try {
          const story = await audioRepo.getStoryById(payload.storyId)
          await refundAudioFailureOnce(db, {
            userId: payload.userId,
            storyId: payload.storyId,
            length: story?.length,
          })
        } catch (refundErr) {
          console.error("[audio-worker] failed to refund on final failure", refundErr)
        }
      }
      console.error("[audio-worker] failed", error)
      channel.ack(msg)
    }
  })
}

startAudioWorker().catch((err) => {
  console.error("[audio-worker] fatal", err)
  process.exit(1)
})
