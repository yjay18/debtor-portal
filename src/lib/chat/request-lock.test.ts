import { expect, it } from "vitest";

import { acquireRequestLock, releaseRequestLock } from "./request-lock";

it("allows only one request until the synchronous lock is released", () => {
  const lock = { current: false };

  expect(acquireRequestLock(lock)).toBe(true);
  expect(acquireRequestLock(lock)).toBe(false);
  releaseRequestLock(lock);
  expect(acquireRequestLock(lock)).toBe(true);
});
