import amqp from "amqplib"

import { AUDIO_QUEUE } from "./audio-queue"

const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672"

let channelPromise: Promise<amqp.Channel> | null = null

async function getChannel() {
  if (!channelPromise) {
    channelPromise = amqp.connect(rabbitUrl).then(async (conn) => {
      const channel = await conn.createChannel()
      await channel.assertQueue(AUDIO_QUEUE, { durable: true })
      return channel
    })
  }
  return channelPromise
}

export async function enqueueCoverJob(payload: {
  storyId: string
}): Promise<string> {
  const channel = await getChannel()
  const jobId = `cover-${Date.now()}-${Math.random().toString(36).substring(7)}`
  const body = Buffer.from(
    JSON.stringify({
      jobId,
      jobType: "cover.generate",
      storyId: payload.storyId,
    }),
  )
  channel.sendToQueue(AUDIO_QUEUE, body, {
    persistent: true,
    headers: { attempts: 0 },
    priority: 5, // Higher priority than audio (default is 0)
  })
  return jobId
}
