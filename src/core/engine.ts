import {
  BIOMES,
  DECORATIONS,
  GRID,
  SPECIES,
  SPECIES_BY_ID,
  UPGRADES,
  itemName,
} from "./data";
import type {
  BiomeId,
  CreatureState,
  Equipment,
  ExitPoint,
  GameEvent,
  InputState,
  ItemId,
  ItemStack,
  Placement,
  Rect,
  RunState,
  SaveData,
  ToolId,
  UpgradeId,
  Vec2,
  WorldMap,
} from "./types";

const SPEED = 6;
const RADIUS = 0.65;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const intersects = (p: Vec2, r: Rect, radius = RADIUS) =>
  p.x + radius > r.x &&
  p.x - radius < r.x + r.w &&
  p.y + radius > r.y &&
  p.y - radius < r.y + r.h;
const random = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let z = Math.imul(t ^ (t >>> 15), t | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
};
const oxygenFor = (equipment: Equipment) => 360 + equipment.oxygen * 90;

export function createDefaultSave(): SaveData {
  return {
    version: 1,
    updatedAt: Date.now(),
    stock: {},
    scanned: [],
    displayed: [],
    equipment: { suit: 0, oxygen: 0, spear: 0, cargo: 0, cutter: false },
    decorations: ["tank", "coralLamp", "shellSeat"],
    placements: [
      { uid: "starter-tank", id: "tank", x: 6, y: 1 },
      { uid: "starter-lamp", id: "coralLamp", x: 10, y: 1 },
      { uid: "starter-seat", id: "shellSeat", x: 5, y: 4 },
    ],
    completed: false,
    activeRunId: null,
    settledRuns: [],
    stats: { dives: 0, returns: 0, deaths: 0, kills: 0, playSeconds: 0 },
    settings: { muted: false, quality: "auto" },
  };
}

/** Connected upper waterway plus authored seabed/chamber pieces. All coordinates use a Y-up world. */
export function generateMap(biome: BiomeId, seed: number): WorldMap {
  const rng = random(seed);
  const width = biome === "abyss" ? 560 : biome === "wreck" ? 520 : 480;
  const height = biome === "abyss" ? 160 : 140;
  const spawn = { x: 35 + Math.floor(rng() * 4) * 70, y: -22 - rng() * 12 };
  const goal = { x: 330 + rng() * (width - 380), y: -92 - rng() * 13 };
  const obstacles: Rect[] = [];
  // Chunk silhouettes vary, while the guaranteed route stays above them.
  for (let i = 0; i < 8; i++) {
    const x = (i * width) / 8 + 7 + rng() * 8;
    const h = 12 + rng() * 15;
    obstacles.push({ x, y: -height, w: 30 + rng() * 15, h });
    if (i % 2 === 0)
      obstacles.push({
        x: x + 5,
        y: -83 - rng() * 5,
        w: 20 + rng() * 10,
        h: 7,
      });
  }
  // Keep the approach shaft clear of random rock shelves.
  for (let i = obstacles.length - 1; i >= 0; i--)
    if (
      obstacles[i].y > -height &&
      goal.x >= obstacles[i].x - 18 &&
      goal.x <= obstacles[i].x + obstacles[i].w + 18
    )
      obstacles.splice(i, 1);
  const gates: WorldMap["gates"] = [];
  if (biome === "wreck") {
    obstacles.push(
      { x: goal.x - 12, y: goal.y - 9, w: 2, h: 23 },
      { x: goal.x + 10, y: goal.y - 9, w: 2, h: 23 },
      { x: goal.x - 12, y: goal.y - 9, w: 24, h: 2 },
    );
    gates.push({
      id: "sealed-hatch",
      rect: { x: goal.x - 10, y: goal.y + 12, w: 20, h: 2 },
      open: false,
      progress: 0,
    });
  }
  const exits: ExitPoint[] = [
    { id: "drop", label: "투하 비콘", ...spawn },
    { id: "east", label: "동쪽 귀환 비콘", x: width - 24, y: -43 },
    { id: "center", label: "중앙 귀환 비콘", x: width * 0.5, y: -49 },
  ];
  const nearest = [...exits].sort(
    (a, b) => distance(goal, a) - distance(goal, b),
  )[0];
  const safeRoute = [
    spawn,
    { x: spawn.x, y: -50 },
    { x: goal.x, y: -50 },
    goal,
    { x: goal.x, y: -50 },
    { x: nearest.x, y: -50 },
    nearest,
  ];
  const scenery = Array.from({ length: 100 }, (_, i) => ({
    x: 6 + rng() * (width - 12),
    y:
      i % 3 === 0 ? -height + rng() * 15 : -height + 18 + rng() * (height - 38),
    kind: Math.floor(rng() * 5),
    scale: 0.65 + rng() * 2.5,
  }));
  return {
    seed,
    biome,
    width,
    height,
    spawn,
    exits,
    obstacles,
    gates,
    goal,
    scenery,
    safeRoute,
  };
}

