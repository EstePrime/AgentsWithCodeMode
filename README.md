# AgentsWithCodeMode

Experiment with Cloudflare Agents and CodeMode. Based on [Agent Starter](https://github.com/cloudflare/agents-starter) ⛅

A playground for building AI chat agents on Cloudflare — powered by [Workers AI](https://developers.cloudflare.com/workers-ai/) (Kimi K2.5), with [Codemode](https://developers.cloudflare.com/agents/api-reference/codemode/) for multi-step tool orchestration, MCP server support, scheduling, vision, and human-in-the-loop approvals.

## Quick start

```bash
git clone https://github.com/EstePrime/AgentsWithCodeMode.git
cd testagents
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to see your agent in action.

## Deploy

```bash
npm run deploy
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server (Vite + Wrangler) |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run types` | Regenerate `env.d.ts` after binding changes |
| `npm run lint` | Lint with oxlint |
| `npm run check` | Format check + lint + TypeScript |

## What's included

- **Codemode** — LLM writes JS to orchestrate tools in parallel with conditionals and loops, running in an isolated Worker sandbox
- **Workers AI** — Streaming responses via `@cf/moonshotai/kimi-k2.5`, no API key required
- **Image input** — Drag-and-drop, paste, or click to attach images for vision-capable models
- **Tool patterns** — server-side auto-execute, client-side (browser), and human-in-the-loop approval
- **Scheduling** — one-time, delayed, and recurring (cron) tasks
- **MCP servers** — connect external tool servers at runtime; tools are automatically included in codemode
- **Reasoning display** — model thinking streams and collapses when done
- **Debug mode** — toggle in the header to inspect raw message JSON
- **Kumo UI** — Cloudflare's design system with dark/light mode
- **Real-time** — WebSocket with automatic reconnection and SQLite message persistence

## Project structure

```
src/
  server.ts    # ChatAgent — codemode, tools, scheduling
  app.tsx      # Chat UI built with Kumo components
  client.tsx   # React entry point
  styles.css   # Tailwind + Kumo styles
wrangler.jsonc # Cloudflare bindings (AI, Durable Objects, LOADER)
```

## Try these prompts

- **"Check the weather in Paris, London and Tokyo, then schedule a reminder in 5 minutes for whichever city is rainy"** — codemode chains weather + schedule in one sandbox execution
- **"What timezone am I in?"** — client-side tool (browser provides the answer)
- **"Calculate 5000 \* 3"** — approval tool (asks you before running)
- **Drop an image and ask "What's in this image?"** — vision

## Learn more

- [Agents SDK](https://developers.cloudflare.com/agents/)
- [Codemode](https://developers.cloudflare.com/agents/api-reference/codemode/)
- [Workers AI models](https://developers.cloudflare.com/workers-ai/models/)
- [MCP Client API](https://developers.cloudflare.com/agents/api-reference/mcp-client-api/)

## License

MIT
