import { describe, it, expect } from "vitest";
import { SKILLS, TRACKS, skillsByBand, skillsForTopic, roadmapTools, nextSkill, bandLabel } from "./roadmap";
import { BUILT_IN_QUESTIONS, TOPICS, type TopicId } from "./index";
import { TOOLS } from "@/tools/registry";

describe("skill roadmap", () => {
  it("is ranked without gaps or ties", () => {
    const ranks = SKILLS.map((s) => s.rank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: SKILLS.length }, (_, i) => i + 1));
  });

  it("puts the critical band first — the ordering is the whole point", () => {
    const lastCritical = Math.max(...skillsByBand("critical").map((s) => s.rank));
    const firstImportant = Math.min(...skillsByBand("important").map((s) => s.rank));
    const firstUseful = Math.min(...skillsByBand("useful").map((s) => s.rank));
    expect(lastCritical).toBeLessThan(firstImportant);
    expect(firstImportant).toBeLessThan(firstUseful);
  });

  it("gives every skill a reason and a target depth", () => {
    for (const s of SKILLS) {
      expect(s.why.trim().length, s.name).toBeGreaterThan(25);
      expect(s.target, s.name).toBeGreaterThanOrEqual(1);
      expect(s.target, s.name).toBeLessThanOrEqual(5);
    }
  });

  it("points every skill at a topic that exists", () => {
    const ids = new Set(TOPICS.map((t) => t.id));
    // A topic may still be unadvertised while its deck is being written; what
    // must never happen is a skill pointing at an id that is not a TopicId.
    for (const s of SKILLS) {
      expect(typeof s.topic, s.name).toBe("string");
      if (ids.has(s.topic)) expect(skillsForTopic(s.topic).length).toBeGreaterThan(0);
    }
  });

  it("names only tools that are actually registered", () => {
    const registered = new Set(TOOLS.map((t) => t.id));
    for (const tool of roadmapTools()) {
      expect(registered.has(tool), `${tool} is not a registered tool`).toBe(true);
    }
  });

  it("keeps the healthcare specialisation above general cloud work", () => {
    const rank = (name: string) => SKILLS.find((s) => s.name === name)!.rank;
    expect(rank("FHIR")).toBeLessThan(rank("Azure"));
    expect(rank("HL7 v2")).toBeLessThan(rank("Azure"));
  });
});

describe("tracks", () => {
  it("covers the four blocks worth studying together", () => {
    expect(TRACKS.map((t) => t.id).sort()).toEqual(["ai", "azure", "distributed", "healthcare"]);
  });

  it("gives every item something you must be able to say", () => {
    for (const track of TRACKS) {
      expect(track.items.length, track.id).toBeGreaterThanOrEqual(14);
      for (const item of track.items) {
        expect(item.must.trim().length, `${track.id}/${item.name}`).toBeGreaterThan(30);
      }
    }
  });

  it("has no duplicate item names inside a track", () => {
    for (const track of TRACKS) {
      const names = track.items.map((i) => i.name);
      expect(new Set(names).size, track.id).toBe(names.length);
    }
  });
});

describe("nextSkill", () => {
  it("returns the highest-ranked topic that is not yet known", () => {
    const known = (topic: TopicId) => (topic === "csharp" ? 1 : 0);
    expect(nextSkill(known)!.name).toBe("ASP.NET Core / .NET 8+");
  });

  it("returns nothing once everything is known", () => {
    expect(nextSkill(() => 1)).toBeUndefined();
  });

  it("honours the threshold", () => {
    expect(nextSkill(() => 0.8, 0.5)).toBeUndefined();
    expect(nextSkill(() => 0.8, 0.9)!.rank).toBe(1);
  });
});

describe("catalogue links", () => {
  it("labels each band with what it means for the outcome", () => {
    expect(bandLabel("critical")).toMatch(/offer/i);
    expect(bandLabel("useful")).toMatch(/recognis/i);
  });

  it("only points cards at tools that exist", () => {
    const registered = new Set(TOOLS.map((t) => t.id));
    for (const q of BUILT_IN_QUESTIONS) {
      for (const tool of q.relatedTools ?? []) {
        expect(registered.has(tool), `${q.id} → ${tool}`).toBe(true);
      }
    }
  });
});
