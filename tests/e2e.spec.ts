import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Expedition } from "../src/core/engine";
import type { SaveData, SpeciesId } from "../src/core/types";

// DEV-only observation seam. Fixtures shorten travel/material farming; game actions still use the real UI.
type TestWindow = Window &
  typeof globalThis & {
    __PELAGIA_TEST__: {
      save: SaveData;
      expedition?: Expedition;
      scene: { pointerToWorld(x: number, y: number): { x: number; y: number } };
    };
  };
const action = (page: Page, id: string) =>
  page.locator(`[data-action="${id}"]`).first();
async function boot(page: Page) {
  await page.goto("./");
  await expect(action(page, "launch")).toBeVisible();
  await expect(page.locator("#loading")).toHaveCount(0);
  await page.waitForFunction(
    () => !!(window as TestWindow).__PELAGIA_TEST__?.scene,
  );
  // Headless SwiftShader uses the app's low-quality mode; visual performance on hardware is a separate check.
  await action(page, "settings").click();
  await page.locator("#quality-select").selectOption("low");
  await close(page);
}
async function close(page: Page) {
  await page.locator('.dialog-header [data-action="close"]').click();
}
async function launch(page: Page) {
  await action(page, "launch").click();
  await expect(page.locator(".dive-interface")).toBeVisible();
}
async function getSave(page: Page): Promise<SaveData> {
  return page.evaluate(
    () =>
      JSON.parse(
        JSON.stringify((window as TestWindow).__PELAGIA_TEST__.save),
      ) as SaveData,
  );
}
async function importSave(page: Page, save: SaveData) {
  await action(page, "settings").click();
  await page
    .locator("#save-file")
    .setInputFiles({
      name: "pelagia-fixture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(save)),
    });
  await expect(page.locator("#toasts")).toContainText(
    "저장 기록을 가져왔습니다",
  );
  await close(page);
}
async function stageCreature(page: Page, species: SpeciesId, gap = 3) {
  await page.evaluate(
    ({ species, gap }) => {
      const run = (window as TestWindow).__PELAGIA_TEST__.expedition!;
      const c = run.state.creatures.find((c) => c.species === species)!;
      for (const other of run.state.creatures) other.alive = other === c;
      const p = run.state.player;
      if (run.nearestExit().distance < 7) {
        p.x += 9;
        p.y -= 3;
      }
      Object.assign(c, {
        x: p.x + gap,
        y: p.y,
        homeX: p.x + gap,
        homeY: p.y,
        vx: 0,
        vy: 0,
        captured: false,
      });
      Object.assign(p, { vx: 0, vy: 0, facing: 1 });
    },
    { species, gap },
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { scene, expedition } = (window as TestWindow).__PELAGIA_TEST__;
        const center = scene.pointerToWorld(innerWidth / 2, innerHeight / 2);
        return Math.hypot(
          center.x - expedition!.state.player.x,
          center.y - expedition!.state.player.y,
        );
      }),
    )
    .toBeLessThan(2);
}
async function aimAtCreature(page: Page, species: SpeciesId) {
  const target = await page.evaluate((species) => {
    const { scene, expedition } = (window as TestWindow).__PELAGIA_TEST__;
    const c = expedition!.state.creatures.find((c) => c.species === species)!;
    const a = scene.pointerToWorld(0, 0),
      b = scene.pointerToWorld(innerWidth, innerHeight);
    return {
      x: ((c.x - a.x) / (b.x - a.x)) * innerWidth,
      y: ((c.y - a.y) / (b.y - a.y)) * innerHeight,
    };
  }, species);
  await page.mouse.move(target.x, target.y);
}
async function scanMouse(page: Page, species: SpeciesId) {
  await page.keyboard.press("Digit1");
  await aimAtCreature(page, species);
  await page.mouse.down();
  try {
    await expect
      .poll(
        async () => {
          await aimAtCreature(page, species);
          return (await getSave(page)).scanned.includes(species);
        },
        { intervals: [100, 200, 300] },
      )
      .toBe(true);
  } finally {
    await page.mouse.up();
  }
}
async function collectMouse(page: Page, species: SpeciesId) {
  await stageCreature(page, species, 1.5);
  await page.keyboard.press("Digit2");
  await aimAtCreature(page, species);
  await page.mouse.down();
  try {
    await expect
      .poll(
        async () => {
          await aimAtCreature(page, species);
          return page.evaluate(
            (species) =>
              (
                window as TestWindow
              ).__PELAGIA_TEST__.expedition!.state.cargo.some(
                (i) => i.id === `specimen:${species}`,
              ),
            species,
          );
        },
        { intervals: [100, 200, 300] },
      )
      .toBe(true);
  } finally {
    await page.mouse.up();
  }
}
async function moveToPickup(page: Page, item: string) {
  await page.evaluate((item) => {
    const r = (window as TestWindow).__PELAGIA_TEST__.expedition!.state,
      p = r.pickups.find((p) => p.item === item && !p.collected)!;
    Object.assign(r.player, { x: p.x, y: p.y, vx: 0, vy: 0 });
  }, item);
}
async function extract(page: Page, touch = false) {
  await page.evaluate(() => {
    const r = (window as TestWindow).__PELAGIA_TEST__.expedition!.state;
    Object.assign(r.player, { ...r.map.exits[0], vx: 0, vy: 0 });
  });
  if (touch) await action(page, "interact").tap();
  else await page.keyboard.press("KeyE");
  await expect(page.locator(".dialog-result")).toBeVisible();
  await close(page);
}
async function joystick(
  page: Page,
  selector: string,
  whileHeld: () => Promise<void>,
) {
  const rect = (await page.locator(selector).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: rect.x + rect.width / 2 + 27, y: rect.y + rect.height / 2, id: 1 },
    ],
  });
  try {
    await whileHeld();
  } finally {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }
}

