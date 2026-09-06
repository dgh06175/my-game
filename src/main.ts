import "@fontsource-variable/dm-sans";
import "@fontsource-variable/noto-sans-kr";
import "./style.css";
import {
  BIOMES,
  DECORATIONS,
  GRID,
  itemName,
  SPECIES,
  SPECIES_BY_ID,
  TOOLS,
  UPGRADES,
} from "./core/data";
import {
  canPlace,
  cargoWeight,
  createDefaultSave,
  Expedition,
  isUpgradeOwned,
  purchaseUpgrade,
  unlockDecorations,
} from "./core/engine";
import { SaveStore } from "./core/storage";
import type {
  BiomeId,
  GameEvent,
  InputState,
  ItemId,
  Placement,
  SaveData,
  SpeciesId,
  ToolId,
  UpgradeId,
} from "./core/types";
import { OceanScene } from "./render/scene";
import { icon, speciesArt } from "./ui/icons";
import { Soundscape } from "./audio";

const $ = <T extends Element = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const timeLabel = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;
const store = new SaveStore(),
  audio = new Soundscape();
let save: SaveData = createDefaultSave(),
  scene: OceanScene,
  expedition: Expedition | undefined;
let selectedBiome: BiomeId = "reef",
  modal = "",
  paused = false,
  transitioning = false,
  storageFailed = false;
let editSelection: { id: string; uid?: string } | undefined;
const keys = new Set<string>();
let pointer = { x: 0, y: 0, active: false, down: false },
  moveStick = { x: 0, y: 0 },
  aimStick = { x: 0, y: 0, down: false };
let hudElapsed = 0,
  lastTime = 0,
  accumulator = 0;
if (import.meta.env.DEV) {
  Object.defineProperty(window, "__PELAGIA_TEST__", {
    value: {
      get save() {
        return save;
      },
      get expedition() {
        return expedition;
      },
      get scene() {
        return scene;
      },
    },
  });
}

$("#app").innerHTML =
  `<canvas id="world" aria-label="3D 바다와 연구기지"></canvas><div id="interface"></div><div id="modal-root"></div><div id="toasts" role="status" aria-live="polite"></div><div id="save-alert" role="alert" hidden>저장하지 못했습니다. 설정에서 저장 파일을 내보내 진행을 보관하세요.</div><div id="rotate"><div class="rotate-phone">${icon("fish", 42)}</div><p>바다를 조금 더 넓게</p><span>휴대폰을 가로로 돌려주세요.</span></div><div id="loading"><div class="loading-emblem">${icon("wave", 44)}</div><span class="eyebrow">PELAGIA</span><p>당신의 바다를 준비하고 있어요.</p><div class="loading-line"></div></div>`;

function toast(message: string) {
  if ([...$("#toasts").children].some((node) => node.textContent === message)) return;
  const n = document.createElement("div");
  n.className = "toast";
  n.innerHTML = `${icon("info", 17)}<span>${esc(message)}</span>`;
  $("#toasts").append(n);
  while ($("#toasts").children.length > 2) $("#toasts").firstElementChild?.remove();
  setTimeout(() => {
    n.classList.add("leaving");
    setTimeout(() => n.remove(), 250);
  }, 3800);
}
function storageError(error: unknown) {
  storageFailed = true;
  $("#save-alert").hidden = false;
  console.error("Save failed", error);
  toast("저장에 실패했습니다. 설정에서 파일로 보관할 수 있습니다.");
}
async function persist() {
  try {
    await store.write(save);
    storageFailed = false;
    $("#save-alert").hidden = true;
  } catch (e) {
    storageError(e);
  }
}

