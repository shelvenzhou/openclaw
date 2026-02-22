import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { telegramPlugin } from "./channel.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("telegram extension mux outbound sendPayload", () => {
  it("telegram sendPayload passes buttons and mux opts through to sendTelegram", async () => {
    const sendTelegram = vi.fn().mockResolvedValue({
      messageId: "mx-tg-1",
      chatId: "tg-chat-1",
    });

    const cfg = {
      gateway: {
        http: {
          endpoints: {
            mux: {
              baseUrl: "http://mux.local",
              registerKey: "test-register-key",
              inboundUrl: "http://openclaw.local/v1/mux/inbound",
            },
          },
        },
      },
      channels: {
        telegram: {
          accounts: {
            mux: {
              mux: {
                enabled: true,
              },
            },
          },
        },
      },
    } as OpenClawConfig;

    const result = await telegramPlugin.outbound?.sendPayload?.({
      cfg,
      to: "telegram:123",
      text: "ignored",
      accountId: "mux",
      sessionKey: "sess-tg",
      deps: { sendTelegram },
      payload: {
        text: "hello",
        channelData: {
          telegram: {
            buttons: [[{ text: "Next", callback_data: "commands_page_2:main" }]],
          },
        },
      },
    });

    expect(result).toMatchObject({ channel: "telegram", messageId: "mx-tg-1" });
    expect(sendTelegram).toHaveBeenCalledOnce();
    expect(sendTelegram).toHaveBeenCalledWith(
      "telegram:123",
      "hello",
      expect.objectContaining({
        mux: { cfg, sessionKey: "sess-tg" },
        buttons: [[{ text: "Next", callback_data: "commands_page_2:main" }]],
      }),
    );
  });
});
