import { describe, expect, it } from "vitest";
import { BIOMES, DECORATIONS, SPECIES_BY_ID, UPGRADES } from "../src/core/data";
import {
  canPlace,
  cargoWeight,
  createDefaultSave,
  Expedition,
  generateMap,
  isUpgradeOwned,
  purchaseUpgrade,
  unlockDecorations,
  validateMap,
} from "../src/core/engine";
import type {
  BiomeId,
  Equipment,
  GameEvent,
  InputState,
  Vec2,
} from "../src/core/types";

const starter: Equipment = {
  suit: 0,
  oxygen: 0,
  spear: 0,
  cargo: 0,
  cutter: false,
};
const equipped: Equipment = {
  suit: 2,
  oxygen: 0,
  spear: 2,
  cargo: 0,
  cutter: true,
};
const idle: InputState = {
  moveX: 0,
  moveY: 0,
  aimX: 1,
  aimY: 0,
  action: false,
};
function advance(
  run: Expedition,
  seconds: number,
  input: InputState = idle,
): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += 0.05)
    events.push(...run.step(Math.min(0.05, seconds - t), input));
  return events;
}
function approach(run: Expedition, target: Vec2) {
  for (let step = 0; step < 5000; step++) {
    const p = run.state.player,
      dx = target.x - p.x,
      dy = target.y - p.y;
    if (Math.hypot(dx, dy) < 0.55) {
      p.vx = 0;
      p.vy = 0;
      return;
    }
    run.step(0.1, { ...idle, moveX: dx, moveY: dy });
    if (run.state.phase !== "playing")
      throw new Error("Route killed the player");
  }
  throw new Error(
    `Route stuck at ${run.state.player.x}, ${run.state.player.y}`,
  );
}

describe("seeded, accessible sea generation", () => {
  for (const biome of ["reef", "wreck", "abyss"] as BiomeId[]) {
    it(`${biome}: 100 seeds include a connected objective route with at least 25% oxygen`, () => {
      for (let seed = 0; seed < 100; seed++) {
        const map = generateMap(biome, seed),
          validation = validateMap(map);
        expect(validation, `seed ${seed}`).toMatchObject({ valid: true });
        expect(validation.oxygenRemaining).toBeGreaterThanOrEqual(90);
        expect(map.exits).toHaveLength(3);
        const run = new Expedition(biome, seed, equipped);
        expect(new Set(run.state.creatures.map((c) => c.species)).size).toBe(4);
        if (biome !== "abyss")
          expect(
            run.state.pickups.filter(
              (p) =>
                p.item ===
                (biome === "reef" ? "blueprintReef" : "blueprintDeep"),
            ),
          ).toHaveLength(1);
        else
          expect(
            run.state.creatures.filter((c) => c.species === "glowray"),
          ).toHaveLength(1);
        expect(
          run.state.pickups.filter(
            (p) => p.item === "shell" || p.item === "fang",
          ),
        ).toHaveLength(0);
      }
    });
  }
  it("is deterministic and changes the drop and objective positions across seeds", () => {
    expect(generateMap("reef", 7)).toEqual(generateMap("reef", 7));
    expect(generateMap("reef", 8).spawn).not.toEqual(
      generateMap("reef", 7).spawn,
    );
    expect(generateMap("reef", 8).goal).not.toEqual(
      generateMap("reef", 7).goal,
    );
  });
  it("actually swims the reef objective path and returns with the blueprint", () => {
    const run = new Expedition("reef", 9, starter);
    for (const c of run.state.creatures) c.alive = false;
    for (const point of run.state.map.safeRoute.slice(1, 4))
      approach(run, point);
    expect(run.interact()).toContainEqual({ type: "collect" });
    expect(run.state.cargo).toContainEqual({ id: "blueprintReef", count: 1 });
    for (const point of run.state.map.safeRoute.slice(4)) approach(run, point);
    expect(run.interact()).toContainEqual({ type: "extract" });
    expect(run.state.phase).toBe("extracted");
  });
  it("seals the deep blueprint behind a functioning cutter hatch", () => {
    const run = new Expedition("wreck", 17, equipped);
    for (const c of run.state.creatures) c.alive = false;
    const gate = run.state.map.gates[0],
      goal = run.state.map.goal;
    Object.assign(run.state.player, {
      x: goal.x,
      y: gate.rect.y + gate.rect.h + 1,
      vx: 0,
      vy: 0,
    });
    advance(run, 2, { ...idle, moveY: -1 });
    expect(run.state.player.y).toBeGreaterThan(gate.rect.y + gate.rect.h);
    expect(run.interact().some((e) => e.type === "collect")).toBe(false);
    run.setTool("cutter");
    expect(
      advance(run, 3.2, { ...idle, action: true, aimY: -1, aimX: 0 }),
    ).toContainEqual({ type: "cut" });
    expect(gate.open).toBe(true);
    approach(run, goal);
    expect(run.interact()).toContainEqual({ type: "collect" });
    expect(run.state.cargo).toContainEqual({ id: "blueprintDeep", count: 1 });
    expect(
      validateMap(generateMap("wreck", 17), { ...starter, suit: 1 }).valid,
    ).toBe(false);
  });
  it("enforces biome pressure requirements and world bounds", () => {
    expect(() => new Expedition("abyss", 1, starter)).toThrow("내압복");
    const run = new Expedition("reef", 2, starter);
    Object.assign(run.state.player, { x: 0.7, y: -1 });
    advance(run, 3, { ...idle, moveX: -1, moveY: 1 });
    expect(run.state.player.x).toBeGreaterThanOrEqual(0.65);
    expect(run.state.player.y).toBeLessThanOrEqual(-0.65);
  });
});

