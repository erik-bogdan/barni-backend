import pino, { type Logger } from "pino"

export type { Logger }

type LogContext = Record<string, unknown>

const env = process.env.NODE_ENV ?? "development"
const version = process.env.APP_VERSION ?? process.env.npm_package_version

const redact = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers.set-cookie",
    "request.headers.authorization",
    "request.headers.cookie",
    "request.headers.set-cookie",
    "headers.authorization",
    "headers.cookie",
    "headers.set-cookie",
    "authorization",
    "cookie",
    "DATABASE_URL",
    "RABBITMQ_URL",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_ENDPOINT",
  ],
  censor: "[redacted]",
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }
  return Date.now()
}

function getBase(service: string): LogContext {
  const base: LogContext = { service, env }
  if (version) {
    base.version = version
  }
  return base
}

function buildPinoOptions(service: string) {
  const level = process.env.LOG_LEVEL ?? (env === "production" ? "info" : "debug")
  const options: pino.LoggerOptions = {
    level,
    redact,
    base: getBase(service),
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  if (env !== "production") {
    return {
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    }
  }

  return options
}

export function createLogger(service: string): Logger {
  return pino(buildPinoOptions(service))
}

let activeLogger: Logger = createLogger(process.env.SERVICE_NAME ?? "backend")

export function setLogger(logger: Logger): void {
  activeLogger = logger
}

export function getLogger(): Logger {
  return activeLogger
}

export function childLogger(context: LogContext): Logger {
  return activeLogger.child(context)
}

export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
  context?: LogContext,
  log: Logger = activeLogger,
): Promise<T> {
  const start = nowMs()
  try {
    const result = await fn()
    const durationMs = Math.round(nowMs() - start)
    log.info({ name, durationMs, ...(context ?? {}) }, `${name}.completed`)
    return result
  } catch (error) {
    const durationMs = Math.round(nowMs() - start)
    log.error({ name, durationMs, err: error, ...(context ?? {}) }, `${name}.failed`)
    throw error
  }
}
