import amqp from "amqplib"

import { db } from "../lib/db"
import { createAudioRepo, processStoryAudioJob } from "../services/audio"
import { buildPublicUrl, uploadBuffer } from "../services/s3"
import { AUDIO_QUEUE } from "./audio-queue"

const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672"

const audioRepo = createAudioRepo(db)

type AudioJobPayload = {
  jobId: string
  storyId: string
  userId: string
  force?: boolean
}

async function startAudioWorker() {
  const conn = await amqp.connect(rabbitUrl)
  const channel = await conn.createChannel()
  await channel.assertQueue(AUDIO_QUEUE, { durable: true })
  await channel.prefetch(2)

  console.log(`[audio-worker] waiting for messages on ${AUDIO_QUEUE}`)

  channel.consume(AUDIO_QUEUE, async (msg) => {
    if (!msg) return
    const headers = msg.properties.headers ?? {}
    const attempts = Number(headers.attempts ?? 0)
    try {
      const payload = JSON.parse(msg.content.toString()) as AudioJobPayload
      if (!payload.storyId || !payload.userId) throw new Error("Missing storyId or userId")

      await processStoryAudioJob(
        { storyId: payload.storyId, userId: payload.userId, force: payload.force },
        {
          repo: audioRepo,
          s3: { uploadBuffer, buildPublicUrl },
        },
      )

      channel.ack(msg)
      console.log(`[audio-worker] completed ${payload.storyId}`)
    } catch (err) {
      const error = err as Error
      let payload: AudioJobPayload | null = null
      try {
        payload = JSON.parse(msg.content.toString()) as AudioJobPayload
        await audioRepo.updateAudio(payload.storyId, {
          audioStatus: "failed",
          audioError: error?.message ?? "Audio generation failed",
          audioUpdatedAt: new Date(),
        })
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
      console.error("[audio-worker] failed", error)
      channel.ack(msg)
    }
  })
}

startAudioWorker().catch((err) => {
  console.error("[audio-worker] fatal", err)
  process.exit(1)
})
