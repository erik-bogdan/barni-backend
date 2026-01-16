import amqp from "amqplib"

import { createAudioJobId } from "../services/audio"

const AUDIO_QUEUE = "story-audio"
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

export async function enqueueAudioJob(payload: {
  storyId: string
  userId: string
  force: boolean
}): Promise<string> {
  const channel = await getChannel()
  const jobId = createAudioJobId()
  const body = Buffer.from(JSON.stringify({ jobId, ...payload }))
  channel.sendToQueue(AUDIO_QUEUE, body, { persistent: true })
  return jobId
}

export { AUDIO_QUEUE }
