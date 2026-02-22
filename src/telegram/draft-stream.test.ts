import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTelegramDraftStream, type TelegramDraftStreamTransport } from "./draft-stream.js";

function createMockTransport(
  sendImpl?: () => Promise<{ messageId: number }>,
): TelegramDraftStreamTransport & {
  send: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    send: vi.fn(sendImpl ?? (async () => ({ messageId: 17 }))),
    edit: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createTelegramDraftStream", () => {
  it("sends stream preview message via transport", async () => {
    const transport = createMockTransport();
    const stream = createTelegramDraftStream({ transport });

    stream.update("Hello");
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledWith("Hello"));
  });

  it("edits existing stream preview message on subsequent updates", async () => {
    const transport = createMockTransport();
    const stream = createTelegramDraftStream({ transport });

    stream.update("Hello");
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledWith("Hello"));
    await (transport.send.mock.results[0]?.value as Promise<unknown>);

    stream.update("Hello again");
    await stream.flush();

    expect(transport.edit).toHaveBeenCalledWith(17, "Hello again");
  });

  it("waits for in-flight updates before final flush edit", async () => {
    let resolveSend: ((value: { messageId: number }) => void) | undefined;
    const firstSend = new Promise<{ messageId: number }>((resolve) => {
      resolveSend = resolve;
    });
    const transport = createMockTransport(() => firstSend);
    const stream = createTelegramDraftStream({ transport });

    stream.update("Hello");
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledTimes(1));
    stream.update("Hello final");
    const flushPromise = stream.flush();
    expect(transport.edit).not.toHaveBeenCalled();

    resolveSend?.({ messageId: 17 });
    await flushPromise;

    expect(transport.edit).toHaveBeenCalledWith(17, "Hello final");
  });

  it("clears preview on cleanup via transport.delete", async () => {
    const transport = createMockTransport();
    const stream = createTelegramDraftStream({ transport });

    stream.update("Hello");
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledWith("Hello"));
    await (transport.send.mock.results[0]?.value as Promise<unknown>);
    await stream.clear();

    expect(transport.delete).toHaveBeenCalledWith(17);
  });

  it("creates new message after forceNewMessage is called", async () => {
    const transport: TelegramDraftStreamTransport & {
      send: ReturnType<typeof vi.fn>;
      edit: ReturnType<typeof vi.fn>;
    } = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ messageId: 17 })
        .mockResolvedValueOnce({ messageId: 42 }),
      edit: vi.fn().mockResolvedValue(undefined),
    };
    const stream = createTelegramDraftStream({ transport });

    // First message
    stream.update("Hello");
    await stream.flush();
    expect(transport.send).toHaveBeenCalledTimes(1);

    // Normal edit (same message)
    stream.update("Hello edited");
    await stream.flush();
    expect(transport.edit).toHaveBeenCalledWith(17, "Hello edited");

    // Force new message (e.g. after thinking block ends)
    stream.forceNewMessage();
    stream.update("After thinking");
    await stream.flush();

    // Should have sent a second new message, not edited the first
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(transport.send).toHaveBeenLastCalledWith("After thinking");
  });
});

describe("draft stream initial message debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isFinal has highest priority", () => {
    it("sends immediately on stop() even with 1 character", async () => {
      const transport = createMockTransport(async () => ({ messageId: 42 }));
      const stream = createTelegramDraftStream({
        transport,
        minInitialChars: 30,
      });

      stream.update("Y");
      await stream.stop();
      await stream.flush();

      expect(transport.send).toHaveBeenCalledWith("Y");
    });

    it("sends immediately on stop() with short sentence", async () => {
      const transport = createMockTransport(async () => ({ messageId: 42 }));
      const stream = createTelegramDraftStream({
        transport,
        minInitialChars: 30,
      });

      stream.update("Ok.");
      await stream.stop();
      await stream.flush();

      expect(transport.send).toHaveBeenCalledWith("Ok.");
    });
  });

  describe("minInitialChars threshold", () => {
    it("does not send first message below threshold", async () => {
      const transport = createMockTransport(async () => ({ messageId: 42 }));
      const stream = createTelegramDraftStream({
        transport,
        minInitialChars: 30,
      });

      stream.update("Processing"); // 10 chars, below 30
      await stream.flush();

      expect(transport.send).not.toHaveBeenCalled();
    });

    it("sends first message when reaching threshold", async () => {
      const transport = createMockTransport(async () => ({ messageId: 42 }));
      const stream = createTelegramDraftStream({
        transport,
        minInitialChars: 30,
      });

      // Exactly 30 chars
      stream.update("I am processing your request..");
      await stream.flush();

      expect(transport.send).toHaveBeenCalled();
    });

    it("works with longer text above threshold", async () => {
      const transport = createMockTransport(async () => ({ messageId: 42 }));
      const stream = createTelegramDraftStream({
        transport,
        minInitialChars: 30,
      });

      stream.update("I am processing your request, please wait a moment"); // 50 chars
      await stream.flush();

      expect(transport.send).toHaveBeenCalled();
    });
  });

  describe("subsequent updates after first message", () => {
    it("edits normally after first message is sent", async () => {
      const transport = createMockTransport(async () => ({ messageId: 42 }));
      const stream = createTelegramDraftStream({
        transport,
        minInitialChars: 30,
      });

      // First message at threshold (30 chars)
      stream.update("I am processing your request..");
      await stream.flush();
      expect(transport.send).toHaveBeenCalledTimes(1);

      // Subsequent updates should edit, not wait for threshold
      stream.update("I am processing your request.. and summarizing");
      await stream.flush();

      expect(transport.edit).toHaveBeenCalled();
      expect(transport.send).toHaveBeenCalledTimes(1); // still only 1 send
    });
  });

  describe("default behavior without debounce params", () => {
    it("sends immediately without minInitialChars set (backward compatible)", async () => {
      const transport = createMockTransport(async () => ({ messageId: 42 }));
      const stream = createTelegramDraftStream({ transport });

      stream.update("Hi");
      await stream.flush();

      expect(transport.send).toHaveBeenCalledWith("Hi");
    });
  });
});
