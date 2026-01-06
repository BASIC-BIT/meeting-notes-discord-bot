import { PublicAskView } from "../features/ask/PublicAskView";
import { usePublicAskState } from "../features/ask/usePublicAskState";

export default function PublicAsk() {
  const state = usePublicAskState();

  return (
    <PublicAskView
      conversation={state.conversation}
      messages={state.messages}
      sharedMeta={state.sharedMeta}
      isLoading={state.isLoading}
      hasError={state.hasError}
      highlightedMessageId={state.highlightedMessageId}
    />
  );
}