function brand() {
  return `<a class="brand" href="#" data-action="base" aria-label="펠라지아 기지"><span class="brand-symbol">${icon("wave", 28)}</span><span>PELAGIA<small>바다의 수집가</small></span></a>`;
}
function renderBase() {
  const b = BIOMES.find((x) => x.id === selectedBiome)!;
  $("#interface").className = "base-interface";
  $("#interface").innerHTML =
    `<div class="base-wash"></div><header class="topbar">${brand()}<nav aria-label="기지 메뉴">${[
      ["compass", "탐사", "base"],
      ["suit", "장비", "craft"],
      ["book", "도감", "codex"],
      ["fish", "수족관", "aquarium"],
      ["grid", "기지 꾸미기", "layout"],
    ]
      .map(
        ([i, label, a]) =>
          `<button data-action="${a}" class="nav-item ${a === "base" ? "active" : ""}">${icon(i, 18)}<span>${label}</span></button>`,
      )
      .join(
        "",
      )}</nav><div class="top-actions"><span class="collection-count">${icon("book", 17)}<b>${save.scanned.length}</b><span>/ 12</span></span><button class="icon-button" data-action="settings" aria-label="설정">${icon("settings")}</button></div></header>
 <main class="base-content"><section class="welcome"><div class="eyebrow"><i class="status-dot"></i> YOUR LITTLE CORNER OF THE OCEAN</div><h1>${save.completed ? "모든 발견은,<br>새로운 시작." : "바다는 언제나,<br>새로운 이야기."}</h1><p>${save.completed ? "빛결가오리의 기록이 도감에 남았습니다.<br>이제 당신만의 바다를 더 채워보세요." : "익숙한 기지에서, 아직 만나지 못한 바다로.<br>오늘은 어떤 경이로움을 데려올까요?"}</p><div class="mission"><span class="mission-icon">${icon(save.completed ? "star" : "compass", 22)}</span><div><span class="micro-label">${save.completed ? "발견 완료" : "다음 탐사의 실마리"}</span><strong>${nextObjective()}</strong><small>${nextObjectiveHint()}</small></div></div></section>
 <div class="station-label"><span class="station-coordinate">35° 08′ N &nbsp; 129° 09′ E</span><span class="station-rule"></span><strong>나의 작은 해저 기지</strong><small>FIELD STATION 01 · ${save.displayed.length} SPECIES AT HOME</small></div>
 <section class="departure" aria-label="탐사 해역 선택"><div class="departure-heading"><span class="eyebrow">CHOOSE YOUR NEXT DISCOVERY</span><span>탐사 기록 <b>${String(save.stats.returns).padStart(2, "0")}</b></span></div><div class="departure-row"><div class="biome-cards">${BIOMES.map(
   (x, i) => {
     const locked = save.equipment.suit < x.requiredSuit;
     return `<button class="biome-card ${x.id === selectedBiome ? "selected" : ""} ${locked ? "locked" : ""}" data-action="select-biome" data-id="${x.id}" style="--biome-accent:${x.accent}" aria-pressed="${x.id === selectedBiome}"><span class="biome-art biome-${x.id}"><i></i><i></i><i></i><i></i><span>${icon(locked ? "lock" : i === 0 ? "leaf" : i === 1 ? "compass" : "star", 23)}</span></span><span class="biome-copy"><span class="biome-number">0${i + 1} <span>${locked ? "장비 필요" : x.depth}</span></span><strong>${x.name}</strong><small>${x.subtitle}</small></span><span class="biome-check">${icon(locked ? "lock" : x.id === selectedBiome ? "check" : "arrow", 16)}</span></button>`;
   },
 ).join(
   "",
 )}</div><div class="departure-cta"><button class="primary launch" data-action="launch" ${save.equipment.suit < b.requiredSuit ? "disabled" : ""}><span>${save.equipment.suit < b.requiredSuit ? "내압복 업그레이드 필요" : "탐사 시작"}</span>${icon("arrow", 23)}</button><span class="departure-note">${icon("oxygen", 13)} 산소 ${6 + save.equipment.oxygen * 1.5}분 <span>·</span> 새로고침 시 탐사 종료</span></div></div></section></main>
 <footer class="base-footer"><span><i class="status-dot"></i> ${storageFailed ? "저장 확인 필요" : "기록 자동 저장"}</span><button data-action="guide">${icon("info", 14)} 처음이라면, 탐사 안내</button><span>TAKE ONLY MEMORIES. AND A LITTLE WONDER.</span></footer>`;
}
function nextObjective() {
  if (save.completed) return "빛결가오리를 만났습니다";
  if (save.equipment.suit === 2) return "심해에서 빛결가오리 관찰하기";
  if (save.equipment.suit === 1 && !save.equipment.cutter)
    return "난파선을 열 수중 절단기 만들기";
  if (save.equipment.suit === 1) return "난파선에서 심해 장비 회수하기";
  return "산호초에서 첫 설계도 찾기";
}
function nextObjectiveHint() {
  if (save.completed) return "도감을 채우고 수족관을 더 풍성하게 꾸며보세요.";
  if (save.equipment.suit === 2)
    return "작은 빛들을 따라, 바다의 가장 깊은 곳으로.";
  if (save.equipment.suit === 1 && !save.equipment.cutter)
    return "금속 8 · 광물 8로 새 통로를 열어보세요.";
  if (save.equipment.suit === 1)
    return "절단기와 작살을 준비하세요. 곰치 재료가 필요합니다.";
  return "연안 설계도와 큰게의 껍질로 내압복을 만드세요.";
}

async function startDive() {
  if (transitioning || expedition) return;
  const b = BIOMES.find((x) => x.id === selectedBiome)!;
  if (save.equipment.suit < b.requiredSuit) return;
  transitioning = true;
  closeModal();
  audio.start();
  try {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const next = new Expedition(selectedBiome, seed, { ...save.equipment });
    await store.beginRun(save, next.state.id);
    expedition = next;
    paused = false;
    resetInput();
    scene.showDive(next.state);
    renderDive();
    toast(
      "새로고침·탭 종료 시 이번 수집품은 잃습니다. 잠시 자리를 비우면 일시정지됩니다.",
    );
    if (save.stats.dives === 1)
      setTimeout(
        () =>
          toast(
            "WASD로 수영 · 1번 스캐너를 골라 생물을 조준하고 길게 클릭해보세요.",
          ),
        4500,
      );
  } catch (e) {
    storageError(e);
  } finally {
    transitioning = false;
  }
}

