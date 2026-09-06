import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultSave,
  Expedition,
  purchaseUpgrade,
} from "../src/core/engine";
import { SaveStore } from "../src/core/storage";
import type { SaveData } from "../src/core/types";
let sequence = 0;
const store = () => new SaveStore(`test-pelagia-${sequence++}`);
const runFor = (save: SaveData) => new Expedition("reef", 23, save.equipment);

describe("atomic browser save transactions", () => {
  it("creates the initial profile and round trips base layout/settings without a server", async () => {
    const db = store(),
      { save, abandoned } = await db.load();
    expect(abandoned).toBe(false);
    save.placements[0].x = 6;
    save.settings.muted = true;
    await db.write(save);
    const restored = await db.load();
    expect(restored.save.placements).toEqual(save.placements);
    expect(restored.save.settings.muted).toBe(true);
    expect(db.import(db.export(save))).toMatchObject({
      ...save,
      updatedAt: expect.any(Number),
    });
  });
  it("saves snapshots so mutations after writing cannot alter the queued record", async () => {
    const db = store(),
      { save } = await db.load();
    save.stock.scrap = 5;
    const writing = db.write(save);
    save.stock.scrap = 99;
    await writing;
    expect((await db.load()).save.stock.scrap).toBe(5);
  });
  it("adds extraction cargo exactly once, even with simultaneous duplicate settlement calls", async () => {
    const db = store(),
      { save } = await db.load(),
      run = runFor(save);
    await db.beginRun(save, run.state.id);
    await db.recordScan(save, "clownfish");
    run.state.cargo = [
      { id: "scrap", count: 10 },
      { id: "specimen:clownfish", count: 1 },
    ];
    run.state.elapsed = 65;
    run.state.kills = 2;
    run.state.phase = "extracted";
    await Promise.all([
      db.finishRun(save, run.state),
      db.finishRun(save, run.state),
    ]);
    expect(save.stock).toEqual({ scrap: 10, "specimen:clownfish": 1 });
    expect(save.stats).toMatchObject({
      dives: 1,
      returns: 1,
      deaths: 0,
      kills: 2,
      playSeconds: 65,
    });
    expect(save.activeRunId).toBeNull();
    expect(save.settledRuns).toEqual([run.state.id]);
    expect(save.scanned).toEqual(["clownfish"]);
    expect((await db.load()).save).toEqual(save);
  });
  it("deduplicates settlement across separate connections as well", async () => {
    const name = `shared-${sequence++}`,
      db1 = new SaveStore(name),
      db2 = new SaveStore(name),
      { save } = await db1.load(),
      run = runFor(save);
    await db1.beginRun(save, run.state.id);
    const otherSave = JSON.parse(JSON.stringify(save)) as SaveData;
    run.state.phase = "extracted";
    run.state.cargo = [{ id: "mineral", count: 3 }];
    await Promise.all([
      db1.finishRun(save, run.state),
      db2.finishRun(otherSave, run.state),
    ]);
    const final = (await db1.load()).save;
    expect(final.stock.mineral).toBe(3);
    expect(final.stats.returns).toBe(1);
  });
  it("loses only this expedition cargo on death while keeping scans, equipment and old stock", async () => {
    const db = store(),
      { save } = await db.load();
    save.stock.scrap = 7;
    save.equipment.oxygen = 1;
    await db.write(save);
    const run = runFor(save);
    await db.beginRun(save, run.state.id);
    await db.recordScan(save, "seahorse");
    run.state.cargo = [
      { id: "blueprintReef", count: 1 },
      { id: "scrap", count: 12 },
    ];
    run.state.phase = "dead";
    await db.finishRun(save, run.state);
    expect(save.stock).toEqual({ scrap: 7 });
    expect(save.scanned).toEqual(["seahorse"]);
    expect(save.equipment.oxygen).toBe(1);
    expect(save.decorations).toContain("seaweedPot");
    expect(save.stats.deaths).toBe(1);
    expect(
      new Expedition("reef", 44, save.equipment).state.pickups.some(
        (p) => p.item === "blueprintReef",
      ),
    ).toBe(true);
  });
  it("turns a refreshed/abandoned dive into one failure while preserving its saved scans", async () => {
    const db = store(),
      { save } = await db.load(),
      run = runFor(save);
    save.stock.fiber = 9;
    await db.beginRun(save, run.state.id);
    await db.recordScan(save, "turtle");
    const reloaded = await db.load();
    expect(reloaded.abandoned).toBe(true);
    expect(reloaded.save.activeRunId).toBeNull();
    expect(reloaded.save.stats.deaths).toBe(1);
    expect(reloaded.save.stock.fiber).toBe(9);
    expect(reloaded.save.scanned).toEqual(["turtle"]);
    const again = await db.load();
    expect(again.abandoned).toBe(false);
    expect(again.save.stats.deaths).toBe(1);
  });
  it("keeps the final discovery permanently even when that dive is lost", async () => {
    const db = store(),
      { save } = await db.load();
    save.equipment.suit = 2;
    const run = new Expedition("abyss", 99, save.equipment);
    await db.beginRun(save, run.state.id);
    await db.recordScan(save, "glowray");
    run.state.phase = "dead";
    await db.finishRun(save, run.state);
    expect(save.completed).toBe(true);
    expect(save.decorations).toContain("discoveryTrophy");
    expect((await db.load()).save.completed).toBe(true);
  });
  it.each(["extracted", "dead"] as const)(
    "recovers a failed final-discovery write during %s settlement without duplicating rewards",
    async (phase) => {
      const db = store(),
        { save } = await db.load();
      save.equipment.suit = 2;
      save.stock.scrap = 7;
      const run = new Expedition("abyss", 99, save.equipment);
      await db.beginRun(save, run.state.id);
      await db.recordScan(save, "clownfish");
      const inMemory = structuredClone(save);
      // Preserve a newer durable discovery as well as the failed in-memory discovery.
      await db.recordScan(save, "turtle");
      const failingWrite = vi
        .spyOn(db, "write")
        .mockRejectedValueOnce(
          new DOMException("Temporary write failure", "QuotaExceededError"),
        );
      await expect(db.recordScan(inMemory, "glowray")).rejects.toThrow(
        "Temporary write failure",
      );
      failingWrite.mockRestore();
      expect(inMemory.completed).toBe(true);
      run.state.phase = phase;
      run.state.cargo = [{ id: "scrap", count: 5 }];
      run.state.elapsed = 42;
      run.state.kills = 1;
      await Promise.all([
        db.finishRun(inMemory, run.state),
        db.finishRun(inMemory, run.state),
      ]);
      const restored = (await db.load()).save;
      expect(restored.scanned).toEqual(["clownfish", "turtle", "glowray"]);
      expect(restored.completed).toBe(true);
      expect(restored.decorations).toContain("discoveryTrophy");
      expect(restored.decorations).toContain("seaweedPot");
      expect(restored.stock.scrap).toBe(phase === "extracted" ? 12 : 7);
      expect(restored.stats).toMatchObject({
        dives: 1,
        returns: phase === "extracted" ? 1 : 0,
        deaths: phase === "dead" ? 1 : 0,
        kills: 1,
        playSeconds: 42,
      });
      expect(restored.activeRunId).toBeNull();
      expect(restored.settledRuns).toEqual([run.state.id]);
      expect(inMemory).toEqual(restored);
    },
  );
  it("checks run state before settling or beginning again", async () => {
    const db = store(),
      { save } = await db.load(),
      run = runFor(save);
    await expect(db.finishRun(save, run.state)).rejects.toThrow("진행");
    await db.beginRun(save, run.state.id);
    await expect(db.beginRun(save, "another")).rejects.toThrow("진행");
    run.state.id = "unregistered";
    run.state.phase = "extracted";
    await expect(db.finishRun(save, run.state)).rejects.toThrow("일치");
  });
  it("supports the required equipment progression from banked hunt returns", async () => {
    const db = store(),
      { save } = await db.load();
    for (const cargo of [
      [
        { id: "blueprintReef", count: 1 },
        { id: "shell", count: 4 },
        { id: "scrap", count: 20 },
        { id: "fiber", count: 6 },
      ],
      [
        { id: "scrap", count: 12 },
        { id: "mineral", count: 8 },
      ],
    ] as const) {
      const run = runFor(save);
      await db.beginRun(save, run.state.id);
      run.state.cargo = cargo.map((i) => ({ ...i }));
      run.state.phase = "extracted";
      await db.finishRun(save, run.state);
    }
    expect(purchaseUpgrade(save, "suit1").ok).toBe(true);
    expect(purchaseUpgrade(save, "cutter").ok).toBe(true);
    await db.write(save);
    const wreck = new Expedition("wreck", 55, save.equipment);
    await db.beginRun(save, wreck.state.id);
    wreck.state.cargo = [
      { id: "blueprintDeep", count: 1 },
      { id: "fang", count: 4 },
      { id: "scrap", count: 18 },
      { id: "mineral", count: 12 },
    ];
    wreck.state.phase = "extracted";
    await db.finishRun(save, wreck.state);
    expect(purchaseUpgrade(save, "suit2").ok).toBe(true);
    await db.write(save);
    expect((await db.load()).save.equipment.suit).toBe(2);
  });
});