describe("expedition actions, danger and progress", () => {
  it("scans, catches and carries a starter creature through normal tool actions", () => {
    const run = new Expedition("reef", 2, starter),
      c = run.state.creatures.find((c) => c.species === "clownfish")!;
    for (const other of run.state.creatures)
      if (other !== c) other.alive = false;
    Object.assign(run.state.player, { x: c.x - 2, y: c.y });
    const events = advance(run, 2.2, { ...idle, action: true });
    expect(events).toContainEqual({ type: "scan", species: "clownfish" });
    run.setTool("net");
    expect(advance(run, 1.7, { ...idle, action: true })).toContainEqual({
      type: "collect",
    });
    expect(c.captured).toBe(true);
    expect(run.state.cargo).toEqual([{ id: "specimen:clownfish", count: 1 }]);
  });
  it("only yields mandatory shell and fang materials after hunting predators", () => {
    for (const biome of ["reef", "wreck"] as BiomeId[]) {
      const run = new Expedition(biome, 8, equipped),
        predator = run.state.creatures.find(
          (c) => SPECIES_BY_ID[c.species].kind === "predator",
        )!;
      for (const c of run.state.creatures) if (c !== predator) c.alive = false;
      Object.assign(predator, { x: 100, y: -50, homeX: 100, homeY: -50 });
      Object.assign(run.state.player, { x: 95, y: -50 });
      run.setTool("spear");
      const events: GameEvent[] = [];
      for (let t = 0; t < 5 && predator.alive; t += 0.05)
        events.push(
          ...run.step(0.05, {
            ...idle,
            aimX: predator.x - run.state.player.x,
            aimY: predator.y - run.state.player.y,
            action: true,
          }),
        );
      expect(events).toContainEqual({ type: "shot" });
      expect(predator.alive).toBe(false);
      expect(run.state.kills).toBe(1);
      const drop = run.state.pickups.find(
        (p) => p.item === (biome === "reef" ? "shell" : "fang"),
      )!;
      expect(drop.count).toBe(2);
      Object.assign(run.state.player, { x: drop.x, y: drop.y });
      expect(run.interact()).toContainEqual({ type: "collect" });
      expect(run.state.cargo.find((s) => s.id === drop.item)?.count).toBe(2);
    }
  });
  it("protects observer/collectible creatures from the spear and rejects their wrong capture tool", () => {
    const run = new Expedition("reef", 2, starter),
      turtle = run.state.creatures.find((c) => c.species === "turtle")!;
    for (const c of run.state.creatures) if (c !== turtle) c.alive = false;
    Object.assign(turtle, { x: 102, y: -50, homeX: 102, homeY: -50 });
    Object.assign(run.state.player, { x: 100, y: -50 });
    run.setTool("spear");
    advance(run, 2, { ...idle, action: true });
    expect(turtle.hp).toBe(SPECIES_BY_ID.turtle.hp);
    run.setTool("net");
    advance(run, 2, { ...idle, action: true });
    expect(turtle.captured).toBe(false);
  });
  it("requires line of sight for pickups and scanners", () => {
    const run = new Expedition("reef", 7, starter),
      creature = run.state.creatures[0];
    run.state.map.obstacles = [{ x: 101, y: -60, w: 1, h: 20 }];
    run.state.map.gates = [];
    Object.assign(run.state.player, { x: 100, y: -50 });
    Object.assign(creature, { x: 103, y: -50, homeX: 103, homeY: -50 });
    run.state.creatures = [creature];
    run.state.pickups = [
      { id: "test", item: "scrap", x: 103, y: -50, count: 1, collected: false },
    ];
    expect(run.interact().some((e) => e.type === "collect")).toBe(false);
    expect(
      advance(run, 3, { ...idle, action: true }).some((e) => e.type === "scan"),
    ).toBe(false);
  });
  it("blocks full cargo, then allows discarding and collecting again", () => {
    const run = new Expedition("reef", 5, starter),
      pickup = run.state.pickups[0];
    run.state.cargo = [{ id: "fiber", count: 32 }];
    Object.assign(run.state.player, { x: pickup.x, y: pickup.y });
    expect(run.interact().some((e) => e.type === "collect")).toBe(false);
    expect(pickup.collected).toBe(false);
    run.discard("fiber", 4);
    expect(run.interact()).toContainEqual({ type: "collect" });
    expect(cargoWeight(run.state.cargo)).toBe(32);
    run.discard("fiber", -2);
    expect(cargoWeight(run.state.cargo)).toBe(32);
  });
  it("dies once when oxygen or health reaches zero and stops accepting actions", () => {
    for (const cause of ["oxygen", "hp"] as const) {
      const run = new Expedition("reef", 5, starter);
      run.state.player[cause] = 0.01;
      if (cause === "hp") run.state.player.hp = 0;
      expect(advance(run, 0.1)).toEqual([{ type: "death" }]);
      expect(run.state.phase).toBe("dead");
      expect(run.interact()).toEqual([]);
      expect(advance(run, 1)).toEqual([]);
    }
  });
  it("emits the final discovery only after scanning the glowray", () => {
    const run = new Expedition("abyss", 42, equipped),
      c = run.state.creatures.find((c) => c.species === "glowray")!;
    for (const other of run.state.creatures)
      if (other !== c) other.alive = false;
    Object.assign(run.state.player, { x: c.x - 3, y: c.y });
    const events = advance(run, 4, { ...idle, action: true });
    expect(events).toContainEqual({ type: "scan", species: "glowray" });
    expect(events).toContainEqual({ type: "complete" });
    expect(
      advance(run, 1, { ...idle, action: true }).some(
        (e) => e.type === "complete",
      ),
    ).toBe(false);
  });
});

