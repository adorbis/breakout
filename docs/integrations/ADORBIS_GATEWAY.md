# Adorbis AI Gateway — integration contract

Source: https://ai.adorbistech.com/docs, retrieved 2026-11-01, plus unauthenticated probes run the same day.

## Documented contract

| Item | Value |
|---|---|
| Base URL (OpenAI-compatible clients) | `https://api.adorbistech.com/v1` |
| Chat | `POST /v1/chat/completions`, documented as **real SSE** "where the active execution path supports it" |
| Auth | `Authorization: Bearer <key>`; server-side only |
| Models | `adorbis/quick`, `adorbis/coder`, `adorbis/writing` (verified); `adorbis/auto` (conditional alias of writing) |
| Models endpoint | Not documented for `/v1`. `GET /claude/v1/models` is documented on the Claude surface |
| Tools | Transported where supported. Streaming tool calls are not a general contract; **use non-streaming for tools** |
| Errors | 401 auth, 402 credits or spend limit, 429 rate limit (no `Retry-After`), 5xx gateway or upstream. Bodies vary by route and source |
| Rate limits | Process-local sliding 60 s window per organisation on chat completions. Tiers aren't published |

## Observed without credentials (2026-11-01)

- `GET /` returns `adorbis-api` 1.0.0 and lists `/v1/health`, `/v1/chat/completions` and `/v1/messages`.
- `GET /health` returns `degraded: true`, with circuit `zai-glm47` OPEN.
- Missing key on chat: `401 {"error":"Missing API key"}`, a **string** error.
- Invalid key on `/v1/models`: `401 {"error":{"message":"Invalid API key","type":"authentication_error"}}`, an **object** error.
- These error shapes are inconsistent, so Breakout maps errors by HTTP status, never by body shape.

## Breakout integration

- **Provider:** `@ai-sdk/openai-compatible` 3.0.82 `chatModel(id)` with `includeUsage: true`, under AI SDK `ai` 7.0.159 `streamText`.
- **Bounds:** one retry; 90 s total and 30 s first-chunk timeouts; 2,048 output tokens.
- **Error mapping:** see `classifyGatewayError` in `backend/src/gateway.ts`. A model-rejection error marks that model unavailable.

## Live verification: NOT RUN

The dedicated Breakout key is not provisioned yet. To verify, place the key in `/docker/breakout/.env` as `ADORBIS_API_KEY` (mode 600), then run:

```bash
cd /docker/breakout && runtime/tooling/node/bin/node scripts/gateway-probe.ts
```

The probe never prints the key. It makes about 20 minimal requests, which costs a few credits, and writes a report to `runtime/reports/`. It covers:

1. Authentication: valid, invalid and missing key.
2. Non-streaming chat.
3. SSE: content-chunk count and timing spread, to tell incremental from buffered streaming.
4. `GET /v1/models` and `GET /claude/v1/models`, plus per-model entitlement for every configured model.
5. Error-body schema for an unknown model and a malformed request.
6. Rate-limit and usage headers. A 429 isn't induced.
7. Non-streaming tool call with a full round trip, per model.
8. Structured output (`json_schema`).
9. **AI SDK v7 `streamText` through the openai-compatible provider: the Copilot's exact path.** The probe exits 0 only if this passes.

Decision rule: if check 9 fails, the Copilot must not be called live. In that case the fallback is a custom assistant-ui runtime that speaks the gateway's real protocol.