export function validateMap(
  map: WorldMap,
  equipment: Equipment = {
    suit: BIOMES.find((b) => b.id === map.biome)!.requiredSuit,
    oxygen: 0,
    spear: 0,
    cargo: 0,
    cutter: true,
  },
): { valid: boolean; reason?: string; oxygenRemaining: number } {
  let length = 0;
  if (equipment.suit < BIOMES.find((b) => b.id === map.biome)!.requiredSuit)
    return {
      valid: false,
      reason: "이 해역에 맞는 내압복이 필요합니다.",
      oxygenRemaining: 0,
    };
  for (let i = 1; i < map.safeRoute.length; i++) {
    const a = map.safeRoute[i - 1],
      b = map.safeRoute[i];
    const d = distance(a, b);
    length += d;
    for (let n = 0; n <= Math.ceil(d * 2); n++) {
      const t = n / Math.max(1, Math.ceil(d * 2));
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (
        p.x < RADIUS ||
        p.x > map.width - RADIUS ||
        p.y > -RADIUS ||
        p.y < -map.height + RADIUS ||
        map.obstacles.some((r) => intersects(p, r))
      )
        return {
          valid: false,
          reason: "필수 경로가 막혀 있습니다.",
          oxygenRemaining: 0,
        };
      if (
        !equipment.cutter &&
        map.gates.some((g) => !g.open && intersects(p, g.rect))
      )
        return {
          valid: false,
          reason: "필수 설계도에 접근하려면 절단기가 필요합니다.",
          oxygenRemaining: 0,
        };
    }
  }
  // Include slow approaches, a complete set of scans/captures and two starter fights.
  const oxygenRemaining = oxygenFor(equipment) - length / (SPEED * 0.8) - 100;
  return oxygenRemaining >= oxygenFor(equipment) * 0.25
    ? { valid: true, oxygenRemaining }
    : {
        valid: false,
        reason: "필수 경로의 산소 여유가 부족합니다.",
        oxygenRemaining,
      };
}

