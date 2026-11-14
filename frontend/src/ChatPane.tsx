// One mounted chat runtime per conversation, seeded from the server's stored
// messages. The transport sends only the new message plus the selected model
// and context; the server rebuilds history and policy itself.
import { useEffect, useMemo, useRef, type FC } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/ai-sdk";
import { DefaultChatTransport, type UIMessage } from "ai";
import { chatFetch, type TradingContext } from "./api.ts";
import { Thread } from "./Thread.tsx";

export const ChatPane: FC<{
  conversationId: string;
  initialMessages: UIMessage[];
  model: string;
  context: TradingContext | null;
  disabled: boolean;
  disabledReason?: string;
  onTurnEnd: () => void;
}> = ({ conversationId, initialMessages, model, context, disabled, disabledReason, onTurnEnd }) => {
  const modelRef = useRef(model);
  const contextRef = useRef(context);
  modelRef.current = model;
  contextRef.current = context;

  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    api: "/api/chat",
    fetch: chatFetch,
    // `id` from the runtime is assistant-ui's thread id, not ours; the server
    // authorises against the conversation this pane was mounted for.
    prepareSendMessagesRequest: ({ messages, trigger, messageId }) => ({
      body: {
        id: conversationId, trigger, messageId,
        model: modelRef.current,
        context: contextRef.current,
        message: trigger === "submit-message" ? messages.at(-1) : undefined,
      },
    }),
  }), [conversationId]);

  const runtime = useChatRuntime({ id: conversationId, messages: initialMessages, transport, onFinish: onTurnEnd });

  // Stop any in-flight response when leaving the conversation.
  useEffect(() => () => runtime.thread.cancelRun(), [runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread hasContext={context !== null} disabled={disabled} disabledReason={disabledReason} />
    </AssistantRuntimeProvider>
  );
};
