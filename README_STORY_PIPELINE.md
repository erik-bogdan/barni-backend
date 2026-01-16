## Story Generation Pipeline

### Env vars

```
DATABASE_URL=postgres://...
RABBITMQ_URL=amqp://localhost:5672
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=...
S3_FORCE_PATH_STYLE=true
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
PUBLIC_ASSET_BASE_URL=http://localhost:9000
ELEVENLABS_TOKEN=...
```

### Commands

```
bun run dev
bun run worker
bun run worker:audio
bun run test
```

