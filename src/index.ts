import { Elysia } from 'elysia'
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

const app = new Elysia()
  .use(cors({
   // origin: ["http://localhost:3001", "http://localhost:3000"],
    origin: ["http://localhost:3001", "http://localhost:3000", "exp://127.0.0.1:8081","exp://","solvo://*", "solvo-dev://", "solvo-dev://*", "solvo-staging://", "solvo-staging://*","solvo://", "https://staging.solvobudget.hu", "https://solvobudget.hu"],
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
  .use(invitationsApi)
  .use(invitationsAdminApi)
  .use(preRegistrationApi)
  .use(preRegistrationAdminApi)
  .use(dash)
  .use(health)
  app.all("/api/auth/*", async ({ request }) => {
    console.log("[AUTH]", request.method, request.url);
    return auth.handler(request);
  });
  
app.listen(process.env.APP_PORT || 4444, ({ hostname, port }) => {
  console.log(`🦊 BarniMeséi API is running at ${hostname}:${port}`)
})