function renderDive() {
  if (!expedition) return;
  const b = BIOMES.find((x) => x.id === expedition!.state.biome)!;
  $("#interface").className = "dive-interface";
  $("#interface").innerHTML =
    `<header class="dive-header"><div class="dive-location"><span class="eyebrow">EXPEDITION ${String(save.stats.dives).padStart(2, "0")}</span><h2>${b.name}</h2><span id="depth-label"></span></div><div class="vitals"><div class="oxygen-readout"><span>${icon("oxygen", 20)}<span>OXYGEN</span></span><strong id="oxygen-clock"></strong><div class="meter"><i id="oxygen-meter"></i></div></div><div class="health-readout">${icon("heart", 16)}<div class="meter"><i id="health-meter"></i></div><span id="health-number"></span></div></div><div class="dive-actions"><button class="hud-button" data-action="cargo" aria-label="수집 가방">${icon("cargo")}<span id="cargo-label"></span></button><button class="hud-button" data-action="pause" aria-label="일시정지">${icon("pause")}</button></div></header><div class="return-guidance"><span class="return-arrow" id="return-arrow">${icon("arrow", 18)}</span><div><small>가까운 귀환 부표</small><strong id="return-distance"></strong></div></div><div class="goal-guidance"><span class="return-arrow" id="goal-arrow">${icon("arrow", 18)}</span><div><small id="goal-description">미확인 기록 신호</small><strong id="goal-distance"></strong></div></div><div class="scan-readout" id="scan-readout" hidden><span id="scan-label"></span><div class="meter"><i id="scan-meter"></i></div></div><div class="dive-context"><button id="context-button" data-action="interact"><kbd>E</kbd><span id="context-label">주변을 둘러보세요</span></button></div><div class="tools" role="toolbar" aria-label="탐사 도구">${TOOLS.map((t) => `<button data-action="tool" data-id="${t.id}" class="tool ${expedition!.state.tool === t.id ? "active" : ""}" ${t.id === "cutter" && !save.equipment.cutter ? "disabled" : ""} title="${t.hint}"><kbd>${t.key}</kbd>${icon(t.id, 24)}<span>${t.name}</span></button>`).join("")}</div><div class="dive-tip" id="tool-hint"></div><div class="touch-controls"><div class="joystick" id="move-joystick" aria-label="이동 패드"><div class="joystick-knob"></div><span>이동</span></div><div class="joystick aim-joystick" id="aim-joystick" aria-label="조준하고 도구 사용"><div class="joystick-knob">${icon("scanner", 20)}</div><span>조준 · 사용</span></div></div><div class="damage-vignette" id="damage-vignette"></div>`;
  bindJoystick("#move-joystick", false);
  bindJoystick("#aim-joystick", true);
  updateHUD();
}
function updateHUD() {
  if (!expedition) return;
  const r = expedition.state,
    p = r.player,
    nearest = expedition.nearestExit();
  $("#oxygen-clock").textContent = timeLabel(p.oxygen);
  $("#oxygen-meter").style.width =
    `${Math.max(0, (p.oxygen / expedition.oxygenMax) * 100)}%`;
  $("#oxygen-meter").classList.toggle("low", p.oxygen < 60);
  $("#health-meter").style.width = `${p.hp}%`;
  $("#health-number").textContent = Math.ceil(p.hp).toString();
  $("#cargo-label").textContent =
    `${cargoWeight(r.cargo)} / ${expedition.capacity}`;
  $("#depth-label").textContent =
    `${Math.round(Math.abs(p.y) * 0.35 + (r.biome === "reef" ? 10 : r.biome === "wreck" ? 45 : 120))} m 수심`;
  $("#return-distance").textContent = `${Math.round(nearest.distance)} m`;
  const angle = Math.atan2(-(nearest.exit.y - p.y), nearest.exit.x - p.x);
  $("#return-arrow").style.transform = `rotate(${angle}rad)`;
  $("#context-label").textContent =
    expedition.contextHint.replace(/^E · /, "") ||
    "재료·귀환 부표 가까이에서 상호작용";
  $("#context-button").classList.toggle("ready", !!expedition.contextHint);
  const goal = r.map.goal;
  const gx = goal.x - p.x,
    gy = goal.y - p.y;
  $("#goal-distance").textContent = `${Math.round(Math.hypot(gx, gy))} m`;
  $("#goal-arrow").style.transform = `rotate(${Math.atan2(-gy, gx)}rad)`;
  $("#goal-description").textContent =
    r.biome === "abyss" ? "신비로운 생명 신호" : "미확인 설계도 신호";
  $("#tool-hint").textContent = TOOLS.find((t) => t.id === r.tool)!.hint;
  $("#damage-vignette").style.opacity = String(
    Math.max(
      p.hitFlash * 0.5,
      p.oxygen < 40 ? 0.18 + Math.sin(r.elapsed * 3) * 0.1 : 0,
    ),
  );
  const target = r.creatures.find((c) => c.id === r.targetId);
  const scan = $("#scan-readout");
  scan.hidden = !r.progress;
  $("#scan-label").textContent = target
    ? `${SPECIES_BY_ID[target.species].name} · ${r.tool === "scanner" ? "기록 중" : "채집 중"}`
    : r.tool === "cutter"
      ? "통로를 여는 중"
      : "";
  $("#scan-meter").style.width = `${r.progress * 100}%`;
}
function resetInput() {
  keys.clear();
  pointer.down = false;
  pointer.active = false;
  moveStick = { x: 0, y: 0 };
  aimStick = { x: 0, y: 0, down: false };
  accumulator = 0;
}
function setTool(id: ToolId) {
  if (!expedition) return;
  expedition.setTool(id);
  document
    .querySelectorAll<HTMLElement>(".tool")
    .forEach((e) =>
      e.classList.toggle("active", e.dataset.id === expedition!.state.tool),
    );
  const knob = $("#aim-joystick .joystick-knob");
  if (knob) knob.innerHTML = icon(id, 20);
  updateHUD();
}
function bindJoystick(selector: string, aim: boolean) {
  const el = $(selector);
  let pid: number | undefined,
    cx = 0,
    cy = 0;
  el.addEventListener("pointerdown", (e) => {
    const ev = e as PointerEvent;
    ev.preventDefault();
    ev.stopPropagation();
    pid = ev.pointerId;
    el.setPointerCapture(pid);
    const rect = el.getBoundingClientRect();
    cx = rect.left + rect.width / 2;
    cy = rect.top + rect.height / 2;
    move(ev);
    audio.start();
  });
  function move(ev: PointerEvent) {
    if (ev.pointerId !== pid) return;
    const dx = ev.clientX - cx,
      dy = ev.clientY - cy,
      len = Math.hypot(dx, dy),
      scale = Math.min(1, Math.max(0, len - 5) / 30),
      x = len ? (dx / len) * scale : 0,
      y = len ? (-dy / len) * scale : 0;
    (el.firstElementChild as HTMLElement).style.transform =
      `translate(${x * 25}px,${-y * 25}px)`;
    if (aim) aimStick = { x, y, down: len > 8 };
    else moveStick = { x, y };
  }
  el.addEventListener("pointermove", (e) => move(e as PointerEvent));
  const stop = () => {
    pid = undefined;
    (el.firstElementChild as HTMLElement).style.transform = "";
    if (aim) aimStick = { x: 0, y: 0, down: false };
    else moveStick = { x: 0, y: 0 };
  };
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointercancel", stop);
  el.addEventListener("lostpointercapture", stop);
}
function getInput(): InputState {
  const p = expedition!.state.player;
  let ax = p.facing,
    ay = 0;
  if (pointer.active) {
    const w = scene.pointerToWorld(pointer.x, pointer.y);
    ax = w.x - p.x;
    ay = w.y - p.y;
  }
  if (aimStick.down) {
    ax = aimStick.x;
    ay = aimStick.y;
  }
  return {
    moveX:
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) +
      moveStick.x,
    moveY:
      (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
      (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) +
      moveStick.y,
    aimX: ax,
    aimY: ay,
    action: pointer.down || aimStick.down || keys.has("Space"),
  };
}
function handleEvents(events: GameEvent[]) {
  const firstCompletion = !save.completed;
  for (const event of events) {
    if (event.type === "notice") {
      if (!event.message.includes("도감 기록 완료")) toast(event.message);
    }
    else if (event.type === "scan") {
      const isNew = !save.scanned.includes(event.species);
      void store.recordScan(save, event.species).catch(storageError);
      if (isNew && event.species !== 'glowray') toast(`새로운 기록 · ${SPECIES_BY_ID[event.species].name}`);
      audio.tone("scan");
    } else if (event.type === "complete") {
      if (firstCompletion) {
        audio.tone("complete");
        const banner = document.createElement('div');
        banner.className = 'discovery-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML = `<span class="eyebrow">A NEW CHAPTER OF THE OCEAN</span><h2>빛결가오리</h2><p>당신이 발견한, 바다의 새로운 이야기.</p><span class="discovery-seal">${icon('star',14)} 첫 탐험 목표 달성 · 도감에 영구 기록</span>`;
        $('#app').append(banner);
        setTimeout(()=>banner.remove(),11000);
      }
    } else if (event.type === "death" || event.type === "extract") {
      void finishDive();
    } else audio.tone(event.type);
  }
}
async function finishDive() {
  if (!expedition || transitioning) return;
  transitioning = true;
  paused = true;
  resetInput();
  const r = expedition.state,
    success = r.phase === "extracted",
    items = r.cargo.map((i) => ({ ...i }));
  try {
    await store.finishRun(save, r);
    storageFailed = false;
    $("#save-alert").hidden = true;
    expedition = undefined;
    scene.showBase(save);
    renderBase();
    showDialog(
      "result",
      success ? "무사히 돌아왔어요." : "다음 바다가 기다립니다.",
      success
        ? "당신의 바다에 새로운 이야기가 쌓였습니다."
        : "이번 수집품은 잃었지만, 발견의 기록은 남아 있습니다.",
      `<div class="result-emblem ${success ? "" : "failed"}">${icon(success ? "home" : "wave", 42)}</div><div class="result-stats"><div><span>탐사 시간</span><strong>${timeLabel(r.elapsed)}</strong></div><div><span>${success ? "회수한 수집품" : "남아 있는 도감"}</span><strong>${success ? cargoWeight(items) : save.scanned.length}<small>${success ? "개" : "종"}</small></strong></div><div><span>위험 생물 사냥</span><strong>${r.kills}<small>마리</small></strong></div></div>${success ? `<div class="loot-list">${items.length ? items.map((i) => `<span>${esc(itemName(i.id))}<b>+${i.count}</b></span>`).join("") : "<p>이번엔 바다의 풍경을 담아왔습니다.</p>"}</div>` : '<p class="soft-copy">도감, 장비, 보관 중인 재료와 기지는 그대로입니다.<br>조금 더 준비해서 다시 출발해보세요.</p>'}<button class="primary full" data-action="close">기지에서 쉬어가기 ${icon("arrow", 18)}</button>`,
    );
  } catch (e) {
    storageError(e);
    showDialog(
      "save-retry",
      "탐사 기록을 보관하지 못했어요.",
      "브라우저 저장 공간을 확인하고 다시 시도해주세요.",
      `<p class="soft-copy">현재 수집품은 이 화면에서 유지됩니다. 다시 저장하거나 저장 파일로 기존 진행을 보관할 수 있습니다.</p><button class="primary full" data-action="retry-finish">저장 다시 시도</button><button class="secondary full" data-action="export">기존 진행 파일로 보관</button>`,
      false,
    );
  } finally {
    transitioning = false;
  }
}

