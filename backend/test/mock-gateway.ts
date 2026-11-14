// Disposable mock of the Adorbis /v1/chat/completions contract (OpenAI-style
// SSE) for tests. Scenario is chosen by a [[marker]] in the last user message.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Captured { headers: IncomingMessage["headers"]; body: any }

export async function startMockGateway() {
  const requests: Captured[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    requests.push({ headers: req.headers, body });

    if (req.headers.authorization !== "Bearer test-key-0123456789") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Invalid API key", type: "authentication_error" } }));
      return;
    }
    const lastUser = [...(body.messages ?? [])].reverse().find((m: any) => m.role === "user");
    const text: string = typeof lastUser?.content === "string" ? lastUser.content
      : (lastUser?.content ?? []).map((p: any) => p.text ?? "").join("");
    const marker = /\[\[(\w+)\]\]/.exec(text)?.[1] ?? "ok";

    const json = (status: number, payload: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
    switch (marker) {
      case "e429": return json(429, { error: { message: "Rate limit exceeded", type: "rate_limit_error" } });
      case "e402": return json(402, { error: { message: "Insufficient credits", type: "payment_required" } });
      case "e500": return json(500, { error: "upstream exploded" });
      case "badmodel": return json(404, { error: { message: "Model not found: " + body.model, type: "invalid_request_error" } });
      case "hang": return; // never responds; Breakout's timeout must fire
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const base = { id: "cmpl-1", object: "chat.completion.chunk", created: 1, model: body.model };
    if (marker === "malformed") {
      res.write("data: {not json\n\n");
      res.end("data: [DONE]\n\n");
      return;
    }
    if (marker === "toolcall") {
      send({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "place_order", arguments: "{\"symbol\":\"X\"}" } }] }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      res.end("data: [DONE]\n\n");
      return;
    }
    const words = marker === "slow"
      ? Array.from({ length: 40 }, (_, i) => `w${i} `)
      : ["Hello", " from", " mock", " gateway."];
    const delay = marker === "slow" ? 100 : 30;
    send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
    for (const w of words) {
      if (res.destroyed) return;
      send({ ...base, choices: [{ index: 0, delta: { content: w }, finish_reason: null }] });
      await new Promise((r) => setTimeout(r, delay));
    }
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    send({ ...base, choices: [], usage: { prompt_tokens: 11, completion_tokens: words.length, total_tokens: 11 + words.length } });
    res.end("data: [DONE]\n\n");
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}
