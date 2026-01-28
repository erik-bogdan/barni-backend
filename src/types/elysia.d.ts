import type { Logger } from "../lib/logger"

declare module "elysia" {
  interface Context {
    logger: Logger
    requestId: string
    requestStart: number
  }
}