describe("permanent upgrades and furnishing", () => {
  it("needs hunted materials and previous upgrades to unlock each depth", () => {
    const save = createDefaultSave();
    for (const upgrade of UPGRADES)
      for (const cost of upgrade.costs) save.stock[cost.id] = 100;
    save.stock.shell = 0;
    expect(purchaseUpgrade(save, "suit1").ok).toBe(false);
    save.stock.shell = 3;
    expect(purchaseUpgrade(save, "suit1").ok).toBe(true);
    expect(save.stock.shell).toBe(0);
    expect(purchaseUpgrade(save, "suit1").ok).toBe(false);
    expect(purchaseUpgrade(save, "cutter").ok).toBe(true);
    expect(save.equipment.cutter).toBe(true);
    save.stock.fang = 0;
    expect(purchaseUpgrade(save, "suit2").ok).toBe(false);
    save.stock.fang = 3;
    expect(purchaseUpgrade(save, "suit2").ok).toBe(true);
    expect(isUpgradeOwned(save, "suit1")).toBe(true);
    expect(purchaseUpgrade(createDefaultSave(), "oxygen2").ok).toBe(false);
  });
  it("each mandatory stage fits within two base-capacity returns", () => {
    const reef = UPGRADES.filter(
      (u) => u.id === "suit1" || u.id === "cutter",
    ).flatMap((u) => u.costs);
    expect(cargoWeight(reef)).toBeLessThanOrEqual(64);
    expect(
      cargoWeight(UPGRADES.find((u) => u.id === "suit2")!.costs),
    ).toBeLessThanOrEqual(64);
  });
  it("rejects overlapping/out-of-room/locked placements and permits moving existing items", () => {
    const save = createDefaultSave();
    expect(canPlace(save, { uid: "x", id: "seaweedPot", x: 0, y: 0 })).toBe(
      false,
    );
    expect(
      canPlace(
        save,
        { uid: "starter-lamp", id: "coralLamp", x: 6, y: 1 },
        "starter-lamp",
      ),
    ).toBe(false);
    expect(
      canPlace(
        save,
        { uid: "starter-lamp", id: "coralLamp", x: 0, y: 0 },
        "starter-lamp",
      ),
    ).toBe(true);
    expect(
      canPlace(
        save,
        { uid: "starter-tank", id: "tank", x: 10, y: 5 },
        "starter-tank",
      ),
    ).toBe(false);
    expect(
      canPlace(
        save,
        { uid: "starter-tank", id: "tank", x: -1, y: 0 },
        "starter-tank",
      ),
    ).toBe(false);
    expect(
      canPlace(
        save,
        { uid: "starter-tank", id: "tank", x: 0.5, y: 0 },
        "starter-tank",
      ),
    ).toBe(false);
    save.scanned = ["clownfish"];
    unlockDecorations(save);
    expect(save.decorations).toContain("seaweedPot");
    save.scanned = Object.keys(SPECIES_BY_ID) as typeof save.scanned;
    unlockDecorations(save);
    expect(save.decorations).toHaveLength(DECORATIONS.length);
  });
});
