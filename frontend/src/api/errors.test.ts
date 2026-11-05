import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES, messageForStatus } from "./errors";

describe("messageForStatus", () => {
  it.each([
    [undefined, ERROR_MESSAGES.network],
    [400, ERROR_MESSAGES.badRequest],
    [401, ERROR_MESSAGES.sessionExpired],
    [403, ERROR_MESSAGES.forbidden],
    [404, ERROR_MESSAGES.notFound],
    [429, ERROR_MESSAGES.tooManyRequests],
    [500, ERROR_MESSAGES.server],
    [503, ERROR_MESSAGES.server],
    [418, ERROR_MESSAGES.unknown],
  ])("%s -> its own clear message", (status, message) => {
    expect(messageForStatus(status)).toBe(message);
  });
});
