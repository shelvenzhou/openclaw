import { markdownToTelegramHtmlChunks } from "../../../telegram/format.js";
import {
  parseTelegramReplyToMessageId,
  parseTelegramThreadId,
} from "../../../telegram/outbound-params.js";
import { sendMessageTelegram, type MuxTransportOpts } from "../../../telegram/send.js";
import { type TelegramButtons } from "../mux-envelope.js";
import type { ChannelOutboundAdapter } from "../types.js";
import { isMuxEnabled } from "./mux.js";

function resolveMuxOpts(params: {
  cfg: Parameters<typeof isMuxEnabled>[0]["cfg"];
  accountId?: string | null;
  sessionKey?: string | null;
}): MuxTransportOpts | undefined {
  if (
    !isMuxEnabled({
      cfg: params.cfg,
      channel: "telegram",
      accountId: params.accountId ?? undefined,
    })
  ) {
    return undefined;
  }
  return { cfg: params.cfg, sessionKey: params.sessionKey ?? "" };
}

export const telegramOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: markdownToTelegramHtmlChunks,
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId, deps, replyToId, threadId, sessionKey }) => {
    const replyToMessageId = parseTelegramReplyToMessageId(replyToId);
    const messageThreadId = parseTelegramThreadId(threadId);
    const mux = resolveMuxOpts({ cfg, accountId, sessionKey });
    const send = deps?.sendTelegram ?? sendMessageTelegram;
    const result = await send(to, text, {
      verbose: false,
      textMode: "html",
      messageThreadId,
      replyToMessageId,
      accountId: accountId ?? undefined,
      mux,
    });
    return { channel: "telegram", ...result };
  },
  sendMedia: async ({
    cfg,
    to,
    text,
    mediaUrl,
    mediaLocalRoots,
    accountId,
    deps,
    replyToId,
    threadId,
    sessionKey,
  }) => {
    const replyToMessageId = parseTelegramReplyToMessageId(replyToId);
    const messageThreadId = parseTelegramThreadId(threadId);
    const mux = resolveMuxOpts({ cfg, accountId, sessionKey });
    const send = deps?.sendTelegram ?? sendMessageTelegram;
    const result = await send(to, text, {
      verbose: false,
      mediaUrl,
      textMode: "html",
      messageThreadId,
      replyToMessageId,
      accountId: accountId ?? undefined,
      mediaLocalRoots,
      mux,
    });
    return { channel: "telegram", ...result };
  },
  sendPayload: async ({
    cfg,
    to,
    payload,
    mediaLocalRoots,
    accountId,
    deps,
    replyToId,
    threadId,
    sessionKey,
  }) => {
    const replyToMessageId = parseTelegramReplyToMessageId(replyToId);
    const messageThreadId = parseTelegramThreadId(threadId);
    const telegramData = payload.channelData?.telegram as
      | { buttons?: TelegramButtons; quoteText?: string }
      | undefined;
    const quoteText =
      typeof telegramData?.quoteText === "string" ? telegramData.quoteText : undefined;
    const text = payload.text ?? "";
    const mediaUrls = payload.mediaUrls?.length
      ? payload.mediaUrls
      : payload.mediaUrl
        ? [payload.mediaUrl]
        : [];

    const mux = resolveMuxOpts({ cfg, accountId, sessionKey });
    const send = deps?.sendTelegram ?? sendMessageTelegram;
    const baseOpts = {
      verbose: false,
      textMode: "html" as const,
      messageThreadId,
      replyToMessageId,
      quoteText,
      accountId: accountId ?? undefined,
      mediaLocalRoots,
      mux,
    };

    if (mediaUrls.length === 0) {
      const result = await send(to, text, {
        ...baseOpts,
        buttons: telegramData?.buttons,
      });
      return { channel: "telegram", ...result };
    }

    // Telegram allows reply_markup on media; attach buttons only to first send.
    let finalResult: Awaited<ReturnType<typeof send>> | undefined;
    for (let i = 0; i < mediaUrls.length; i += 1) {
      const mediaUrl = mediaUrls[i];
      const isFirst = i === 0;
      finalResult = await send(to, isFirst ? text : "", {
        ...baseOpts,
        mediaUrl,
        ...(isFirst ? { buttons: telegramData?.buttons } : {}),
      });
    }
    return { channel: "telegram", ...(finalResult ?? { messageId: "unknown", chatId: to }) };
  },
};
