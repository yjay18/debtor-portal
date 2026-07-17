import { describe, expect, it, vi } from "vitest";

import type { RelatedPerson } from "@/lib/account/types";
import { resolveRelatedPerson } from "./disambiguate";

const people: RelatedPerson[] = [
  { id: "person-001", name: "John Murphy", email: "john@example.test", phone: "+353831111111", authorizedToAct: false },
  { id: "person-002", name: "John Moran", email: "moran@example.test", phone: "+353832222222", authorizedToAct: false },
];

describe("resolveRelatedPerson", () => {
  it("resolves one deterministic name match without calling the fallback", async () => {
    const fallback = vi.fn();
    await expect(resolveRelatedPerson({ selector: "John Murphy", people, fallback }))
      .resolves.toMatchObject({ status: "resolved", person: { id: "person-001" } });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("clarifies instead of choosing between several deterministic matches", async () => {
    await expect(resolveRelatedPerson({ selector: "John", people, fallback: vi.fn() }))
      .resolves.toMatchObject({ status: "ambiguous", people: [{ id: "person-001" }, { id: "person-002" }] });
  });

  it("passes only bounded sanitized candidates to the fallback and verifies its returned ID", async () => {
    const fallback = vi.fn().mockResolvedValue("person-002");
    const result = await resolveRelatedPerson({
      selector: "my cousin",
      people: [{ ...people[0], name: `Mark\n${"x".repeat(100)}` }, people[1]],
      fallback,
    });

    expect(result).toMatchObject({ status: "resolved", person: { id: "person-002" } });
    expect(fallback).toHaveBeenCalledWith(expect.objectContaining({
      candidates: expect.arrayContaining([expect.objectContaining({ name: expect.stringMatching(/^Mark x/) })]),
    }));
    expect(fallback.mock.calls[0][0].candidates.every((candidate: { id: string; name: string }) => candidate.id.length <= 64 && candidate.name.length <= 64)).toBe(true);
  });

  it("fails closed when a fallback returns an ID outside the candidate list", async () => {
    await expect(resolveRelatedPerson({ selector: "my cousin", people, fallback: vi.fn().mockResolvedValue("other-account") }))
      .resolves.toEqual({ status: "not_found" });
  });
});
