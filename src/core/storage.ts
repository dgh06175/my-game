import { DECORATIONS, SPECIES, SPECIES_BY_ID } from "./data";
import { canPlace, createDefaultSave, unlockDecorations } from "./engine";
import type { ItemId, RunState, SaveData, SpeciesId } from "./types";

const KEY = "profile";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("저장 데이터를 읽지 못했습니다."));
  });
const completed = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("저장하지 못했습니다."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("저장이 중단되었습니다."));
  });
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = 1_000_000): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const stringArray = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((x) => typeof x === "string") &&
  new Set(v).size === v.length;
const speciesIds = SPECIES.map((s) => s.id);
const resourceIds = [
  "scrap",
  "mineral",
  "fiber",
  "shell",
  "fang",
  "lumen",
  "blueprintReef",
  "blueprintDeep",
];
const validItems = new Set([
  ...resourceIds,
  ...SPECIES.filter((s) => s.kind === "collectible").map(
    (s) => `specimen:${s.id}`,
  ),
]);

function validate(value: unknown): SaveData {
  const bad = () => {
    throw new Error(
      "올바른 Pelagia 저장 파일이 아닙니다. 버전과 내용을 확인해주세요.",
    );
  };
  if (!object(value) || value.version !== 1) return bad();
  if (
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0 ||
    !object(value.stock) ||
    !object(value.equipment) ||
    !object(value.stats) ||
    !object(value.settings)
  )
    return bad();
  if (
    Object.entries(value.stock).some(
      ([key, count]) => !validItems.has(key) || !integer(count),
    )
  )
    return bad();
  if (
    !stringArray(value.scanned, 12) ||
    !value.scanned.every((id) => speciesIds.includes(id as SpeciesId)) ||
    !stringArray(value.displayed, 6) ||
    !value.displayed.every(
      (id) =>
        speciesIds.includes(id as SpeciesId) &&
        SPECIES_BY_ID[id as SpeciesId].kind === "collectible" &&
        ((value.stock as Record<string, number>)[`specimen:${id}`] ?? 0) > 0,
    )
  )
    return bad();
  if (
    !["suit", "oxygen", "spear", "cargo"].every((key) =>
      integer((value.equipment as Record<string, unknown>)[key], 0, 2),
    ) ||
    typeof value.equipment.cutter !== "boolean"
  )
    return bad();
  if (
    !stringArray(value.decorations, DECORATIONS.length) ||
    !value.decorations.every((id) => DECORATIONS.some((d) => d.id === id)) ||
    !Array.isArray(value.placements) ||
    value.placements.length > DECORATIONS.length
  )
    return bad();
  if (
    typeof value.completed !== "boolean" ||
    (value.completed && !(value.scanned as string[]).includes("glowray")) ||
    !(
      value.activeRunId === null ||
      (typeof value.activeRunId === "string" &&
        value.activeRunId.length <= 160 &&
        value.activeRunId.length > 0)
    ) ||
    !stringArray(value.settledRuns, 10_000) ||
    !value.settledRuns.every((id) => id.length > 0 && id.length <= 160)
  )
    return bad();
  if (
    !["dives", "returns", "deaths", "kills"].every((key) =>
      integer((value.stats as Record<string, unknown>)[key], 0, 100_000_000),
    ) ||
    typeof value.stats.playSeconds !== "number" ||
    !Number.isFinite(value.stats.playSeconds) ||
    value.stats.playSeconds < 0 ||
    value.stats.playSeconds > 10_000_000_000
  )
    return bad();
  if (
    typeof value.settings.muted !== "boolean" ||
    !["auto", "high", "low"].includes(value.settings.quality as string)
  )
    return bad();
  const save = clone(value) as unknown as SaveData;
  // Recompute unlocks before checking layouts so imported files cannot leave locked furniture in the room.
  unlockDecorations(save);
  const placements = save.placements;
  save.placements = [];
  for (const p of placements) {
    if (
      !object(p) ||
      typeof p.uid !== "string" ||
      !p.uid.length ||
      p.uid.length > 100 ||
      typeof p.id !== "string" ||
      !canPlace(save, p)
    )
      return bad();
    save.placements.push(p);
  }
  return save;
}

