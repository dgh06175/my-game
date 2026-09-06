export type BiomeId = "reef" | "wreck" | "abyss";
export type SpeciesId =
  | "clownfish"
  | "seahorse"
  | "turtle"
  | "crab"
  | "triggerfish"
  | "puffer"
  | "ray"
  | "moray"
  | "jellyfish"
  | "seaangel"
  | "angler"
  | "glowray";
export type ResourceId =
  | "scrap"
  | "mineral"
  | "fiber"
  | "shell"
  | "fang"
  | "lumen"
  | "blueprintReef"
  | "blueprintDeep";
export type ItemId = ResourceId | `specimen:${SpeciesId}`;
export type ToolId = "scanner" | "net" | "spear" | "cutter";
export type UpgradeId =
  | "suit1"
  | "suit2"
  | "cutter"
  | "oxygen1"
  | "oxygen2"
  | "spear1"
  | "spear2"
  | "cargo1"
  | "cargo2";
export interface Vec2 {
  x: number;
  y: number;
}
export interface Rect extends Vec2 {
  w: number;
  h: number;
}
export interface ItemStack {
  id: ItemId;
  count: number;
}
export interface Equipment {
  suit: number;
  oxygen: number;
  spear: number;
  cargo: number;
  cutter: boolean;
}
export interface Placement {
  uid: string;
  id: string;
  x: number;
  y: number;
}
export interface SaveData {
  version: 1;
  updatedAt: number;
  stock: Partial<Record<ItemId, number>>;
  scanned: SpeciesId[];
  displayed: SpeciesId[];
  equipment: Equipment;
  decorations: string[];
  placements: Placement[];
  completed: boolean;
  activeRunId: string | null;
  settledRuns: string[];
  stats: {
    dives: number;
    returns: number;
    deaths: number;
    kills: number;
    playSeconds: number;
  };
  settings: { muted: boolean; quality: "auto" | "high" | "low" };
}
export interface SpeciesDefinition {
  id: SpeciesId;
  name: string;
  latin: string;
  biome: BiomeId;
  kind: "collectible" | "observer" | "predator";
  description: string;
  color: string;
  hp: number;
  drop?: ResourceId;
  size: number;
}
export interface BiomeDefinition {
  id: BiomeId;
  name: string;
  english: string;
  subtitle: string;
  description: string;
  depth: string;
  danger: number;
  requiredSuit: number;
  accent: string;
  topColor: number;
  bottomColor: number;
}
export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  description: string;
  category: string;
  costs: ItemStack[];
  requires?: UpgradeId;
  icon: string;
}
export interface DecorationDefinition {
  id: string;
  name: string;
  w: number;
  h: number;
  unlock: number;
  description: string;
}
export interface PickupState extends Vec2 {
  id: string;
  item: ItemId;
  count: number;
  collected: boolean;
}
export interface CreatureState extends Vec2 {
  id: string;
  species: SpeciesId;
  homeX: number;
  homeY: number;
  hp: number;
  alive: boolean;
  captured: boolean;
  vx: number;
  vy: number;
  facing: number;
  attackCooldown: number;
  scanProgress: number;
  hitFlash: number;
}
export interface GateState {
  id: string;
  rect: Rect;
  open: boolean;
  progress: number;
}
export interface ExitPoint extends Vec2 {
  id: string;
  label: string;
}
export interface WorldMap {
  seed: number;
  biome: BiomeId;
  width: number;
  height: number;
  spawn: Vec2;
  exits: ExitPoint[];
  obstacles: Rect[];
  gates: GateState[];
  goal: Vec2;
  scenery: { x: number; y: number; kind: number; scale: number }[];
  safeRoute: Vec2[];
}
export interface RunState {
  id: string;
  seed: number;
  biome: BiomeId;
  phase: "playing" | "extracted" | "dead";
  elapsed: number;
  map: WorldMap;
  player: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    hp: number;
    oxygen: number;
    facing: number;
    hitFlash: number;
  };
  creatures: CreatureState[];
  pickups: PickupState[];
  cargo: ItemStack[];
  projectiles: {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    ttl: number;
  }[];
  tool: ToolId;
  actionCooldown: number;
  targetId: string | null;
  progress: number;
  kills: number;
}
export interface InputState {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  action: boolean;
}
export type GameEvent =
  | { type: "notice"; message: string }
  | { type: "scan"; species: SpeciesId }
  | {
      type:
        "shot" | "hit" | "collect" | "cut" | "complete" | "death" | "extract";
    };