test("@desktop opens every base panel, exports/imports files and keeps the layout on reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await page.screenshot({ path: info.outputPath("base-desktop.png") });
  for (const panel of ["craft", "codex", "aquarium", "guide"]) {
    await action(page, panel).click();
    await expect(page.locator(`.dialog-${panel}`)).toBeVisible();
    await close(page);
  }
  await action(page, "layout").click();
  await page
    .locator('[data-action="select-decoration"][data-id="coralLamp"]')
    .click();
  const grid = (await page.locator("#room-grid").boundingBox())!;
  await page.mouse.click(grid.x + grid.width / 24, grid.y + grid.height / 12);
  await expect
    .poll(
      async () =>
        (await getSave(page)).placements.find((p) => p.id === "coralLamp")?.x,
    )
    .toBe(0);
  await close(page);
  await action(page, "settings").click();
  const downloadEvent = page.waitForEvent("download");
  await action(page, "export").click();
  const download = await downloadEvent;
  const exported = JSON.parse(
    await readFile((await download.path())!, "utf8"),
  ) as SaveData;
  expect(exported.placements.find((p) => p.id === "coralLamp")?.x).toBe(0);
  await page
    .locator("#save-file")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":99}'),
    });
  await expect(page.locator("#toasts")).toContainText(
    "올바른 Pelagia 저장 파일",
  );
  await page
    .locator("#save-file")
    .setInputFiles({
      name: "restored.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    });
  await expect(page.locator("#toasts")).toContainText(
    "저장 기록을 가져왔습니다",
  );
  await page.reload();
  await expect(action(page, "launch")).toBeVisible();
  expect((await getSave(page)).placements).toEqual(exported.placements);
  expect(errors).toEqual([]);
});