export function cargoWeight(cargo: ItemStack[]): number {
  return cargo.reduce((sum, item) => sum + item.count, 0);
}
export function isUpgradeOwned(save: SaveData, id: UpgradeId): boolean {
  if (id === "cutter") return save.equipment.cutter;
  const category = id.replace(/\d$/, "") as
    "suit" | "oxygen" | "spear" | "cargo";
  return save.equipment[category] >= Number(id.slice(-1));
}
export function purchaseUpgrade(
  save: SaveData,
  id: UpgradeId,
): { ok: boolean; message: string } {
  const upgrade = UPGRADES.find((u) => u.id === id);
  if (!upgrade) return { ok: false, message: "알 수 없는 장비입니다." };
  if (isUpgradeOwned(save, id))
    return { ok: false, message: "이미 제작한 장비입니다." };
  if (upgrade.requires && !isUpgradeOwned(save, upgrade.requires))
    return { ok: false, message: "이전 단계의 장비를 먼저 제작하세요." };
  if (upgrade.costs.some((cost) => (save.stock[cost.id] ?? 0) < cost.count))
    return { ok: false, message: "보관 중인 재료가 부족합니다." };
  for (const cost of upgrade.costs)
    save.stock[cost.id] = (save.stock[cost.id] ?? 0) - cost.count;
  if (id === "cutter") save.equipment.cutter = true;
  else
    save.equipment[
      id.replace(/\d$/, "") as "suit" | "oxygen" | "spear" | "cargo"
    ] = Number(id.slice(-1));
  return { ok: true, message: `${upgrade.name} 제작 완료` };
}
export function unlockDecorations(save: SaveData): void {
  save.decorations = DECORATIONS.filter(
    (d) =>
      d.unlock <= save.scanned.length ||
      (d.id === "discoveryTrophy" && save.completed),
  ).map((d) => d.id);
}
export function canPlace(
  save: SaveData,
  placement: Placement,
  ignoreUid?: string,
): boolean {
  const definition = DECORATIONS.find((d) => d.id === placement.id);
  if (
    !definition ||
    !save.decorations.includes(placement.id) ||
    !Number.isInteger(placement.x) ||
    !Number.isInteger(placement.y) ||
    placement.x < 0 ||
    placement.y < 0 ||
    placement.x + definition.w > GRID.width ||
    placement.y + definition.h > GRID.height
  )
    return false;
  return !save.placements.some((p) => {
    if (p.uid === ignoreUid) return false;
    const other = DECORATIONS.find((d) => d.id === p.id)!;
    return (
      p.uid === placement.uid ||
      p.id === placement.id ||
      (placement.x < p.x + other.w &&
        placement.x + definition.w > p.x &&
        placement.y < p.y + other.h &&
        placement.y + definition.h > p.y)
    );
  });
}

