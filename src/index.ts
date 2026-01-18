import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { health } from './routes/health'
import { auth } from "./lib/auth";
import staticPlugin from '@elysiajs/static'
import openapi from '@elysiajs/openapi'
import { OpenAPI } from './plugins/auth/auth'
import { ensureBackupDir } from './lib/backup-dir'
import { portal } from "./routes/portal"
import { storiesApi } from "./routes/stories"
import { paymentsApi, stripeWebhook } from "./routes/payments"
import { dash } from "./routes/dash"

ensureBackupDir()

const app = new Elysia()
  .use(cors({
   // origin: ["http://localhost:3001", "http://localhost:3000"],
    origin: ["http://localhost:3001", "http://localhost:3000", "exp://127.0.0.1:8081","exp://","solvo://*", "solvo-dev://", "solvo-dev://*", "solvo-staging://", "solvo-staging://*","solvo://", "https://staging.solvobudget.hu", "https://solvobudget.hu", "https://appleid.apple.com"],
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
  // Stripe webhook must be mounted FIRST, before any other routes or middleware
  // that might intercept or parse the request body
  // This ensures /stripe/webhook is accessible for POST requests
  .use(stripeWebhook)
  .use(staticPlugin())
  // Mount auth only for dashboard/dash, not for collector
  .mount(auth.handler)
  .use(portal)
  .use(storiesApi)
  .use(paymentsApi)
  .use(dash)
  .use(health)
  app.all("/api/auth/*", async ({ request }) => {
    console.log("[AUTH]", request.method, request.url);
    return auth.handler(request);
  });
  
app.listen(process.env.APP_PORT || 4444, ({ hostname, port }) => {
  console.log(`🦊 BarniMeséi API is running at ${hostname}:${port}`)
})