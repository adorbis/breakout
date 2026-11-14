# Third-party npm dependencies (Trading Copilot)

Exact versions are pinned in `package.json` files, and the full tree is in `package-lock.json`. Installs use `--ignore-scripts`.

## Direct dependencies

| Package | Version | Licence | Use |
|---|---|---|---|
| `@assistant-ui/react` | 0.15.32 | MIT | Chat UI primitives ([repo](https://github.com/assistant-ui/assistant-ui), [licence](https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE)) |
| `@assistant-ui/ai-sdk` | 0.0.16 | MIT | assistant-ui ↔ AI SDK runtime (`useChatRuntime`) |
| `@assistant-ui/react-markdown` | 0.14.24 | MIT | Markdown rendering for messages |
| `ai` | 7.0.159 | Apache-2.0 | AI SDK v7: `streamText`, UI message stream, chat transport |
| `@ai-sdk/react` | 4.0.163 | Apache-2.0 | Peer of `@assistant-ui/ai-sdk`; pins `ai` 7.0.159 |
| `@ai-sdk/openai-compatible` | 3.0.82 | Apache-2.0 | Provider for the Adorbis `/v1/chat/completions` |
| `hono` | 4.13.16 | MIT | HTTP routing and middleware |
| `@hono/node-server` | 2.1.8 | MIT | Node HTTP adapter and static files. Raised from 2.1.5 on 2026-11-14 for GHSA-jpvv-r467-5p4w (backslash path parsing) and GHSA-qv5m-9pm6-hqp3 |
| `zod` | 4.6.7 | MIT | Request and config validation |
| `react`, `react-dom` | 19.2.1 | MIT | UI |
| `remark-gfm` | 4.0.1 | MIT | GitHub-flavoured Markdown (tables, lists) |
| `lightweight-charts` | 4.2.3 | Apache-2.0 | Candlestick/volume charts with zoom, pan and crosshair (TradingView; [repo](https://github.com/tradingview/lightweight-charts)). Pulls `fancy-canvas` 2.1.0 (MIT). Added 2026-11-14 |

Dev only: `vite` 8.3.5, `@vitejs/plugin-react` 6.1.2, `typescript` 5.9.3, `@types/*`, and `playwright-core` 1.56.1 (Apache-2.0, browser e2e).

## Licence summary

There are 224 third-party production packages, all under permissive licences: 209 MIT, 9 Apache-2.0, 3 ISC, 1 BSD-3-Clause, 1 0BSD, and 1 `(AFL-2.1 OR BSD-3-Clause)` (`json-schema`). No copyleft licence appears in the production tree. `npm audit --omit=dev` reported 0 vulnerabilities on 2026-11-01 and again on 2026-11-14 after the @hono/node-server patch.

## Notes

- assistant-ui's upstream audit commit was given as `36ca75503a68689f36eeb35cb498bd2058caaa5`, which is 39 characters, one short of a full SHA-1, so it is truncated. The packages above are the published npm releases dated 2026-10-28. The monorepo is not cloned or vendored.
- **Assistant Cloud is not used.** `@assistant-ui/react` ships an Assistant Cloud client, so the strings `Bearer` and `Aui-User-Id` appear in the bundle. It only activates when `cloud` is passed to the runtime, and Breakout never passes it. Conversation storage is Breakout's own SQLite.
- `ai` 7 bundles `@ai-sdk/gateway`, Vercel's hosted gateway client. It only activates when a model is given as a bare string, and Breakout always passes an explicit Adorbis provider model.
- `lightweight-charts` (Apache-2.0) displays a small TradingView attribution logo on each chart by default; it is left on, as its licence NOTICE asks for attribution.
- The Integration Adapter (`adapter/`) has **no runtime npm dependencies** (Node 22 standard library only).
- MIT and Apache-2.0 notices remain inside each package in `node_modules` and are carried into the container image with the production `node_modules`.