test("@desktop scans, captures, hunts, recovers loot and displays the returned animal", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await launch(page);
  await stageCreature(page, "clownfish");
  await scanMouse(page, "clownfish");
  await collectMouse(page, "clownfish");
  await moveToPickup(page, "scrap");
  await page.keyboard.press("KeyE");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as TestWindow).__PELAGIA_TEST__.expedition!.state.cargo.some(
          (i) => i.id === "scrap",
        ),
      ),
    )
    .toBe(true);
  await stageCreature(page, "crab", 6);
  await page.keyboard.press("Digit3");
  await aimAtCreature(page, "crab");
  await page.mouse.down();
  try {
    await expect
      .poll(
        async () => {
          await aimAtCreature(page, "crab");
          return page.evaluate(
            () =>
              (window as TestWindow).__PELAGIA_TEST__.expedition!.state.kills,
          );
        },
        { intervals: [100, 200, 300] },
      )
      .toBe(1);
  } finally {
    await page.mouse.up();
  }
  await moveToPickup(page, "shell");
  await page.keyboard.press("KeyE");
  await page.screenshot({ path: info.outputPath("reef-desktop.png") });
  await extract(page);
  const saved = await getSave(page);
  expect(saved.stats.returns).toBe(1);
  expect(saved.stock["specimen:clownfish"]).toBe(1);
  expect(saved.stock.shell).toBe(2);
  expect(saved.scanned).toContain("clownfish");
  await action(page, "aquarium").click();
  await page.locator('[data-action="display"][data-id="clownfish"]').click();
  await expect
    .poll(async () => (await getSave(page)).displayed)
    .toEqual(["clownfish"]);
  await close(page);
  await page.reload();
  await expect(action(page, "launch")).toBeVisible();
  expect((await getSave(page)).displayed).toEqual(["clownfish"]);
  expect(errors).toEqual([]);
});

test("@desktop pauses oxygen and discards only current cargo after a refresh", async ({
  page,
}) => {
  await boot(page);
  await launch(page);
  await stageCreature(page, "clownfish");
  await scanMouse(page, "clownfish");
  await collectMouse(page, "clownfish");
  await page.keyboard.press("Escape");
  await expect(page.locator(".dialog-pause")).toBeVisible();
  const before = await page.evaluate(
    () =>
      (window as TestWindow).__PELAGIA_TEST__.expedition!.state.player.oxygen,
  );
  await page.waitForTimeout(650);
  expect(
    await page.evaluate(
      () =>
        (window as TestWindow).__PELAGIA_TEST__.expedition!.state.player.oxygen,
    ),
  ).toBe(before);
  await close(page);
  await page.reload();
  await expect(action(page, "launch")).toBeVisible();
  await expect.poll(async () => (await getSave(page)).stats.deaths).toBe(1);
  const saved = await getSave(page);
  expect(saved.stock["specimen:clownfish"]).toBeUndefined();
  expect(saved.scanned).toContain("clownfish");
  expect(saved.activeRunId).toBeNull();
});

test("@desktop crafts the required equipment, cuts the wreck hatch and discovers the deep goal", async ({
  page,
}, info) => {
  await boot(page);
  const fixture = await getSave(page);
  fixture.stock = {
    scrap: 100,
    mineral: 100,
    fiber: 100,
    shell: 4,
    fang: 4,
    blueprintReef: 1,
  };
  await importSave(page, fixture);
  await action(page, "craft").click();
  await page.locator('[data-action="upgrade"][data-id="suit1"]').click();
  await page.locator('[data-action="upgrade"][data-id="cutter"]').click();
  await close(page);
  expect((await getSave(page)).equipment).toMatchObject({
    suit: 1,
    cutter: true,
  });
  await page.locator('[data-action="select-biome"][data-id="wreck"]').click();
  await launch(page);
  await page.evaluate(() => {
    const r = (window as TestWindow).__PELAGIA_TEST__.expedition!.state,
      g = r.map.gates[0];
    for (const c of r.creatures) c.alive = false;
    Object.assign(r.player, {
      x: r.map.goal.x,
      y: g.rect.y + g.rect.h + 1,
      vx: 0,
      vy: 0,
    });
  });
  await page.keyboard.press("Digit4");
  await page.keyboard.down("Space");
  try {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as TestWindow).__PELAGIA_TEST__.expedition!.state.map
              .gates[0].open,
        ),
      )
      .toBe(true);
  } finally {
    await page.keyboard.up("Space");
  }
  await moveToPickup(page, "blueprintDeep");
  await page.keyboard.press("KeyE");
  await extract(page);
  await action(page, "craft").click();
  await page.locator('[data-action="upgrade"][data-id="suit2"]').click();
  await close(page);
  expect((await getSave(page)).equipment.suit).toBe(2);
  await page.locator('[data-action="select-biome"][data-id="abyss"]').click();
  await launch(page);
  await stageCreature(page, "glowray", 1.5);
  await scanMouse(page, "glowray");
  await expect.poll(async () => (await getSave(page)).completed).toBe(true);
  await page.screenshot({ path: info.outputPath("abyss-desktop.png") });
  await page.reload();
  await expect(action(page, "launch")).toBeVisible();
  const final = await getSave(page);
  expect(final.completed).toBe(true);
  expect(final.stats.deaths).toBe(1);
  expect(final.decorations).toContain("discoveryTrophy");
});