describe("save file validation", () => {
  it("rejects malformed JSON, unsupported versions, unsafe amounts, fake species and illegal layouts", () => {
    const db = store();
    expect(() => db.import("{")).toThrow();
    expect(() => db.import("null")).toThrow();
    expect(() => db.import("{}")).toThrow();
    const cases: ((s: SaveData) => void)[] = [
      (s) => {
        (s as unknown as { version: number }).version = 2;
      },
      (s) => {
        s.stock.scrap = -1;
      },
      (s) => {
        s.stock.scrap = 1.5;
      },
      (s) => {
        (s.stock as Record<string, number>).cash = 5;
      },
      (s) => {
        s.equipment.suit = 99;
      },
      (s) => {
        s.scanned = ["ghost" as never];
      },
      (s) => {
        s.displayed = ["turtle"];
      },
      (s) => {
        s.completed = true;
      },
      (s) => {
        s.placements[0].x = 100;
      },
      (s) => {
        s.placements[1].x = 6;
        s.placements[1].y = 1;
      },
      (s) => {
        s.scanned = ["clownfish", "clownfish"];
      },
      (s) => {
        s.decorations.push("seaweedPot");
        s.placements.push({ uid: "locked", id: "seaweedPot", x: 0, y: 0 });
      },
    ];
    for (const change of cases) {
      const save = createDefaultSave();
      change(save);
      expect(() => db.import(JSON.stringify(save))).toThrow();
    }
  });
  it("imports an active-run export into the base with the incomplete run discarded", () => {
    const db = store(),
      save = createDefaultSave();
    save.activeRunId = "interrupted";
    save.stats.dives = 1;
    const imported = db.import(db.export(save));
    expect(imported.activeRunId).toBeNull();
    expect(imported.stats.deaths).toBe(1);
    expect(imported.settledRuns).toContain("interrupted");
  });
});
