// Conversation thread built from assistant-ui primitives (MIT,
// https://github.com/assistant-ui/assistant-ui). Styling is Breakout's own.
import type { FC } from "react";
import {
  ThreadPrimitive, MessagePrimitive, ComposerPrimitive, ActionBarPrimitive, ErrorPrimitive,
  AuiIf, useAuiState, type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";

// Links open safely; react-markdown already refuses raw HTML and unsafe URLs.
const SafeLink: FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = ({ href, children }) =>
  href && /^https?:\/\//i.test(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
    : <span>{children}</span>;

const MarkdownText: FC = () => (
  <MarkdownTextPrimitive className="md" remarkPlugins={[remarkGfm]} components={{ a: SafeLink }} smooth />
);

// Generic tool activity card. No tool is enabled in Release 1; this exists so
// a tool call (expected or not) is always visible rather than silent.
const ToolCard: FC<ToolCallMessagePartProps> = ({ toolName, status, result }) => {
  const state = status.type === "running" ? "Running" : status.type === "incomplete" ? "Failed" : "Complete";
  return (
    <div className={`tool-card tool-${status.type}`}>
      <div className="tool-head">
        <span className="tool-icon" aria-hidden>⚙</span>
        <code>{toolName}</code>
        <span className="tool-state">{state}</span>
      </div>
      {result !== undefined && (
        <details><summary>Result (from server)</summary><pre>{JSON.stringify(result, null, 2).slice(0, 4000)}</pre></details>
      )}
    </div>
  );
};

type Custom = { model?: string; status?: "complete" | "aborted" | "error"; error?: string };

const AssistantMeta: FC = () => {
  const custom = useAuiState((s) => s.message.metadata.custom) as Custom | undefined;
  const running = useAuiState((s) => s.message.status?.type === "running");
  return (
    <div className="msg-meta">
      {custom?.model && <span className="model-chip" title="Model that produced this answer">{custom.model}</span>}
      <span className="ai-label" title="General AI analysis. Not a TradeOS decision.">AI analysis · not a TradeOS decision</span>
      {!running && custom?.status === "aborted" && <span className="flag flag-warn">Interrupted — response incomplete</span>}
      {!running && custom?.status === "error" && (
        <span className="flag flag-err" role="alert">Response failed{custom.error ? ` — ${custom.error}` : ""}</span>
      )}
    </div>
  );
};

const UserMessage: FC = () => (
  <MessagePrimitive.Root className="msg msg-user">
    <div className="bubble"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>
);

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root className="msg msg-assistant">
    <AssistantMeta />
    {/* A stored failed turn has no content; its reason is shown in the meta row. */}
    <AuiIf condition={(s) => s.message.content.length > 0 || s.message.status?.type !== "complete"}>
      <div className="answer">
        <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolCard } }} />
        <AuiIf condition={(s) => s.message.status?.type === "running" && s.message.content.length === 0}>
          <div className="typing" aria-label="Generating"><i /><i /><i /></div>
        </AuiIf>
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="error-box" role="alert"><ErrorPrimitive.Message /></ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
    </AuiIf>
    <ActionBarPrimitive.Root className="actions" hideWhenRunning autohide="not-last">
      <ActionBarPrimitive.Copy className="act">Copy</ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload className="act">Retry</ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>
);

const Empty: FC<{ hasContext: boolean }> = ({ hasContext }) => (
  <div className="empty">
    <h2>Trading Copilot</h2>
    <p>Ask about concepts, setups, risk and your trading process. Answers are general AI analysis.</p>
    <p className="muted">
      Each message carries the read-only TradeOS evidence shown in the evidence panel, with its freshness. Official TradeOS decisions and broker data are not connected.
      {hasContext ? "" : " Select an instrument above to give the Copilot context."}
    </p>
  </div>
);

export const Thread: FC<{ hasContext: boolean; disabled: boolean; disabledReason?: string }> = ({ hasContext, disabled, disabledReason }) => (
  <ThreadPrimitive.Root className="thread">
    <ThreadPrimitive.Viewport className="viewport">
      <AuiIf condition={(s) => s.thread.isEmpty}><Empty hasContext={hasContext} /></AuiIf>
      <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      <ThreadPrimitive.ViewportFooter className="composer-wrap">
        {disabled && <div className="notice" role="status">{disabledReason}</div>}
        <ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input
            className="composer-input" rows={1} autoFocus disabled={disabled}
            placeholder="Ask the Copilot…  (Enter to send, Shift+Enter for a new line)" submitMode="enter"
          />
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send className="btn btn-primary" disabled={disabled}>Send</ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel className="btn btn-stop">Stop</ComposerPrimitive.Cancel>
          </AuiIf>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>
);
