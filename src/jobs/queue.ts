import amqp from "amqplib"

const QUEUE_NAME = "story-generation"
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672"

let channelPromise: Promise<amqp.Channel> | null = null

async function getChannel() {
  if (!channelPromise) {
    channelPromise = amqp.connect(rabbitUrl).then(async (conn) => {
      const channel = await conn.createChannel()
      await channel.assertQueue(QUEUE_NAME, { durable: true })
      return channel
    })
  }
  return channelPromise
}

export async function enqueueStoryJob(storyId: string) {
  const channel = await getChannel()
  const payload = Buffer.from(JSON.stringify({ storyId }))
  channel.sendToQueue(QUEUE_NAME, payload, { persistent: true })
}

export { QUEUE_NAME }