function showDialog(
  id: string,
  title: string,
  subtitle: string,
  body: string,
  closable = true,
) {
  modal = id;
  if (expedition) {
    paused = true;
    resetInput();
  }
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="dialog dialog-${id}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="dialog-header"><div><span class="eyebrow">PELAGIA · ${id === "craft" ? "WORKSHOP" : id === "codex" ? "FIELD JOURNAL" : id === "aquarium" ? "LIVING COLLECTION" : id === "layout" ? "MAKE IT YOURS" : "FIELD STATION"}</span><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div>${closable ? `<button class="icon-button" data-action="close" aria-label="닫기">${icon("close")}</button>` : ""}</header><div class="dialog-body">${body}</div></section></div>`;
  setTimeout(() => $("#modal-root button")?.focus(), 0);
}
function closeModal() {
  modal = "";
  $("#modal-root").innerHTML = "";
  if (expedition) {
    paused = false;
    resetInput();
  }
  audio.start();
}
function stockChips() {
  return `<div class="stock-chips">${(["scrap", "mineral", "fiber", "shell", "fang", "lumen"] as ItemId[]).map((id, i) => `<span><i class="resource-dot resource-${i}"></i>${itemName(id)}<b>${save.stock[id] ?? 0}</b></span>`).join("")}</div>`;
}
function openCraft() {
  showDialog(
    "craft",
    "더 먼 바다를 위한 준비",
    "회수한 재료로 장비를 만드세요. 새로운 장비는 새로운 발견으로 이어집니다.",
    `${stockChips()}<div class="upgrade-grid">${UPGRADES.map((u) => {
      const owned = isUpgradeOwned(save, u.id),
        required = !!u.requires && !isUpgradeOwned(save, u.requires),
        affordable = u.costs.every((c) => (save.stock[c.id] ?? 0) >= c.count);
      return `<article class="upgrade-card ${owned ? "owned" : ""}"><div class="upgrade-top"><span class="equipment-icon">${icon(u.icon, 29)}</span><span class="micro-label">${u.category}</span>${owned ? `<span class="owned-mark">${icon("check", 14)} 보유</span>` : ""}</div><h3>${u.name}</h3><p>${u.description}</p><div class="costs">${u.costs.map((c) => `<span class="${(save.stock[c.id] ?? 0) < c.count ? "insufficient" : ""}">${itemName(c.id)} <b>${save.stock[c.id] ?? 0}/${c.count}</b></span>`).join("")}</div><button class="${owned ? "secondary" : "primary"}" data-action="upgrade" data-id="${u.id}" ${owned || required || !affordable ? "disabled" : ""}>${owned ? "장착 완료" : required ? "선행 장비 필요" : !affordable ? "재료를 더 모아주세요" : "제작하고 장착"}${owned ? "" : icon("arrow", 16)}</button></article>`;
    }).join("")}</div>`,
  );
}
function openCodex() {
  showDialog(
    "codex",
    "바다가 남긴 기록",
    `${save.scanned.length} / 12종 발견 · 관찰 기록은 탐사에 실패해도 남습니다.`,
    `${BIOMES.map(
      (b) =>
        `<section class="codex-section"><div class="section-title"><span class="eyebrow">${b.english}</span><h3>${b.name}</h3></div><div class="species-grid">${SPECIES.filter(
          (s) => s.biome === b.id,
        )
          .map((s) => {
            const known = save.scanned.includes(s.id);
            return `<button class="species-card ${known ? "" : "unknown"}" data-action="species" data-id="${s.id}" ${!known ? "disabled" : ""}><div class="species-illustration" style="--species-color:${s.color}">${speciesArt(s.id, s.color)}<span class="species-kind">${icon(s.kind === "collectible" ? "fish" : s.kind === "predator" ? "spear" : "book", 14)}</span></div><span class="species-text"><strong>${known ? s.name : "아직 만나지 못한 생물"}</strong><small>${known ? s.latin : "UNDISCOVERED"}</small></span>${known ? `<span class="species-recorded">${icon("check", 13)}</span>` : ""}</button>`;
          })
          .join("")}</div></section>`,
    ).join("")}`,
  );
}
function openSpecies(id: SpeciesId) {
  const s = SPECIES_BY_ID[id];
  if (!save.scanned.includes(id)) return;
  showDialog(
    "species",
    s.name,
    s.latin,
    `<div class="specimen-hero" style="--species-color:${s.color}">${speciesArt(id, s.color)}</div><p class="species-description">${s.description}</p><div class="specimen-tags"><span>${BIOMES.find((b) => b.id === s.biome)!.name}</span><span>${s.kind === "collectible" ? "채집 · 수족관 전시 가능" : s.kind === "predator" ? "위험 생물 · 사냥 가능" : "관찰 대상 · 바다에 남겨두기"}</span></div><button class="secondary full" data-action="codex">도감으로 돌아가기</button>`,
  );
}
function openAquarium() {
  showDialog(
    "aquarium",
    "함께 돌아온 작은 바다",
    "귀환한 생물은 재료를 쓰지 않고 전시할 수 있어요. 최대 6종을 함께 기릅니다.",
    `<div class="aquarium-summary">${icon("fish", 24)}<strong>${save.displayed.length}<span> / 6종 전시 중</span></strong><span>보관 중인 생물은 언제든 다시 전시할 수 있습니다.</span></div><div class="aquarium-grid">${SPECIES.filter(
      (s) => s.kind === "collectible",
    )
      .map((s) => {
        const count = save.stock[`specimen:${s.id}`] ?? 0,
          displayed = save.displayed.includes(s.id);
        return `<article class="aquarium-card ${!count ? "uncollected" : ""}"><div class="species-illustration" style="--species-color:${s.color}">${speciesArt(s.id, s.color)}</div><h3>${s.name}</h3><p>${count ? `함께 돌아온 생물 ${count}마리` : `${BIOMES.find((b) => b.id === s.biome)!.name}에서 채집`}</p><button class="${displayed ? "secondary" : "primary"}" data-action="display" data-id="${s.id}" ${!count ? "disabled" : ""}>${displayed ? "보관함으로 옮기기" : count ? "수족관에 전시하기" : "아직 함께 오지 않았어요"}</button></article>`;
      })
      .join("")}</div>`,
  );
}
function openLayout() {
  unlockDecorations(save);
  showDialog(
    "layout",
    "당신을 닮은 기지",
    "물건을 고른 뒤 바닥을 눌러 배치하세요. 놓인 물건을 선택해 옮기거나 회수할 수도 있어요.",
    `<div class="layout-editor"><aside class="decoration-list">${DECORATIONS.map(
      (d) => {
        const unlocked = save.decorations.includes(d.id),
          placed = save.placements.find((p) => p.id === d.id);
        return `<button class="decoration-option ${editSelection?.id === d.id ? "selected" : ""}" data-action="select-decoration" data-id="${d.id}" ${!unlocked ? "disabled" : ""}>${icon(d.id === "tank" ? "fish" : d.id.includes("Light") || d.id.includes("Lamp") ? "star" : "grid", 19)}<span><strong>${d.name}</strong><small>${unlocked ? `${d.w} × ${d.h} · ${placed ? "배치됨" : "배치 가능"}` : `도감 ${d.unlock}종 기록 후 해금`}</small></span>${!unlocked ? icon("lock", 13) : ""}</button>`;
      },
    ).join(
      "",
    )}</aside><div class="layout-workspace"><div class="layout-toolbar"><span>${editSelection ? DECORATIONS.find((d) => d.id === editSelection!.id)!.name + " · 빈칸을 눌러 배치" : "꾸밀 물건을 선택하세요"}</span><button class="text-button" data-action="remove-placement" ${!editSelection?.uid ? "disabled" : ""}>${icon("trash", 15)} 회수</button></div><div class="room-grid" id="room-grid" aria-label="12칸 × 6칸 기지 배치도">${save.placements
      .map((p) => {
        const d = DECORATIONS.find((x) => x.id === p.id)!;
        return `<button class="placed-object ${p.uid === editSelection?.uid ? "selected" : ""}" data-action="select-placement" data-id="${esc(p.uid)}" style="left:${(p.x / GRID.width) * 100}%;top:${(p.y / GRID.height) * 100}%;width:${(d.w / GRID.width) * 100}%;height:${(d.h / GRID.height) * 100}%">${icon(p.id === "tank" ? "fish" : "grid", 20)}<span>${d.name}</span></button>`;
      })
      .join(
        "",
      )}<span class="room-label">YOUR FIELD STATION</span></div><div class="layout-note">${icon("info", 16)} 작업대와 탐사 출발은 배치와 관계없이 항상 사용할 수 있습니다.</div></div></div>`,
  );
  $("#room-grid").addEventListener("click", (event) => {
    if (
      (event.target as HTMLElement).closest(".placed-object") ||
      !editSelection
    )
      return;
    const rect = $("#room-grid").getBoundingClientRect();
    const x = Math.floor(
        ((event.clientX - rect.left) / rect.width) * GRID.width,
      ),
      y = Math.floor(((event.clientY - rect.top) / rect.height) * GRID.height);
    const p: Placement = {
      uid: editSelection.uid ?? crypto.randomUUID(),
      id: editSelection.id,
      x,
      y,
    };
    if (!canPlace(save, p, editSelection.uid)) {
      toast("물건이 겹치거나 방 밖으로 나가요. 다른 자리를 골라주세요.");
      return;
    }
    save.placements = save.placements.filter((q) => q.uid !== p.uid);
    save.placements.push(p);
    editSelection = { id: p.id, uid: p.uid };
    void persist();
    scene.showBase(save);
    openLayout();
  });
}

