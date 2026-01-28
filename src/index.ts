import { Elysia } from 'elysia'
import { randomUUID } from "crypto"
import { cors } from '@elysiajs/cors'
import { health } from './routes/health'
import { auth } from "./lib/auth";
import staticPlugin from '@elysiajs/static'
import openapi from '@elysiajs/openapi'
import { OpenAPI } from './plugins/auth/auth'
import { portal } from "./routes/portal"
import { storiesApi } from "./routes/stories"
import { paymentsApi, stripeWebhook, barionWebhook } from "./routes/payments"
import { dash } from "./routes/dash"
import { feedbackApi } from "./routes/feedback"
import { invitationsApi, invitationsAdminApi, preRegistrationApi, preRegistrationAdminApi } from "./routes/invitations"
import { launchSubscriptionsApi, launchSubscriptionsAdminApi } from "./routes/launch-subscriptions"
import { notificationsApi } from "./routes/notifications"
import { createLogger, setLogger } from "./lib/logger"

const baseLogger = createLogger("backend")
setLogger(baseLogger)

const app = new Elysia()
  .decorate("logger", baseLogger)
  .derive(({ request, set, logger }) => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID()
    set.headers["x-request-id"] = requestId
    return {
      requestId,
      requestStart: Date.now(),
      logger: logger.child({ requestId }),
    }
  })
  .onRequest(({ request, logger }) => {
    const path = new URL(request.url).pathname
    const log = logger ?? baseLogger
    log.info({ method: request.method, path }, "request.start")
  })
  .onAfterHandle(({ request, requestStart, set, logger }) => {
    const path = new URL(request.url).pathname
    const start = requestStart ?? Date.now()
    const durationMs = Date.now() - start
    const status = typeof set.status === "number" ? set.status : 200
    const log = logger ?? baseLogger
    log.info({ method: request.method, path, status, durationMs }, "request.complete")
  })
  .onError(({ request, requestStart, set, error, logger }) => {
    const path = new URL(request.url).pathname
    const start = requestStart ?? Date.now()
    const durationMs = Date.now() - start
    const status = typeof set.status === "number" ? set.status : 500
    const log = logger ?? baseLogger
    log.error({ method: request.method, path, status, durationMs, err: error }, "request.error")
  })
  .use(cors({
   // origin: ["http://localhost:3001", "http://localhost:3000"],
    origin: ["http://localhost:3001", "http://localhost:3000", "exp://127.0.0.1:8081", "https://beta.barnimesei.hu", "https://barnimesei.hu"],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 600
  }))
  .use(openapi(
    {
      documentation: {
          components: await OpenAPI.components,
          paths: await OpenAPI.getPaths()
      }
  }
  ))
  // Payment provider webhooks must be mounted FIRST, before any other routes or middleware
  // that might intercept or parse the request body
  // This ensures /stripe/webhook and /barion/webhook are accessible for POST requests
  .use(stripeWebhook)
  .use(barionWebhook)
  .use(staticPlugin())
  // Mount auth only for dashboard/dash, not for collector
  .mount(auth.handler)
  .use(portal)
  .use(storiesApi)
  .use(paymentsApi)
  .use(feedbackApi)
  .use(notificationsApi)
  .use(invitationsApi)
  .use(invitationsAdminApi)
  .use(preRegistrationApi)
  .use(preRegistrationAdminApi)
  .use(launchSubscriptionsApi)
  .use(launchSubscriptionsAdminApi)
  .use(dash)
  .use(health)
  app.all("/api/auth/*", async ({ request, logger }) => {
    logger.info({ method: request.method, path: new URL(request.url).pathname }, "auth.request")
    return auth.handler(request);
  });
  
app.listen(process.env.APP_PORT || 4444, ({ hostname, port }) => {
  baseLogger.info({ hostname, port }, "server.listening")
})