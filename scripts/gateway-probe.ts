// Live contract probe for the Adorbis AI Gateway, using Breakout's own key.
//
//   runtime/tooling/node/bin/node scripts/gateway-probe.ts
//
// Reads ADORBIS_API_KEY from /docker/breakout/.env (never printed; all output
// is scrubbed). Makes a small number of minimal requests that consume a few
// credits. Does not deliberately trigger rate limits. Writes a JSON report to
// runtime/reports/. Exit code 0 only if the chat streaming path the Copilot
// uses (AI SDK v7 openai-compatible provider) works end to end.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { redact, registerSecret } from "../backend/src/log.ts";

const ROOT = "/docker/breakout";
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env"), "utf8").split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    .map((m) => [m[1]!, m[2]!.replace(/^["']|["']$/g, "")]),
);
const KEY = env.ADORBIS_API_KEY ?? "";
const BASE = (env.ADORBIS_BASE_URL || "https://api.adorbistech.com/v1").replace(/\/$/, "");
const ROOT_URL = BASE.replace(/\/v1$/, "");
const MODELS = (env.ADORBIS_MODELS || "adorbis/quick,adorbis/writing,adorbis/coder,adorbis/auto").split(",").map((s) => s.trim());
if (!KEY || KEY.startsWith("__")) {
  console.log("NOT RUN: ADORBIS_API_KEY is not set in /docker/breakout/.env");
  process.exit(2);
}
registerSecret(KEY);

type Row = { test: string; result: "PASS" | "FAIL" | "INFO"; detail: string; evidence?: unknown };
const rows: Row[] = [];
const record = (test: string, result: Row["result"], detail: string, evidence?: unknown) => {
  rows.push({ test, result, detail, evidence: redact(evidence) });
  console.log(`${result.padEnd(4)}  ${test} — ${String(redact(detail))}`);
};
const RL_HEADERS = /^(x-ratelimit|ratelimit|retry-after|x-request-id|x-adorbis|x-credits|x-usage)/i;
const pickHeaders = (h: Headers) => Object.fromEntries([...h].filter(([k]) => RL_HEADERS.test(k)));

async function post(path: string, body: unknown, key: string | null = KEY, root = BASE) {
  const t0 = Date.now();
  const res = await fetch(root + path, {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms: Date.now() - t0, headers: pickHeaders(res.headers), json, text: text.slice(0, 600) };
}
const chatBody = (model: string, content: string, extra: object = {}) =>
  ({ model, max_tokens: 64, messages: [{ role: "user", content }], ...extra });

// 1. Authentication
{
  const bad = await post("/chat/completions", chatBody(MODELS[0]!, "hi"), "invalid-key-for-probe");
  const none = await post("/chat/completions", chatBody(MODELS[0]!, "hi"), null);
  const ok = await post("/chat/completions", chatBody(MODELS[0]!, "Reply with the single word OK."));
  record("1 authentication", ok.status === 200 && bad.status === 401 ? "PASS" : "FAIL",
    `valid key → ${ok.status}; invalid key → ${bad.status}; no key → ${none.status}`,
    { invalid: bad.json ?? bad.text, missing: none.json ?? none.text });
}

// 2. Chat completions (non-streaming)
{
  const r = await post("/chat/completions", chatBody(MODELS[0]!, "Reply with the single word OK."));
  const content = r.json?.choices?.[0]?.message?.content;
  record("2 chat completions", r.status === 200 && typeof content === "string" ? "PASS" : "FAIL",
    `HTTP ${r.status} in ${r.ms}ms; object=${r.json?.object}; model=${r.json?.model}; usage=${JSON.stringify(r.json?.usage)}`,
    { keys: r.json ? Object.keys(r.json) : null, content: String(content).slice(0, 80) });
}

// 3. Streaming SSE: is it incremental?
{
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ ...chatBody(MODELS[0]!, "Count from 1 to 30, one number per line."), max_tokens: 200, stream: true, stream_options: { include_usage: true } }),
  });
  const times: number[] = []; let buf = ""; let done = false; let usage: unknown = null; let malformed = 0;
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") { done = true; continue; }
      try {
        const j = JSON.parse(data);
        if (j.choices?.[0]?.delta?.content) times.push(Date.now() - t0);
        if (j.usage) usage = j.usage;
      } catch { malformed++; }
    }
  }
  const spread = times.length > 1 ? times.at(-1)! - times[0]! : 0;
  const incremental = times.length >= 3 && spread >= 200;
  record("3 streaming SSE", res.status === 200 && done && times.length > 0 ? (incremental ? "PASS" : "INFO") : "FAIL",
    `HTTP ${res.status}; content-type=${res.headers.get("content-type")}; ${times.length} content chunks; first at ${times[0]}ms; spread ${spread}ms; ` +
    `${incremental ? "incremental" : "looks buffered"}; [DONE]=${done}; usage chunk=${usage ? "yes" : "no"}; malformed=${malformed}`);
}