function openSettings() {
  showDialog(
    "settings",
    "잠깐, 숨 고르기",
    "바다는 기다려줍니다. 편안한 설정으로 탐험하세요.",
    `<div class="settings-row"><span><strong>바다의 소리</strong><small>수중 앰비언스와 도구 소리</small></span><button class="toggle ${!save.settings.muted ? "on" : ""}" data-action="mute" aria-label="소리 ${save.settings.muted ? "켜기" : "끄기"}" aria-pressed="${!save.settings.muted}"><i></i></button></div><div class="settings-row"><span><strong>그래픽 품질</strong><small>낮은 품질은 해상도와 장식 효과를 줄입니다.</small></span><select id="quality-select" aria-label="그래픽 품질">${[
      ["auto", "자동"],
      ["high", "높음"],
      ["low", "낮음"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${save.settings.quality === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="settings-block"><h3>탐사 기록 보관</h3><p>기록은 이 브라우저에 저장됩니다. 다른 기기로 옮기거나 안전하게 보관하려면 파일로 내보내세요.</p><div class="button-row"><button class="secondary" data-action="export">${icon("download", 16)} 저장 파일 내보내기</button><button class="secondary" data-action="import">저장 파일 가져오기</button></div><small>가져오면 현재 기록을 선택한 파일의 기록으로 바꿉니다.</small><input type="file" id="save-file" accept="application/json,.json" hidden/></div><button class="text-button" data-action="guide">${icon("info", 17)} 탐사와 조작 안내</button><div class="settings-version">PELAGIA · VERSION 1.0 <span>당신의 속도로 발견하는 바다</span></div>`,
  );
  $("#quality-select").addEventListener("change", (e) => {
    save.settings.quality = (e.target as HTMLSelectElement)
      .value as SaveData["settings"]["quality"];
    scene.setQuality(save.settings.quality);
    void persist();
  });
  $("#save-file").addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || transitioning || expedition) return;
    transitioning = true;
    try {
      if (file.size > 2_000_000) throw new Error("저장 파일이 너무 큽니다.");
      const imported = store.import(await file.text());
      await store.write(imported);
      save = imported;
      audio.setMuted(save.settings.muted);
      scene.setQuality(save.settings.quality);
      scene.showBase(save);
      renderBase();
      openSettings();
      toast("저장 기록을 가져왔습니다.");
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "올바른 저장 파일이 아닙니다.",
      );
    } finally {
      transitioning = false;
    }
  });
}
function openGuide() {
  showDialog(
    "guide",
    "첫 잠수를 위한 작은 안내",
    "급하게 모든 것을 발견하지 않아도 괜찮아요.",
    `<div class="guide-grid"><article>${icon("compass", 25)}<h3>탐험하고, 돌아오기</h3><p>해역마다 새로운 지형이 펼쳐집니다. 산소가 떨어지기 전에 귀환 부표로 돌아가세요. 방향과 거리는 화면에 표시됩니다.</p></article><article>${icon("scanner", 25)}<h3>관찰은 언제나 남습니다</h3><p>스캐너로 생물을 조준하고 길게 사용하세요. 도감은 실패해도 남고, 채집한 생물과 재료는 귀환해야 보관됩니다.</p></article><article>${icon("spear", 25)}<h3>깊은 바다를 위한 준비</h3><p>큰게·곰치 등 위험 생물을 사냥하면 장비 재료를 얻습니다. 난파선의 잠긴 통로에는 절단기가 필요합니다.</p></article><article>${icon("pause", 25)}<h3>쉬어갈 땐 일시정지</h3><p>다른 탭으로 이동하면 게임이 멈춥니다. 새로고침하거나 탭을 종료하면 이번 수집품을 잃고 기지에서 다시 시작합니다.</p></article></div><div class="controls-guide"><span><kbd>W A S D</kbd> 또는 <kbd>↑ ← ↓ →</kbd> 이동</span><span><kbd>마우스</kbd> 조준 · 클릭/누르기</span><span><kbd>1–4</kbd> 도구</span><span><kbd>E</kbd> 줍기 · 귀환</span><span><kbd>Esc</kbd> 일시정지</span><span>모바일: 왼쪽 이동 · 오른쪽 조준/사용</span></div><button class="primary full" data-action="close">이제, 바다로 ${icon("arrow", 18)}</button>`,
  );
}
function openCargo() {
  if (!expedition) return;
  const r = expedition.state;
  showDialog(
    "cargo",
    "이번 탐사의 수집품",
    `${cargoWeight(r.cargo)} / ${expedition.capacity} 적재 중 · 기지로 돌아가야 보관됩니다.`,
    `<div class="cargo-items">${r.cargo.length ? r.cargo.map((i) => `<div class="cargo-row"><span>${icon(i.id.startsWith("specimen:") ? "fish" : i.id.startsWith("blueprint") ? "book" : "cargo", 22)}<strong>${itemName(i.id)}</strong></span><b>× ${i.count}</b><button class="text-button" data-action="discard" data-id="${i.id}">1개 버리기</button></div>`).join("") : '<div class="empty-state">' + icon("cargo", 40) + "<p>아직 가방이 비어 있어요.</p><span>빛나는 재료 가까이에서 E를 눌러보세요.</span></div>"}</div><button class="primary full" data-action="close">탐사 계속하기 ${icon("arrow", 18)}</button>`,
  );
}
function openPause() {
  if (!expedition) return;
  showDialog(
    "pause",
    "물결도 잠시 쉬어갑니다.",
    "이 화면에서는 산소와 시간이 흐르지 않습니다.",
    `<div class="pause-mark">${icon("wave", 50)}</div><button class="primary full" data-action="close">탐사 계속하기 ${icon("arrow", 18)}</button><button class="secondary full" data-action="guide">조작과 탐사 안내</button><button class="text-button danger-text" data-action="abandon-confirm">이번 탐사 포기하기</button>`,
  );
}
function downloadSave() {
  const url = URL.createObjectURL(
    new Blob([store.export(save)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `pelagia-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("저장 파일을 내보냈습니다.");
}

document.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-action]",
  );
  if (!button || button.hasAttribute("disabled") || transitioning) return;
  event.preventDefault();
  audio.start();
  const action = button.dataset.action,
    id = button.dataset.id!;
  switch (action) {
    case "reload":
      location.reload();
      break;
    case "base":
      if (!expedition) {
        closeModal();
        renderBase();
      }
      break;
    case "select-biome":
      selectedBiome = id as BiomeId;
      renderBase();
      break;
    case "launch":
      await startDive();
      break;
    case "close":
      closeModal();
      break;
    case "craft":
      openCraft();
      break;
    case "upgrade": {
      const result = purchaseUpgrade(save, id as UpgradeId);
      toast(result.message);
      if (result.ok) {
        await persist();
        renderBase();
      }
      openCraft();
      break;
    }
    case "codex":
      openCodex();
      break;
    case "species":
      openSpecies(id as SpeciesId);
      break;
    case "aquarium":
      openAquarium();
      break;
    case "display": {
      const species = id as SpeciesId;
      if (!(save.stock[`specimen:${species}`] ?? 0)) break;
      save.displayed = save.displayed.includes(species)
        ? save.displayed.filter((s) => s !== species)
        : [...save.displayed, species].slice(0, 6);
      await persist();
      scene.showBase(save);
      renderBase();
      openAquarium();
      break;
    }
    case "layout":
      editSelection = undefined;
      openLayout();
      break;
    case "select-decoration": {
      const p = save.placements.find((x) => x.id === id);
      editSelection = { id, uid: p?.uid };
      openLayout();
      break;
    }
    case "select-placement": {
      const p = save.placements.find((x) => x.uid === id)!;
      editSelection = { id: p.id, uid: p.uid };
      openLayout();
      break;
    }
    case "remove-placement":
      if (editSelection?.uid) {
        save.placements = save.placements.filter(
          (p) => p.uid !== editSelection!.uid,
        );
        editSelection = { id: editSelection.id };
        await persist();
        scene.showBase(save);
        openLayout();
      }
      break;
    case "settings":
      openSettings();
      break;
    case "mute":
      save.settings.muted = !save.settings.muted;
      audio.setMuted(save.settings.muted);
      void persist();
      openSettings();
      break;
    case "export":
      downloadSave();
      break;
    case "import":
      $("#save-file").click();
      break;
    case "guide":
      openGuide();
      break;
    case "pause":
      openPause();
      break;
    case "cargo":
      openCargo();
      break;
    case "tool":
      setTool(id as ToolId);
      break;
    case "interact":
      if (expedition && !paused) handleEvents(expedition.interact());
      break;
    case "discard":
      expedition?.discard(id as ItemId, 1);
      openCargo();
      updateHUD();
      break;
    case "retry-finish":
      await finishDive();
      break;
    case "abandon-confirm":
      showDialog(
        "abandon",
        "이번 탐사를 마칠까요?",
        "이번 수집품은 잃지만 도감 기록은 남습니다.",
        `<button class="primary full" data-action="close">탐사 계속하기</button><button class="secondary full danger-text" data-action="abandon">수집품을 두고 기지로 돌아가기</button>`,
      );
      break;
    case "abandon":
      if (expedition) {
        expedition.state.phase = "dead";
        await finishDive();
      }
      break;
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement).matches("input,select,textarea")) return;
  if (event.code === "Escape") {
    event.preventDefault();
    if (transitioning) return;
    if (modal === "save-retry") return;
    if (modal) closeModal();
    else if (expedition) openPause();
    return;
  }
  if (modal) {
    if (event.code === "Tab") {
      const focusables = [
        ...document.querySelectorAll<HTMLElement>(
          ".dialog button:not([disabled]),.dialog select,.dialog input:not([hidden])",
        ),
      ];
      if (focusables.length) {
        const i = focusables.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && i <= 0) {
          event.preventDefault();
          focusables.at(-1)!.focus();
        } else if (!event.shiftKey && i === focusables.length - 1) {
          event.preventDefault();
          focusables[0].focus();
        }
      }
    }
    return;
  }
  if (!expedition) return;
  if (
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "KeyE",
    ].includes(event.code)
  )
    event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === "KeyE") handleEvents(expedition.interact());
  if (/^Digit[1-4]$/.test(event.code))
    setTool(TOOLS[Number(event.code.slice(-1)) - 1].id);
});
document.addEventListener("keyup", (e) => keys.delete(e.code));
$("#world").addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse") {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  }
});
$("#world").addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button === 0) {
    pointer.down = true;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  }
  audio.start();
});
document.addEventListener("pointerup", () => (pointer.down = false));
window.addEventListener("blur", () => {
  resetInput();
  if (expedition && !modal) openPause();
});
document.addEventListener("visibilitychange", () => {
  resetInput();
  if (document.hidden) {
    audio.suspend();
    if (expedition && !modal) openPause();
  } else {
    lastTime = performance.now();
  }
});
window.addEventListener("resize", () => {
  scene?.resize();
  if (
    expedition &&
    window.matchMedia("(orientation:portrait) and (max-width:900px)").matches
  ) {
    resetInput();
    if (!modal) openPause();
  }
});
$("#world").addEventListener("webglcontextlost", () => {
  resetInput();
  if (expedition && !modal) openPause();
  toast("화면을 복구하는 동안 탐사를 잠시 멈춥니다.");
});

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.08) || 0;
  lastTime = now;
  if (document.hidden) return;
  if (expedition && !paused && !transitioning) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= 1 / 60 && steps++ < 5 && expedition && !paused) {
      const input = getInput();
      scene.setAim(input.aimX, input.aimY);
      handleEvents(expedition.step(1 / 60, input));
      accumulator -= 1 / 60;
    }
    hudElapsed += dt;
    if (hudElapsed > 0.12) {
      updateHUD();
      hudElapsed = 0;
    }
  }
  scene?.update(dt, now / 1000, expedition?.state, save);
}

async function boot() {
  try {
    const support = document.createElement("canvas").getContext("webgl2");
    if (!support)
      throw new Error(
        "이 브라우저에서 WebGL 2를 사용할 수 없습니다. 하드웨어 가속을 켜거나 최신 브라우저에서 열어주세요.",
      );
    support.getExtension("WEBGL_lose_context")?.loseContext();
    scene = new OceanScene($("#world"));
    let abandoned = false;
    try {
      const loaded = await store.load();
      save = loaded.save;
      abandoned = loaded.abandoned;
    } catch (e) {
      throw e;
    }
    unlockDecorations(save);
    audio.setMuted(save.settings.muted);
    scene.setQuality(save.settings.quality);
    scene.showBase(save);
    renderBase();
    $("#loading").classList.add("ready");
    setTimeout(() => $("#loading").remove(), 600);
    lastTime = performance.now();
    requestAnimationFrame(frame);
    if (abandoned)
      toast(
        "이전 탐사는 종료되었습니다. 도감과 기존 장비·기지는 그대로 보관되어 있어요.",
      );
  } catch (error) {
    console.error(error);
    $("#loading").innerHTML =
      `${icon("wave", 45)}<h2>바다를 열지 못했어요.</h2><p>${esc(error instanceof Error ? error.message : "화면을 준비하지 못했습니다.")}</p><button class="primary" data-action="reload">다시 열기</button><label class="secondary recovery-label">저장 파일로 복구<input type="file" id="recover-file" accept="application/json,.json" hidden/></label><p id="recover-error" role="alert"></p>`;
    $("#recover-file").addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || transitioning) return;
      transitioning = true;
      try {
        if (file.size > 2_000_000) throw new Error("저장 파일이 너무 큽니다.");
        const recovered = store.import(await file.text());
        await store.write(recovered);
        location.reload();
      } catch (err) {
        $("#recover-error").textContent =
          err instanceof Error ? err.message : "기록을 복구하지 못했습니다.";
      } finally {
        transitioning = false;
      }
    });
  }
}
void boot();