/** A single profile record makes reward settlement and ending a dive one atomic transaction. */
export class SaveStore {
  private dbPromise?: Promise<IDBDatabase>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly databaseName = "pelagia-save-v1") {}
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise)
      this.dbPromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(
            new Error(
              "이 브라우저에서 자동 저장을 사용할 수 없습니다. 저장 공간 설정을 확인해주세요.",
            ),
          );
          return;
        }
        const opening = indexedDB.open(this.databaseName, 1);
        opening.onupgradeneeded = () => {
          if (!opening.result.objectStoreNames.contains("saves"))
            opening.result.createObjectStore("saves");
        };
        opening.onsuccess = () => {
          opening.result.onversionchange = () => {
            opening.result.close();
            this.dbPromise = undefined;
          };
          resolve(opening.result);
        };
        opening.onerror = () => {
          this.dbPromise = undefined;
          reject(
            opening.error ?? new Error("자동 저장 공간을 열지 못했습니다."),
          );
        };
        opening.onblocked = () => {
          this.dbPromise = undefined;
          reject(new Error("다른 탭에서 게임을 닫고 다시 시도해주세요."));
        };
      });
    return this.dbPromise;
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  async load(): Promise<{ save: SaveData; abandoned: boolean }> {
    return this.enqueue(async () => {
      const db = await this.db(),
        tx = db.transaction("saves", "readwrite"),
        done = completed(tx),
        store = tx.objectStore("saves");
      const value: unknown = await request(store.get(KEY));
      let save: SaveData;
      try {
        save = value === undefined ? createDefaultSave() : validate(value);
      } catch (error) {
        await done;
        throw error;
      }
      const abandoned = !!save.activeRunId;
      if (save.activeRunId) {
        if (!save.settledRuns.includes(save.activeRunId)) {
          save.stats.deaths++;
          save.settledRuns.push(save.activeRunId);
        }
        save.activeRunId = null;
        save.updatedAt = Date.now();
      }
      if (value === undefined || abandoned) store.put(clone(save), KEY);
      await done;
      return { save, abandoned };
    });
  }
  write(save: SaveData): Promise<void> {
    save.updatedAt = Date.now();
    const snapshot = clone(save);
    return this.enqueue(async () => {
      const db = await this.db(),
        tx = db.transaction("saves", "readwrite"),
        done = completed(tx);
      tx.objectStore("saves").put(snapshot, KEY);
      await done;
    });
  }
  beginRun(save: SaveData, runId: string): Promise<void> {
    if (!runId || save.activeRunId)
      return Promise.reject(new Error("이미 진행 중인 탐사가 있습니다."));
    const previousDives = save.stats.dives;
    save.activeRunId = runId;
    save.stats.dives++;
    return this.write(save).catch((error) => {
      save.activeRunId = null;
      save.stats.dives = previousDives;
      throw error;
    });
  }
  recordScan(save: SaveData, species: SpeciesId): Promise<void> {
    if (!SPECIES_BY_ID[species])
      return Promise.reject(new Error("알 수 없는 생물입니다."));
    if (!save.scanned.includes(species)) save.scanned.push(species);
    if (species === "glowray") save.completed = true;
    unlockDecorations(save);
    return this.write(save);
  }
  finishRun(save: SaveData, run: RunState): Promise<void> {
    if (run.phase === "playing")
      return Promise.reject(new Error("진행 중인 탐사는 정산할 수 없습니다."));
    const snapshot = clone(run);
    // The caller pauses this expedition before settlement. Capture only its monotonic
    // discoveries now: an earlier scan write may have failed, while stock and other
    // profile fields must still come from the durable record to avoid duplicate rewards.
    const discoveries = {
      activeRunId: save.activeRunId,
      scanned: [...save.scanned],
      completed: save.completed,
    };
    return this.enqueue(async () => {
      const db = await this.db(),
        tx = db.transaction("saves", "readwrite"),
        done = completed(tx),
        store = tx.objectStore("saves");
      const current = (await request(store.get(KEY))) as SaveData | undefined;
      if (!current) {
        await done;
        throw new Error("탐사 시작 기록이 없습니다.");
      }
      if (current.settledRuns.includes(snapshot.id)) {
        await done;
        Object.assign(save, clone(current));
        return;
      }
      if (current.activeRunId !== snapshot.id) {
        await done;
        throw new Error("현재 탐사와 저장 기록이 일치하지 않습니다.");
      }
      // Only trust the in-memory discoveries when they belong to this same active run.
      if (discoveries.activeRunId === snapshot.id) {
        current.scanned = [
          ...new Set([...current.scanned, ...discoveries.scanned]),
        ];
        current.completed ||= discoveries.completed;
        unlockDecorations(current);
      }
      if (snapshot.phase === "extracted") {
        for (const item of snapshot.cargo)
          current.stock[item.id] = (current.stock[item.id] ?? 0) + item.count;
        current.stats.returns++;
      } else current.stats.deaths++;
      current.stats.kills += snapshot.kills;
      current.stats.playSeconds += snapshot.elapsed;
      current.activeRunId = null;
      current.settledRuns = [...current.settledRuns, snapshot.id].slice(
        -10_000,
      );
      current.updatedAt = Date.now();
      store.put(clone(current), KEY);
      await done;
      Object.assign(save, clone(current));
    });
  }
  export(save: SaveData): string {
    return JSON.stringify(save, null, 2);
  }
  import(json: string): SaveData {
    if (json.length > 2_000_000) throw new Error("저장 파일이 너무 큽니다.");
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      throw new Error("저장 파일을 읽지 못했습니다. JSON 형식을 확인해주세요.");
    }
    const save = validate(value);
    if (save.activeRunId) {
      if (!save.settledRuns.includes(save.activeRunId)) {
        save.settledRuns.push(save.activeRunId);
        save.stats.deaths++;
      }
      save.activeRunId = null;
    }
    save.updatedAt = Date.now();
    return save;
  }
}