// 4. Models and entitlement
{
  for (const [label, url] of [["GET /v1/models (undocumented)", `${BASE}/models`], ["GET /claude/v1/models (documented)", `${ROOT_URL}/claude/v1/models`]] as const) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(30_000) });
    const body = await r.text();
    let ids: string[] | null = null;
    try { const j = JSON.parse(body); ids = (j.data ?? j.models ?? []).map((m: any) => m.id ?? m.name).filter(Boolean); } catch { /* */ }
    record(`4 ${label}`, "INFO", `HTTP ${r.status}; ids=${ids ? JSON.stringify(ids.slice(0, 30)) : body.slice(0, 120)}`);
  }
  for (const m of MODELS) {
    const r = await post("/chat/completions", { ...chatBody(m, "Reply OK."), max_tokens: 8 });
    record(`4 entitlement ${m}`, r.status === 200 ? "PASS" : "FAIL", `HTTP ${r.status} in ${r.ms}ms; served model=${r.json?.model ?? "-"}`,
      r.status === 200 ? undefined : (r.json ?? r.text));
  }
}

// 5. Error response schema
{
  const r = await post("/chat/completions", chatBody("adorbis/does-not-exist", "hi"));
  record("5 error schema (unknown model)", "INFO", `HTTP ${r.status}; body=${JSON.stringify(r.json ?? r.text).slice(0, 300)}`);
  const r2 = await post("/chat/completions", { model: MODELS[0], messages: "not-an-array" });
  record("5 error schema (malformed request)", "INFO", `HTTP ${r2.status}; body=${JSON.stringify(r2.json ?? r2.text).slice(0, 300)}`);
}

// 6. Rate-limit and usage headers (observed only; 429 is not induced)
{
  const r = await post("/chat/completions", chatBody(MODELS[0]!, "OK"));
  record("6 rate-limit headers", "INFO", Object.keys(r.headers).length ? JSON.stringify(r.headers) : "none returned on a successful request");
}

// 7. Tool calling, non-streaming, full round trip
{
  const tools = [{ type: "function", function: { name: "get_reference_time", description: "Returns a fixed reference time for testing.", parameters: { type: "object", properties: { zone: { type: "string" } }, required: ["zone"] } } }];
  const ask = { role: "user", content: "Call get_reference_time with zone \"Asia/Kolkata\", then tell me the result." };
  for (const m of MODELS) {
    const r1 = await post("/chat/completions", { model: m, max_tokens: 200, messages: [ask], tools, tool_choice: "auto" });
    const call = r1.json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) {
      record(`7 tool call ${m}`, "FAIL", `HTTP ${r1.status}; no tool_calls (finish_reason=${r1.json?.choices?.[0]?.finish_reason})`, r1.json?.error ?? undefined);
      continue;
    }
    let args: unknown = null; try { args = JSON.parse(call.function.arguments); } catch { /* */ }
    const r2 = await post("/chat/completions", { model: m, max_tokens: 200, tools, messages: [ask,
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: JSON.stringify({ time: "2026-11-01T09:15:00+05:30" }) }] });
    const final = r2.json?.choices?.[0]?.message?.content ?? "";
    const used = /09:15|9:15/.test(final);
    record(`7 tool call ${m}`, args && r2.status === 200 && used ? "PASS" : "FAIL",
      `call=${call.function.name} args=${JSON.stringify(args)}; round trip HTTP ${r2.status}; result used=${used}`);
  }
}

// 8. Structured output
{
  const schema = { type: "object", properties: { answer: { type: "string" }, confidence: { type: "number" } }, required: ["answer", "confidence"], additionalProperties: false };
  const r = await post("/chat/completions", { ...chatBody(MODELS[0]!, "Is 7 prime? Answer in the required JSON."), max_tokens: 100,
    response_format: { type: "json_schema", json_schema: { name: "probe", strict: true, schema } } });
  let parsed: any = null; try { parsed = JSON.parse(r.json?.choices?.[0]?.message?.content ?? ""); } catch { /* */ }
  const ok = parsed && typeof parsed.answer === "string" && typeof parsed.confidence === "number";
  record("8 structured output (json_schema)", ok ? "PASS" : "FAIL", `HTTP ${r.status}; parsed=${JSON.stringify(parsed)}`);
}

// 9. AI SDK v7 compatibility — the exact path the Copilot uses
let sdkOk = false;
{
  const provider = createOpenAICompatible({ name: "adorbis", baseURL: BASE, apiKey: KEY, includeUsage: true });
  const t0 = Date.now(); const deltas: number[] = []; let text = "";
  try {
    const result = streamText({ model: provider.chatModel(MODELS[0]!), prompt: "Count from 1 to 15 separated by spaces.", maxOutputTokens: 120, maxRetries: 0 });
    for await (const d of result.textStream) { deltas.push(Date.now() - t0); text += d; }
    const usage = await result.totalUsage;
    sdkOk = text.length > 0;
    record("9 AI SDK v7 openai-compatible streamText", sdkOk ? "PASS" : "FAIL",
      `${deltas.length} deltas over ${deltas.length > 1 ? deltas.at(-1)! - deltas[0]! : 0}ms; ${text.length} chars; usage=${JSON.stringify(usage)}`);
  } catch (e) {
    record("9 AI SDK v7 openai-compatible streamText", "FAIL", String((e as Error).message).slice(0, 300));
  }
}

const dir = join(ROOT, "runtime/reports");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = join(dir, `gateway-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(redact({ at: new Date().toISOString(), base: BASE, rows }), null, 1), { mode: 0o600 });
console.log(`report: ${file}`);
process.exit(sdkOk ? 0 : 1);
