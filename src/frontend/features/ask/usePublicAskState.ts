import { useParams, useSearch } from "@tanstack/react-router";
import { trpc } from "../../services/trpc";
import type {
  AskConversation,
  AskMessage,
  AskSharedConversation,
} from "../../../types/ask";

type PublicAskState = {
  conversation: AskConversation | null;
  messages: AskMessage[];
  sharedMeta: AskSharedConversation | null;
  isLoading: boolean;
  hasError: boolean;
  highlightedMessageId: string | null;
};

export const usePublicAskState = (): PublicAskState => {
  const params = useParams({ strict: false }) as {
    serverId?: string;
    conversationId?: string;
  };
  const search = useSearch({ strict: false }) as {
    messageId?: string;
  };
  const highlightedMessageId = search.messageId ?? null;

  const query = trpc.ask.getPublicConversation.useQuery(
    {
      serverId: params.serverId ?? "",
      conversationId: params.conversationId ?? "",
    },
    { enabled: Boolean(params.serverId && params.conversationId) },
  );

  return {
    conversation: query.data?.conversation ?? null,
    messages: query.data?.messages ?? [],
    sharedMeta: query.data?.shared ?? null,
    isLoading: query.isLoading,
    hasError: Boolean(query.error),
    highlightedMessageId,
  };
};
