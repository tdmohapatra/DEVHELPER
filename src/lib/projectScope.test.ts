import { describe, it, expect } from "vitest";
import {
  SCOPE_KINDS,
  claimedBy,
  isClaimed,
  isMember,
  membersOf,
  pruneMembers,
  scopeCounts,
  scopeItems,
  setMembers,
  toggleMember,
  totalClaims,
  type ScopedProfile,
} from "./projectScope";

const billing: ScopedProfile = { id: "p1", name: "Billing", members: { connections: ["c1"], environments: ["e1"] } };
const orders: ScopedProfile = { id: "p2", name: "Orders", members: { connections: ["c2"] } };
const profiles = [billing, orders];

const items = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
const byId = (x: { id: string }) => x.id;

describe("membersOf / isMember", () => {
  it("reads a profile's claims", () => {
    expect(membersOf(billing, "connections")).toEqual(["c1"]);
    expect(isMember(billing, "connections", "c1")).toBe(true);
    expect(isMember(billing, "connections", "c2")).toBe(false);
  });

  it("treats a profile with no claims, or none at all, as claiming nothing", () => {
    expect(membersOf({ id: "x", name: "X" }, "snippets")).toEqual([]);
    expect(isMember(undefined, "snippets", "s1")).toBe(false);
  });
});

describe("toggleMember", () => {
  it("adds a claim", () => {
    expect(toggleMember(billing, "connections", "c9").connections).toEqual(["c1", "c9"]);
  });

  it("removes one", () => {
    expect(toggleMember(billing, "connections", "c1").connections).toBeUndefined();
  });

  it("drops the kind entirely when the last claim goes, rather than leaving an empty list", () => {
    const next = toggleMember(billing, "environments", "e1");
    expect("environments" in next).toBe(false);
    expect(next.connections).toEqual(["c1"]);
  });

  it("does not mutate the profile", () => {
    toggleMember(billing, "connections", "c9");
    expect(billing.members!.connections).toEqual(["c1"]);
  });
});

describe("setMembers", () => {
  it("replaces the list and removes duplicates", () => {
    expect(setMembers(billing, "connections", ["a", "a", "b"]).connections).toEqual(["a", "b"]);
  });

  it("clearing a kind removes it", () => {
    expect("connections" in setMembers(billing, "connections", [])).toBe(false);
  });
});

describe("claimedBy / isClaimed", () => {
  it("finds every profile claiming an artefact, since claiming is not exclusive", () => {
    const shared: ScopedProfile = { id: "p3", name: "Shared", members: { connections: ["c1"] } };
    expect(claimedBy([...profiles, shared], "connections", "c1").map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("knows when nothing claims it", () => {
    expect(isClaimed(profiles, "connections", "c3")).toBe(false);
  });
});

describe("scopeItems", () => {
  it("shows everything when scoping is off", () => {
    expect(scopeItems(items, byId, "connections", profiles, "p1", false)).toHaveLength(3);
  });

  it("shows everything when no profile is active", () => {
    expect(scopeItems(items, byId, "connections", profiles, null, true)).toHaveLength(3);
  });

  it("shows what the active profile claims", () => {
    const out = scopeItems(items, byId, "connections", profiles, "p1", true);
    expect(out.map(byId)).toContain("c1");
  });

  it("keeps showing anything nobody has claimed", () => {
    // The rule that stops a scoped view from hiding everything not yet filed.
    expect(scopeItems(items, byId, "connections", profiles, "p1", true).map(byId)).toContain("c3");
  });

  it("hides what another profile claims", () => {
    expect(scopeItems(items, byId, "connections", profiles, "p1", true).map(byId)).not.toContain("c2");
  });

  it("falls back to everything when the active id matches no profile", () => {
    expect(scopeItems(items, byId, "connections", profiles, "gone", true)).toHaveLength(3);
  });

  it("does not filter a kind the profile has no claims in", () => {
    const out = scopeItems([{ id: "s1" }, { id: "s2" }], byId, "snippets", profiles, "p1", true);
    expect(out).toHaveLength(2);
  });
});

describe("scopeCounts", () => {
  it("splits a list into mine, unfiled and hidden", () => {
    expect(scopeCounts(["c1", "c2", "c3"], "connections", profiles, "p1")).toEqual({
      total: 3,
      mine: 1,
      unfiled: 1,
      hidden: 1,
    });
  });

  it("counts everything as unfiled when nothing is claimed anywhere", () => {
    expect(scopeCounts(["x", "y"], "snippets", profiles, "p1")).toMatchObject({ mine: 0, unfiled: 2, hidden: 0 });
  });
});

describe("pruneMembers", () => {
  it("drops claims on artefacts that no longer exist", () => {
    const pruned = pruneMembers(billing.members, { connections: ["c1"], environments: [] });
    expect(pruned.connections).toEqual(["c1"]);
    expect("environments" in pruned).toBe(false);
  });

  it("leaves a kind alone when the caller could not enumerate it", () => {
    const pruned = pruneMembers(billing.members, { connections: ["c1"] });
    expect(pruned.environments).toEqual(["e1"]);
  });

  it("is empty for a profile that claims nothing", () => {
    expect(pruneMembers(undefined, {})).toEqual({});
  });
});

describe("totalClaims", () => {
  it("counts across every kind", () => {
    expect(totalClaims(billing)).toBe(2);
    expect(totalClaims({ id: "x", name: "X" })).toBe(0);
  });

  it("covers every kind the app scopes", () => {
    const all: ScopedProfile = { id: "a", name: "A", members: Object.fromEntries(SCOPE_KINDS.map((k) => [k, ["x"]])) };
    expect(totalClaims(all)).toBe(SCOPE_KINDS.length);
  });
});
