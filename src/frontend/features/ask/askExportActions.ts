import type { AskConversation, AskMessage } from "../../../types/ask";
import {
  buildAskExportFileName,
  buildAskThreadExport,
  downloadAskExport,
  formatAskThreadText,
  normalizeAskExportMessages,
} from "../../utils/askExport";
import { resolveNowMs } from "../../utils/now";

type AskExportOptions = {
  format: "json" | "text";
  selectedGuildId: string | null;
  activeConversation: AskConversation | null;
  displayMessages: AskMessage[];
  canExport: boolean;
};

export const exportAskThread = ({
  format,
  selectedGuildId,
  activeConversation,
  displayMessages,
  canExport,
}: AskExportOptions) => {
  if (!selectedGuildId || !activeConversation || !canExport) return;
  const nowIso = new Date(resolveNowMs()).toISOString();
  const exportMessages = normalizeAskExportMessages(displayMessages);
  const payload = buildAskThreadExport({
    serverId: selectedGuildId,
    conversation: activeConversation,
    messages: exportMessages,
    exportedAt: nowIso,
  });

  if (format === "json") {
    const json = JSON.stringify(payload, null, 2);
    downloadAskExport(
      json,
      buildAskExportFileName({
        title: activeConversation.title,
        exportedAt: nowIso,
        extension: "json",
      }),
      "application/json",
    );
    return;
  }
  const text = formatAskThreadText({
    conversation: activeConversation,
    messages: exportMessages,
    exportedAt: nowIso,
  });
  downloadAskExport(
    text,
    buildAskExportFileName({
      title: activeConversation.title,
      exportedAt: nowIso,
      extension: "txt",
    }),
    "text/plain",
  );
};