export class Expedition {
  state: RunState;
  readonly equipment: Equipment;
  private shotId = 0;
  private noticeCooldown = 0;
  private interactionTarget: string | null = null;
  constructor(biome: BiomeId, seed: number, equipment: Equipment) {
    const definition = BIOMES.find((b) => b.id === biome);
    if (!definition || equipment.suit < definition.requiredSuit)
      throw new Error("이 해역에 맞는 내압복이 필요합니다.");
    this.equipment = { ...equipment };
    const map = generateMap(biome, seed),
      rng = random(seed ^ 0xabcdef);
    const members = SPECIES.filter((s) => s.biome === biome);
    const creatures: CreatureState[] = [];
    const addCreature = (
      species: (typeof members)[number],
      x: number,
      y: number,
    ) => {
      const id = `${species.id}-${creatures.length}`;
      creatures.push({
        id,
        species: species.id,
        x,
        y,
        homeX: x,
        homeY: y,
        hp: species.hp,
        alive: true,
        captured: false,
        vx: 0,
        vy: 0,
        facing: rng() > 0.5 ? 1 : -1,
        attackCooldown: 0,
        scanProgress: 0,
        hitFlash: 0,
      });
    };
    for (const species of members) {
      if (species.id === "glowray") {
        addCreature(species, map.goal.x, map.goal.y);
        continue;
      }
      const count =
        species.kind === "predator"
          ? 4
          : species.kind === "collectible"
            ? 4
            : 2;
      for (let i = 0; i < count; i++) {
        let p = {
          x: 26 + rng() * (map.width - 52),
          y: -43 - rng() * (map.height - 66),
        };
        if (i === 0 && species.kind === "collectible")
          p = {
            x: map.spawn.x + (members.indexOf(species) === 0 ? 9 : 21),
            y: map.spawn.y - 3 - members.indexOf(species) * 3,
          };
        if (i === 0 && species.kind === "predator")
          p = { x: map.spawn.x + 30, y: -63 };
        // Keep creatures outside rock and the sealed room; their drifting is collision-aware.
        for (
          let attempt = 0;
          attempt < 100 &&
          (map.obstacles.some((r) => intersects(p, r, 2)) ||
            (biome === "wreck" &&
              Math.abs(p.x - map.goal.x) < 16 &&
              Math.abs(p.y - map.goal.y) < 19));
          attempt++
        )
          p = { x: 20 + rng() * (map.width - 40), y: -40 - rng() * 65 };
        addCreature(species, p.x, p.y);
      }
    }
    const pickups: RunState["pickups"] = [];
    const addPickup = (item: ItemId, count: number, p: Vec2) =>
      pickups.push({
        id: `pickup-${pickups.length}`,
        item,
        count,
        collected: false,
        ...p,
      });
    // The opening cluster teaches collecting; remaining clusters encourage a loop through the map.
    addPickup("scrap", 4, { x: map.spawn.x + 5, y: map.spawn.y - 5 });
    addPickup("fiber", 3, { x: map.spawn.x - 7, y: map.spawn.y - 4 });
    addPickup("mineral", 4, { x: map.spawn.x + 18, y: map.spawn.y - 10 });
    for (let i = 0; i < 24; i++) {
      let p = { x: 22 + rng() * (map.width - 44), y: -42 - rng() * 62 };
      for (
        let attempt = 0;
        attempt < 100 &&
        (map.obstacles.some((r) => intersects(p, r, 2)) ||
          (biome === "wreck" &&
            Math.abs(p.x - map.goal.x) < 16 &&
            Math.abs(p.y - map.goal.y) < 19));
        attempt++
      )
        p = { x: 22 + rng() * (map.width - 44), y: -45 - rng() * 55 };
      addPickup(
        (["scrap", "mineral", "fiber"] as const)[i % 3],
        i % 3 === 2 ? 3 : 4,
        p,
      );
    }
    if (biome !== "abyss")
      addPickup(
        biome === "reef" ? "blueprintReef" : "blueprintDeep",
        1,
        map.goal,
      );
    this.state = {
      id: `dive-${Date.now()}-${seed}-${Math.random().toString(36).slice(2, 8)}`,
      seed,
      biome,
      phase: "playing",
      elapsed: 0,
      map,
      player: {
        ...map.spawn,
        vx: 0,
        vy: 0,
        hp: 100,
        oxygen: this.oxygenMax,
        facing: 1,
        hitFlash: 0,
      },
      creatures,
      pickups,
      cargo: [],
      projectiles: [],
      tool: "scanner",
      actionCooldown: 0,
      targetId: null,
      progress: 0,
      kills: 0,
    };
  }
  get capacity(): number {
    return 32 + this.equipment.cargo * 16;
  }
  get oxygenMax(): number {
    return oxygenFor(this.equipment);
  }
  nearestExit(): { exit: ExitPoint; distance: number } {
    const exit = [...this.state.map.exits].sort(
      (a, b) => distance(this.state.player, a) - distance(this.state.player, b),
    )[0];
    return { exit, distance: distance(this.state.player, exit) };
  }
  setTool(tool: ToolId): void {
    if (tool === "cutter" && !this.equipment.cutter) return;
    this.state.tool = tool;
    this.state.progress = 0;
    this.interactionTarget = null;
  }
  discard(item: ItemId, count = 1): void {
    const stack = this.state.cargo.find((s) => s.id === item);
    if (!stack || !Number.isFinite(count) || count <= 0) return;
    stack.count -= Math.floor(count);
    this.state.cargo = this.state.cargo.filter((s) => s.count > 0);
  }
  get contextHint(): string {
    if (this.nearestExit().distance < 4) return "E · 탐사를 마치고 기지로 귀환";
    const pickup = this.closestPickup();
    if (pickup) return `E · ${itemName(pickup.item)} ×${pickup.count} 수집`;
    const gate = this.state.map.gates.find(
      (g) => !g.open && this.nearGate(g.rect),
    );
    if (gate)
      return this.equipment.cutter
        ? "절단기를 선택하고 길게 눌러 통로 열기"
        : "이 통로에는 수중 절단기가 필요합니다";
    return "";
  }
  private closestPickup() {
    return this.state.pickups
      .filter(
        (p) =>
          !p.collected &&
          distance(p, this.state.player) < 4 &&
          this.visible(this.state.player, p),
      )
      .sort(
        (a, b) =>
          distance(a, this.state.player) - distance(b, this.state.player),
      )[0];
  }
  private blocked(p: Vec2, radius = RADIUS): boolean {
    const map = this.state.map;
    return (
      p.x < radius ||
      p.x > map.width - radius ||
      p.y > -radius ||
      p.y < -map.height + radius ||
      map.obstacles.some((r) => intersects(p, r, radius)) ||
      map.gates.some((g) => !g.open && intersects(p, g.rect, radius))
    );
  }
  private visible(a: Vec2, b: Vec2): boolean {
    const steps = Math.ceil(distance(a, b) * 2);
    for (let i = 1; i < steps; i++)
      if (
        this.blocked(
          {
            x: a.x + ((b.x - a.x) * i) / steps,
            y: a.y + ((b.y - a.y) * i) / steps,
          },
          0.1,
        )
      )
        return false;
    return true;
  }
  private addCargo(item: ItemId, count: number): boolean {
    if (cargoWeight(this.state.cargo) + count > this.capacity) return false;
    const existing = this.state.cargo.find((s) => s.id === item);
    if (existing) existing.count += count;
    else this.state.cargo.push({ id: item, count });
    return true;
  }
  interact(): GameEvent[] {
    if (this.state.phase !== "playing") return [];
    if (this.nearestExit().distance < 4) {
      this.state.phase = "extracted";
      return [{ type: "extract" }];
    }
    const pickup = this.closestPickup();
    if (!pickup)
      return [
        {
          type: "notice",
          message: "수집품이나 귀환 비콘 가까이에서 사용하세요.",
        },
      ];
    if (!this.addCargo(pickup.item, pickup.count))
      return [
        {
          type: "notice",
          message: "가방이 가득 찼습니다. 짐을 버리거나 귀환하세요.",
        },
      ];
    pickup.collected = true;
    return [
      { type: "collect" },
      {
        type: "notice",
        message: `${itemName(pickup.item)} ×${pickup.count} 수집`,
      },
    ];
  }
  private nearGate(rect: Rect): boolean {
    const p = this.state.player;
    return (
      distance(p, {
        x: clamp(p.x, rect.x, rect.x + rect.w),
        y: clamp(p.y, rect.y, rect.y + rect.h),
      }) < 4
    );
  }
  step(dt: number, input: InputState): GameEvent[] {
    if (this.state.phase !== "playing" || !Number.isFinite(dt) || dt <= 0)
      return [];
    // Substeps prevent tunneling even when rendering briefly stalls.
    const events: GameEvent[] = [];
    let remaining = Math.min(dt, 1);
    while (remaining > 1e-6 && this.state.phase === "playing") {
      const step = Math.min(remaining, 1 / 30);
      this.tick(step, input, events);
      remaining -= step;
    }
    return events;
  }
  private tick(dt: number, input: InputState, events: GameEvent[]): void {
    const s = this.state,
      p = s.player;
    s.elapsed += dt;
    p.oxygen = Math.max(0, p.oxygen - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    s.actionCooldown = Math.max(0, s.actionCooldown - dt);
    this.noticeCooldown = Math.max(0, this.noticeCooldown - dt);
    if (p.oxygen <= 0 || p.hp <= 0) {
      p.hp = Math.max(0, p.hp);
      s.phase = "dead";
      events.push({ type: "death" });
      return;
    }
    const mx = Number.isFinite(input.moveX) ? clamp(input.moveX, -1, 1) : 0,
      my = Number.isFinite(input.moveY) ? clamp(input.moveY, -1, 1) : 0;
    const magnitude = Math.max(1, Math.hypot(mx, my)),
      blend = 1 - Math.exp(-dt * 7);
    p.vx += ((mx / magnitude) * SPEED - p.vx) * blend;
    p.vy += ((my / magnitude) * SPEED - p.vy) * blend;
    if (!this.blocked({ x: p.x + p.vx * dt, y: p.y })) p.x += p.vx * dt;
    else p.vx = 0;
    if (!this.blocked({ x: p.x, y: p.y + p.vy * dt })) p.y += p.vy * dt;
    else p.vy = 0;
    if (Math.abs(p.vx) > 0.2) p.facing = Math.sign(p.vx);
    let ax = Number.isFinite(input.aimX) ? input.aimX : 0,
      ay = Number.isFinite(input.aimY) ? input.aimY : 0;
    const al = Math.hypot(ax, ay);
    if (al > 0.001) {
      ax /= al;
      ay /= al;
    } else {
      ax = p.facing;
      ay = 0;
    }
    this.updateCreatures(dt, events);
    const target = s.creatures
      .filter(
        (c) =>
          c.alive &&
          !c.captured &&
          distance(c, p) < (s.tool === "net" ? 4.8 : 10) &&
          this.visible(p, c),
      )
      .map((c) => ({
        c,
        dot:
          ((c.x - p.x) * ax + (c.y - p.y) * ay) /
          Math.max(0.01, distance(c, p)),
      }))
      .filter((t) => t.dot > 0.25 || distance(t.c, p) < 2)
      .sort(
        (a, b) => b.dot - a.dot || distance(a.c, p) - distance(b.c, p),
      )[0]?.c;
    s.targetId = target?.id ?? null;
    if (!input.action) {
      s.progress = Math.max(0, s.progress - dt);
      this.interactionTarget = null;
    } else if (s.tool === "spear") {
      if (s.actionCooldown <= 0) {
        if (target && SPECIES_BY_ID[target.species].kind !== "predator")
          this.notice(events, "이 생물은 스캔하거나 채집할 수 있습니다.");
        else {
          s.projectiles.push({
            id: ++this.shotId,
            x: p.x + ax,
            y: p.y + ay,
            vx: ax * 24,
            vy: ay * 24,
            ttl: 1.35,
          });
          s.actionCooldown = 0.65 - this.equipment.spear * 0.08;
          events.push({ type: "shot" });
        }
      }
    } else if (s.tool === "cutter") {
      const gate = s.map.gates.find((g) => !g.open && this.nearGate(g.rect));
      if (gate && this.equipment.cutter) {
        gate.progress = Math.min(1, gate.progress + dt / 3);
        s.progress = gate.progress;
        if (gate.progress >= 1) {
          gate.open = true;
          s.progress = 0;
          events.push(
            { type: "cut" },
            { type: "notice", message: "막힌 통로를 열었습니다." },
          );
        }
      } else s.progress = 0;
    } else if (target) {
      const definition = SPECIES_BY_ID[target.species];
      if (this.interactionTarget !== target.id) {
        s.progress = 0;
        this.interactionTarget = target.id;
      }
      if (s.tool === "scanner") {
        if (target.scanProgress >= 1) {
          s.progress = 1;
        } else {
          target.scanProgress = Math.min(
            1,
            target.scanProgress +
              dt / (target.species === "glowray" ? 3.5 : 1.8),
          );
          s.progress = target.scanProgress;
          if (target.scanProgress >= 1) {
            events.push(
              { type: "scan", species: target.species },
              {
                type: "notice",
                message: `${definition.name} · 도감 기록 완료`,
              },
            );
            if (target.species === "glowray") events.push({ type: "complete" });
          }
        }
      } else if (definition.kind !== "collectible") {
        s.progress = 0;
        this.notice(events, "이 생물은 바다에서 관찰해주세요.");
      } else if (cargoWeight(s.cargo) >= this.capacity) {
        s.progress = 0;
        this.notice(events, "가방이 가득 찼습니다. 짐을 비워주세요.");
      } else {
        s.progress += dt / 1.35;
        if (s.progress >= 1) {
          this.addCargo(`specimen:${target.species}`, 1);
          target.captured = true;
          target.alive = false;
          s.progress = 0;
          events.push(
            { type: "collect" },
            {
              type: "notice",
              message: `${definition.name} 채집 · 귀환하면 수족관에 전시할 수 있어요`,
            },
          );
        }
      }
    } else s.progress = 0;
    this.updateProjectiles(dt, events);
    if (p.hp <= 0) {
      p.hp = 0;
      s.phase = "dead";
      events.push({ type: "death" });
    }
  }
  private notice(events: GameEvent[], message: string): void {
    if (this.noticeCooldown <= 0) {
      events.push({ type: "notice", message });
      this.noticeCooldown = 2;
    }
  }
  private updateCreatures(dt: number, events: GameEvent[]): void {
    const s = this.state,
      p = s.player;
    for (let i = 0; i < s.creatures.length; i++) {
      const c = s.creatures[i];
      if (!c.alive) continue;
      const def = SPECIES_BY_ID[c.species];
      c.hitFlash = Math.max(0, c.hitFlash - dt);
      c.attackCooldown = Math.max(0, c.attackCooldown - dt);
      let tx =
          c.homeX +
          Math.sin(s.elapsed * 0.18 + i * 2.1) *
            (def.kind === "observer" ? 7 : 3),
        ty = c.homeY + Math.sin(s.elapsed * 0.3 + i) * 1.8;
      const chase =
        def.kind === "predator" &&
        distance(c, p) < 15 &&
        distance(c, { x: c.homeX, y: c.homeY }) < 27 &&
        this.visible(c, p);
      if (chase) {
        tx = p.x;
        ty = p.y;
      }
      const d = Math.hypot(tx - c.x, ty - c.y),
        speed = chase
          ? 3.1 + BIOMES.find((b) => b.id === s.biome)!.danger * 0.35
          : Math.min(1.15, d);
      c.vx = d > 0.1 ? ((tx - c.x) / d) * speed : 0;
      c.vy = d > 0.1 ? ((ty - c.y) / d) * speed : 0;
      if (!this.blocked({ x: c.x + c.vx * dt, y: c.y }, 0.8)) c.x += c.vx * dt;
      if (!this.blocked({ x: c.x, y: c.y + c.vy * dt }, 0.8)) c.y += c.vy * dt;
      if (Math.abs(c.vx) > 0.1) c.facing = Math.sign(c.vx);
      if (chase && distance(c, p) < 2 && c.attackCooldown <= 0) {
        p.hp -= s.biome === "reef" ? 10 : s.biome === "wreck" ? 15 : 20;
        p.hitFlash = 0.45;
        c.attackCooldown = 1.6;
        events.push({ type: "hit" });
      }
    }
  }
  private updateProjectiles(dt: number, events: GameEvent[]): void {
    const s = this.state;
    for (const shot of s.projectiles) {
      shot.ttl -= dt;
      const previous = { x: shot.x, y: shot.y };
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      if (this.blocked(shot, 0.1) || !this.visible(previous, shot)) {
        shot.ttl = 0;
        continue;
      }
      const hit = s.creatures.find(
        (c) =>
          c.alive &&
          SPECIES_BY_ID[c.species].kind === "predator" &&
          distance(c, shot) < Math.max(1.2, SPECIES_BY_ID[c.species].size),
      );
      if (!hit) continue;
      shot.ttl = 0;
      hit.hp -= 28 + this.equipment.spear * 18;
      hit.hitFlash = 0.3;
      events.push({ type: "hit" });
      if (hit.hp <= 0) {
        hit.hp = 0;
        hit.alive = false;
        s.kills++;
        const drop = SPECIES_BY_ID[hit.species].drop!;
        s.pickups.push({
          id: `drop-${hit.id}`,
          item: drop,
          count: 2,
          collected: false,
          x: hit.x,
          y: hit.y,
        });
        events.push({
          type: "notice",
          message: `${itemName(drop)}을 회수할 수 있습니다.`,
        });
      }
    }
    s.projectiles = s.projectiles.filter((p) => p.ttl > 0);
  }
}
