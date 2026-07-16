import { afterEach, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({ createClient }));

import { createServerSupabaseClient } from "./server";

function setValidEnvironment() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-server-key");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"])(
  "rejects a missing %s",
  (missingName) => {
    setValidEnvironment();
    vi.stubEnv(missingName, "");

    expect(() => createServerSupabaseClient()).toThrow(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.",
    );
  },
);

it("rejects use in a browser", () => {
  setValidEnvironment();
  vi.stubGlobal("window", {});

  expect(() => createServerSupabaseClient()).toThrow(
    "The Supabase secret client can only run on the server.",
  );
});

it("creates a non-persistent server client", () => {
  setValidEnvironment();
  createServerSupabaseClient();

  expect(createClient).toHaveBeenCalledWith(
    "https://project.supabase.co",
    "test-server-key",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
});