test("@mobile uses touch movement, tools, collection, crafting and base placement in landscape", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await page.screenshot({ path: info.outputPath("base-mobile.png") });
  await launch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#rotate")).toBeVisible();
  const portraitOxygen = await page.evaluate(
    () =>
      (window as TestWindow).__PELAGIA_TEST__.expedition!.state.player.oxygen,
  );
  await page.waitForTimeout(450);
  expect(
    await page.evaluate(
      () =>
        (window as TestWindow).__PELAGIA_TEST__.expedition!.state.player.oxygen,
    ),
  ).toBe(portraitOxygen);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("#rotate")).not.toBeVisible();
  await close(page);
  const originalX = await page.evaluate(
    () => (window as TestWindow).__PELAGIA_TEST__.expedition!.state.player.x,
  );
  await joystick(page, "#move-joystick", () =>
    expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as TestWindow).__PELAGIA_TEST__.expedition!.state.player.x,
        ),
      )
      .toBeGreaterThan(originalX + 2),
  );
  await stageCreature(page, "clownfish");
  await page.locator('[data-action="tool"][data-id="scanner"]').tap();
  await joystick(page, "#aim-joystick", () =>
    expect
      .poll(async () => (await getSave(page)).scanned.includes("clownfish"))
      .toBe(true),
  );
  await stageCreature(page, "clownfish", 2);
  await page.locator('[data-action="tool"][data-id="net"]').tap();
  await joystick(page, "#aim-joystick", () =>
    expect
      .poll(() =>
        page.evaluate(() =>
          (window as TestWindow).__PELAGIA_TEST__.expedition!.state.cargo.some(
            (i) => i.id === "specimen:clownfish",
          ),
        ),
      )
      .toBe(true),
  );
  await stageCreature(page, "crab", 6);
  await page.locator('[data-action="tool"][data-id="spear"]').tap();
  await joystick(page, "#aim-joystick", () =>
    expect
      .poll(() =>
        page.evaluate(
          () => (window as TestWindow).__PELAGIA_TEST__.expedition!.state.kills,
        ),
      )
      .toBe(1),
  );
  await moveToPickup(page, "shell");
  await action(page, "interact").tap();
  await page.screenshot({ path: info.outputPath("reef-mobile.png") });
  await extract(page, true);
  const fixture = await getSave(page);
  fixture.stock.scrap = 30;
  fixture.stock.fiber = 20;
  await importSave(page, fixture);
  await action(page, "craft").tap();
  await page.locator('[data-action="upgrade"][data-id="oxygen1"]').tap();
  await close(page);
  expect((await getSave(page)).equipment.oxygen).toBe(1);
  await action(page, "layout").tap();
  await page
    .locator('[data-action="select-decoration"][data-id="seaweedPot"]')
    .tap();
  const grid = (await page.locator("#room-grid").boundingBox())!;
  await page.touchscreen.tap(
    grid.x + grid.width / 24,
    grid.y + grid.height / 12,
  );
  await expect
    .poll(async () =>
      (await getSave(page)).placements.some(
        (p) => p.id === "seaweedPot" && p.x === 0 && p.y === 0,
      ),
    )
    .toBe(true);
  await close(page);
  await action(page, "aquarium").tap();
  await page.locator('[data-action="display"][data-id="clownfish"]').tap();
  await expect
    .poll(async () => (await getSave(page)).displayed)
    .toEqual(["clownfish"]);
  expect(errors).toEqual([]);
});
