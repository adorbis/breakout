# Trading Copilot — Release 1 architecture

**Status:** implemented and tested against a mock gateway. The live gateway has not been verified yet, because the dedicated Breakout Adorbis key is not provisioned. Not deployed.

## Boundary

| System | Role | Release 1 status |
|---|---|---|
| Breakout Copilot | Chat UI, conversations, model access | This module |
| Adorbis AI Gateway | Model inference | Integrated; live verification pending the key |
| TradeOS | Trading decision authority | **DISABLED.** Pending an authenticated, side-effect-free assessment contract ([proposal](../integrations/TRADEOS_ASSESSMENT_CONTRACT_PROPOSAL.md)) |
| OpenAlgo | Broker and market data | **DISABLED.** Pending the Integration Adapter ([design](../integrations/OPENALGO_ADAPTER_DESIGN.md)) |
| Collector | Research | **EXCLUDED** from Release 1. Its API is an admin-only asynchronous job system |

The Copilot never issues, predicts or relabels a TradeOS decision. Every answer is marked "AI analysis · not a TradeOS decision", and the workspace shows "TradeOS decision: Not available".

## Components

```
browser ──HTTPS──▶ copilot (single Node 22 process, container "copilot")
  assistant-ui         ├─ Hono HTTP: auth, conversations, /api/chat (UI message stream, SSE)
  @assistant-ui/ai-sdk ├─ AI SDK v7 streamText ──▶ @ai-sdk/openai-compatible ──▶ Adorbis /v1/chat/completions
                       ├─ SQLite (node:sqlite) on volume breakout_copilot_data
                       └─ serves the built frontend (frontend/dist)
```

- `frontend/` contains React 19 and Vite. assistant-ui primitives provide the thread, composer, streaming, stop, retry and Markdown. `useChatRuntime` is fed by a `DefaultChatTransport` that sends only `{id, trigger, messageId, message, model, context}`.
- `backend/src/` has one module per concern:
  - `config.ts` loads configuration from the environment.
  - `db.ts` is the store.
  - `auth.ts` handles sessions and the Origin check.
  - `gateway.ts` handles the provider, the model catalogue and error mapping.
  - `policy.ts` holds the system prompt and the context schema.
  - `tools.ts` is the tool registry.
  - `app.ts` defines the routes.
  - `server.ts` is the entry point.
  - `cli.ts` creates users.
- The backend runs TypeScript directly through Node's type stripping (Node 22.18 or later). There is no backend build step.

### Why one service

The browser needs a single origin, the backend has no other consumers, and SQLite needs a single writer. Splitting the frontend and backend into separate containers would add a proxy hop with no isolation benefit. The Integration Adapter is the component that warrants a separate service, because it will hold credentials the Copilot must not hold.

## Chat request flow

1. The browser posts the new user message, the selected model and the trading context.
2. The server checks, in order:
   - **Session:** a valid session cookie.
   - **Rate limit:** the per-user chat limit.
   - **Body:** Zod schema validation.
   - **Ownership:** the conversation belongs to the user.
   - **Gateway:** it is configured.
   - **Model:** it is selectable.
   - **Concurrency:** no response is already in progress for this conversation.
   - **Content:** text only, at most 8,000 characters.
3. The server stores the user message, then **rebuilds history from the database**, keeping the last 40 turns and skipping failed ones. It ignores anything else the client sent, including `system`, `tools`, `callSettings` and earlier messages. assistant-ui's `AssistantChatTransport` normally forwards these, so they are treated as hostile input.
4. `streamText` runs with:
   - the server-owned system prompt;
   - **no tools** (`enabledToolSet()` is empty);
   - a 90 s total timeout and a 30 s first-chunk timeout;
   - one retry;
   - the client's abort signal.
5. The response streams to the browser as an AI SDK UI message stream. When the stream ends, the assistant turn is stored with one of three statuses:
   - `complete`
   - `aborted`: the user pressed stop or refreshed. The partial text is kept and marked "Interrupted".
   - `error`: the user-facing reason is stored, so a reload still shows it.

Timeouts and client disconnects both reach the SDK as an abort. The server tells them apart by the client signal, and turns a timeout into an `error` chunk for a browser that is still connected.

## Model selector

The gateway has no documented `GET /v1/models`, so the catalogue is `ADORBIS_MODELS`: the published identifiers `adorbis/quick`, `adorbis/writing`, `adorbis/coder` and `adorbis/auto`. Each model shows a status based on real evidence:

- `not yet verified`: no request has succeeded yet.
- `verified`: a request with this model succeeded.
- `unavailable`: the gateway rejected the model. It can no longer be selected, and the server refuses it.

`adorbis/auto` is labelled as an alias that resolves to writing, not as dynamic routing. Status is kept in process memory and resets when the server restarts.

## Persistence

SQLite file `/data/breakout.db` on the Breakout-only named volume `copilot_data` (WAL mode, foreign keys on). Schema version is tracked in `PRAGMA user_version`, and migrations run on startup.

| Table | Key columns |
|---|---|
| `users` | id, username (unique, case-insensitive), scrypt password_hash, disabled |
| `sessions` | sha256(token) **only**, user_id, expires_at |
| `conversations` | id, **user_id**, title, model, context (validated JSON), created/updated_at |
| `messages` | id, conversation_id, seq, role, parts (text/reasoning only), model, status, usage, tool_calls, error, created_at |

Every conversation query includes `user_id`. A message is reachable only through a conversation the caller owns, and another user's conversation returns 404, which doesn't reveal that it exists. No TradeOS or OpenAlgo table or database is used.

SQLite fits Release 1, which is one process with a few users. Moving to a dedicated Breakout PostgreSQL would mean replacing `db.ts`. It would never mean sharing TradeOS's database.

## Security model

| Control | Implementation |
|---|---|
| Authentication | Username and password (scrypt N=16384), with a dummy hash for unknown users so timing doesn't reveal which usernames exist. Accounts are created through the admin CLI; there is no self sign-up |
| Sessions | 32-byte random token in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` by default). Only its SHA-256 is stored. 12 h expiry; logout deletes the session server-side |
| CSRF | SameSite=Strict, and every non-GET `/api` request must carry `Origin == BREAKOUT_PUBLIC_ORIGIN` |
| Ownership | All conversation and message access is scoped by `user_id`. Tested across GET, PATCH, DELETE and chat |
| Secrets | `ADORBIS_API_KEY` is used only by the server-side provider. It never appears in API responses, the browser bundle or logs. Not even Adorbis receives it outside the Authorization header |
| Logging | JSON logs. Known secret field names, Bearer tokens and the literal key value are redacted. Message content is never logged. The SDK's default `console.error` is replaced so provider errors pass through redaction too |
| Errors | Gateway failures map to fixed user-facing messages (401, 402, 429, 5xx, timeout, model unavailable). Raw provider error bodies never reach the browser |
| Input | Zod schemas on every body, a 64 KB body limit, text-only messages up to 8,000 characters, and a validated trading context: an OpenAlgo exchange code, a symbol matching `[A-Z0-9&_.-]` up to 40 characters, and an optional 200-character note with no defaults |
| Rate limits | Per user for chat (12/min) and per IP for login (5/min). Process-local, sliding 60 s windows |
| Rendering | react-markdown without raw HTML. Links must be http(s) and open with `noopener noreferrer`. A strict Content Security Policy (`default-src 'self'`, no inline script) and `frame-ancestors 'none'` |
| Prompt injection | Trading context is placed in a delimited data block and the prompt says to treat it as data. No retrieval or tools exist yet, so there is no untrusted external content |
| Mutation | No tool can place, modify or cancel orders, run strategies, run shell commands, fetch URLs or execute code. The registry has no way to express such a tool, and none is enabled |

## Tool registry (`backend/src/tools.ts`)

| Tool | Upstream | Status | Reason |
|---|---|---|---|
| `get_tradeos_assessment` | TradeOS | DISABLED | No authenticated, side-effect-free contract |
| `get_market_snapshot` | OpenAlgo | DISABLED | Waiting on the adapter; the key can't be scoped read-only |
| `get_account_funds` | OpenAlgo | DISABLED | Waiting on the adapter |
| `search_market_research` | Collector | EXCLUDED | No search API |
| `get_skill_reference` | Breakout | DISABLED | Imported skills not yet individually reviewed |

When the model emits a call for an unregistered tool, Breakout neither executes it nor sends a result back (tested). Per the Adorbis docs, tool workflows will use **non-streaming** requests until a streaming and tool combination is verified.

## Known limitations

- Model status and rate-limit state live in process memory. Running more than one replica would need a shared store.
- The frontend bundle is about 1.17 MB minified (343 KB gzip). Code splitting is a follow-up.
- `node:sqlite` is still flagged experimental in Node 22. The warning is suppressed in the container, and the API used is minimal.
- There are no attachments in Release 1. The server refuses non-text parts.
