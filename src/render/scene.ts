import * as THREE from "three";
import type { RunState, SaveData, SpeciesId, WorldMap } from "../core/types";
import { BIOMES, DECORATIONS, SPECIES_BY_ID } from "../core/data";
import {
  createCreature,
  animateCreature,
  createDiver,
  animateDiver,
  createCoral,
  createRock,
  createPlant,
  createDecoration,
} from "./models";

type Swim = {
  object: THREE.Group;
  species: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  speed: number;
  phase: number;
};
type Sway = { object: THREE.Object3D; phase: number; angle: number };
type ParallaxTile = {
  object: THREE.Group;
  origin: number;
  total: number;
  speed: number;
  offset: number;
};
const TAU = Math.PI * 2;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function roundedRect(width: number, height: number, radius: number) {
  const s = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + width - r, y);
  s.quadraticCurveTo(x + width, y, x + width, y + r);
  s.lineTo(x + width, y + height - r);
  s.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  s.lineTo(x + r, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Real 3D art on a planar game world. Simulation never depends on rendering. */
export class OceanScene {
  viewMode: "base" | "dive" = "base";
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(
    -20,
    20,
    15,
    -15,
    0.1,
    250,
  );
  private root = new THREE.Group();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private readonly ownedTextures = new Set<THREE.Texture>();
  private shaders: THREE.ShaderMaterial[] = [];
  private creatures = new Map<string, THREE.Group>();
  private pickups = new Map<string, THREE.Group>();
  private gates = new Map<string, THREE.Group>();
  private projectiles = new Map<number, THREE.Group>();
  private sways: Sway[] = [];
  private swimmers: Swim[] = [];
  private cullObjects: THREE.Object3D[] = [];
  private exitObjects: THREE.Group[] = [];
  private diver?: THREE.Group;
  private diverLight?: THREE.PointLight;
  private diverHalo?: THREE.Mesh;
  private toolObjects?: THREE.Group;
  private scanRing?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private bubbles?: THREE.InstancedMesh;
  private schoolFish?: THREE.InstancedMesh;
  private waterBackdrop?: THREE.Mesh;
  private parallaxTiles: ParallaxTile[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();
  private readonly waterPlane = new THREE.Plane(v3(0, 0, 1), 0);
  private readonly projected = new THREE.Vector3();
  private quality: "auto" | "high" | "low" = "auto";
  private low = false;
  private map?: WorldMap;
  private viewHeight = 29;
  private previousTool = "";
  private readonly aim = new THREE.Vector2(1, 0);
  private hasAim = false;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0x063643);
    this.scene.add(this.root);
    this.camera.position.set(0, 0, 45);
    this.camera.lookAt(0, 0, 0);
    this.setQuality("auto");
  }

  setQuality(quality: "auto" | "high" | "low") {
    this.quality = quality;
    this.low =
      quality === "low" ||
      (quality === "auto" &&
        (window.innerWidth < 900 ||
          window.matchMedia("(pointer: coarse)").matches));
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.low ? 1 : 1.6),
    );
    this.resize();
  }

  /** Aim is shared by pointer and touch input; body motion remains independent. */
  setAim(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 0.001)
      return;
    this.aim.set(x, y).normalize();
    this.hasAim = true;
  }

  resize() {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth),
      height = Math.max(1, rect.height || window.innerHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.viewHeight =
      this.viewMode === "dive"
        ? aspect < 1.35
          ? 32
          : 29
        : aspect < 1.25
          ? 33
          : 26;
    this.camera.left = (-this.viewHeight * aspect) / 2;
    this.camera.right = -this.camera.left;
    this.camera.top = this.viewHeight / 2;
    this.camera.bottom = -this.camera.top;
    this.camera.updateProjectionMatrix();
  }

  private own<T extends THREE.Material>(material: T): T {
    this.ownedMaterials.add(material);
    return material;
  }
  private mat(
    color: THREE.ColorRepresentation,
    roughness = 0.55,
    metalness = 0.08,
    emissive?: THREE.ColorRepresentation,
    intensity = 0,
  ) {
    return this.own(
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        emissive: emissive ?? 0,
        emissiveIntensity: intensity,
      }),
    );
  }
  private transparent(
    color: THREE.ColorRepresentation,
    opacity: number,
    additive = false,
  ) {
    return this.own(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
  }
  private mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D = this.root,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  private box(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z);
  }
  private bar(
    points: THREE.Vector3[],
    radius: number,
    material: THREE.Material,
    parent: THREE.Object3D,
  ) {
    return this.mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points),
        Math.max(8, points.length * 6),
        radius,
        6,
        false,
      ),
      material,
      parent,
    );
  }
  private label(
    text: string,
    color: string,
    w: number,
    h: number,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 768, 160);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "500 68px system-ui, sans-serif";
    ctx.fillText(text, 384, 80);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.ownedTextures.add(texture);
    return this.mesh(
      new THREE.PlaneGeometry(w, h),
      this.own(
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
      parent,
      x,
      y,
      z,
    );
  }

  private contactShadow(
    width: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, "rgba(3,29,30,.38)");
    grad.addColorStop(0.55, "rgba(3,29,30,.23)");
    grad.addColorStop(1, "rgba(3,29,30,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    this.ownedTextures.add(texture);
    const material = this.own(
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    const plane = this.mesh(
      new THREE.PlaneGeometry(width * 1.35, depth * 1.4),
      material,
      this.root,
      x,
      y,
      z,
    );
    plane.rotation.x = -Math.PI / 2;
  }

  private reset() {
    const geometries = new Set<THREE.BufferGeometry>();
    this.root.traverse((object) => {
      const g = (object as THREE.Mesh).geometry;
      if (g && !g.userData.shared) geometries.add(g);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    geometries.forEach((g) => g.dispose());
    this.ownedMaterials.forEach((m) => m.dispose());
    this.ownedTextures.forEach((t) => t.dispose());
    this.ownedMaterials.clear();
    this.ownedTextures.clear();
    this.scene.remove(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.creatures.clear();
    this.pickups.clear();
    this.gates.clear();
    this.projectiles.clear();
    this.shaders = [];
    this.swimmers = [];
    this.sways = [];
    this.cullObjects = [];
    this.exitObjects = [];
    this.diver = undefined;
    this.diverLight = undefined;
    this.diverHalo = undefined;
    this.toolObjects = undefined;
    this.scanRing = undefined;
    this.bubbles = undefined;
    this.map = undefined;
    this.previousTool = "";
    this.schoolFish = undefined;
    this.waterBackdrop = undefined;
    this.parallaxTiles = [];
    this.hasAim = false;
  }

  private gradient(
    width: number,
    height: number,
    top: number,
    bottom: number,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    isWindow = false,
  ) {
    const material = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uTop: { value: new THREE.Color(top) },
          uBottom: { value: new THREE.Color(bottom) },
          uTime: { value: 0 },
          uWindow: { value: isWindow ? 1 : 0 },
        },
        vertexShader:
          "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: `varying vec2 vUv; uniform vec3 uTop; uniform vec3 uBottom; uniform float uTime; uniform float uWindow;
        void main(){ vec2 uv=vUv; float grad=pow(clamp(uv.y,0.,1.),1.25); vec3 col=mix(uBottom,uTop,grad);
          float beam=pow(max(0.,sin(uv.x*19.+uv.y*2.4+uTime*.06)),12.)*.05*uv.y;
          float veil=sin(uv.x*10.+uv.y*5.+uTime*.09)*.015;
          col+=vec3(.5,.85,.78)*(beam+veil); col+=vec3(.03,.12,.10)*pow(uv.y,8.); gl_FragColor=vec4(col,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        depthWrite: true,
        side: THREE.DoubleSide,
      }),
    );
    this.shaders.push(material);
    return this.mesh(
      new THREE.PlaneGeometry(width, height),
      material,
      parent,
      x,
      y,
      z,
    );
  }

  private lightShaft(
    width: number,
    height: number,
    x: number,
    y: number,
    z: number,
    rotation = -0.25,
    color = 0xbdeee1,
  ) {
    const mat = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uPhase: { value: x * 0.73 },
        },
        vertexShader:
          "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: `varying vec2 vUv;uniform float uTime;uniform float uPhase;uniform vec3 uColor;
        void main(){float cone=mix(.5,.17,vUv.y);float edge=1.-smoothstep(cone*.2,cone,abs(vUv.x-.5));
          float fade=smoothstep(0.,.22,vUv.y)*(1.-smoothstep(.9,1.,vUv.y));
          float glimmer=.85+.15*sin(uTime*.2+uPhase);gl_FragColor=vec4(uColor,edge*fade*.12*glimmer);}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.shaders.push(mat);
    const m = this.mesh(
      new THREE.PlaneGeometry(width, height),
      mat,
      this.root,
      x,
      y,
      z,
    );
    m.rotation.z = rotation;
    return m;
  }

  private caustics(
    width: number,
    height: number,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ) {
    const mat = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: new THREE.Vector2(width / 3, height / 3) },
        },
        vertexShader:
          "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: `varying vec2 vUv; uniform float uTime;uniform vec2 uScale;
        void main(){vec2 p=vUv*uScale;float a=sin(p.x*6.+sin(p.y*4.+uTime*.35))+sin(p.y*5.+sin(p.x*3.-uTime*.22));
          float b=sin(p.x*4.2+sin(p.y*5.3-uTime*.23))+sin(p.y*6.1+sin(p.x*3.4+uTime*.4));
          float light=pow(1.-abs(a*.5),14.)*pow(1.-abs(b*.5),3.);gl_FragColor=vec4(.62,.95,.82,light*.27);}`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shaders.push(mat);
    return this.mesh(
      new THREE.PlaneGeometry(width, height),
      mat,
      parent,
      x,
      y,
      z,
    );
  }

  showBase(save: SaveData) {
    this.reset();
    this.viewMode = "base";
    this.resize();
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x0c3f49);
    this.scene.fog = new THREE.FogExp2(0x215e67, 0.008);
    this.camera.position.set(17, 16.5, 32);
    this.camera.lookAt(0.6, 3.1, 0);
    this.root.add(new THREE.HemisphereLight(0xd9f8e9, 0x255966, 2.2));
    const sun = new THREE.DirectionalLight(0xffe6bf, 3);
    sun.position.set(-10, 18, 16);
    this.root.add(sun);
    const fill = new THREE.DirectionalLight(0x6ce4de, 1.8);
    fill.position.set(8, 12, -8);
    this.root.add(fill);
    const cream = this.mat(0xe0d9bc, 0.45, 0.13),
      dark = this.mat(0x153d45, 0.47, 0.45),
      brass = this.mat(0xb69757, 0.3, 0.7);
    const wood = this.mat(0x89755a, 0.65, 0.02),
      woodLight = this.mat(0x9d8767, 0.7),
      plankDark = this.mat(0x665e4e, 0.9);
    const warmGlow = this.mat(0xffe4ac, 0.3, 0.1, 0xffd39a, 1.3),
      coolGlow = this.mat(0x89e5da, 0.28, 0.1, 0x58e9d8, 1.1);

    // The station is an open-front diorama: ocean, rounded panoramic frame, and warm timber deck.
    this.gradient(110, 65, 0x217e8b, 0x092f41, this.root, 0, 6, -35, true);
    this.box(34, 0.8, 18, dark, this.root, 0, -2.3, 0.1);
    this.box(33.5, 0.16, 17.5, wood, this.root, 0, -1.82, 0.1);
    for (let i = 0; i < 26; i++) {
      this.box(
        1.2,
        0.035,
        17.45,
        i % 3 === 0 ? woodLight : wood,
        this.root,
        -15.63 + i * 1.25,
        -1.717,
        0.1,
      );
      this.box(
        0.018,
        0.035,
        17.5,
        plankDark,
        this.root,
        -16.24 + i * 1.25,
        -1.69,
        0.1,
      );
      for (let j = 0; j < 3; j++)
        this.box(
          1.19,
          0.027,
          0.018,
          plankDark,
          this.root,
          -15.63 + i * 1.25,
          -1.69,
          -6.5 + j * 6 + (i % 3) * 1.8,
        );
    }
    this.box(34, 0.12, 0.14, warmGlow, this.root, 0, -2.02, 9.13);
    this.box(0.14, 0.12, 18, warmGlow, this.root, 17.06, -2.02, 0.1);
    const windowShape = roundedRect(32, 13.5, 3.2);
    const inner = roundedRect(30.5, 12, 2.7);
    windowShape.holes.push(new THREE.Path(inner.getPoints(18)));
    const frame = this.mesh(
      new THREE.ExtrudeGeometry(windowShape, {
        depth: 0.65,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.14,
        bevelThickness: 0.13,
        curveSegments: 16,
      }),
      cream,
      this.root,
      0,
      5.1,
      -8.15,
    );
    frame.castShadow = false;
    this.gradient(33, 13.2, 0x298d98, 0x10495a, this.root, 0, 5.1, -15, true);
    for (let i = -1; i <= 1; i++)
      this.box(0.16, 11.1, 0.35, dark, this.root, i * 9.5, 5.1, -7.65);
    this.box(28, 0.15, 0.3, brass, this.root, 0, -0.51, -7.62);
    this.box(29.9, 0.1, 0.11, coolGlow, this.root, 0, 10.5, -7.6);
    this.label("P E L A G I A", "#e5e7ce", 5, 1.04, this.root, 6.1, 9.6, -7.5);
    this.label(
      "O C E A N   O B S E R V A T O R Y",
      "#8cc7c4",
      8,
      0.66,
      this.root,
      6.1,
      8.9,
      -7.48,
    );

    const rng = seeded(821);
    // Sea garden beyond the windows; its silhouettes deepen the room without cluttering the foreground.
    for (let i = 0; i < 18; i++) {
      const plant = createPlant(i + 300);
      plant.position.set(-17 + i * 2, -1.8, -9 - rng() * 4);
      plant.scale.setScalar(1.7 + rng() * 1.8);
      this.root.add(plant);
      this.sways.push({
        object: plant,
        phase: rng() * TAU,
        angle: plant.rotation.z,
      });
    }
    for (let i = 0; i < 13; i++) {
      const fish = createCreature(i === 0 ? "turtle" : "triggerfish");
      fish.scale.multiplyScalar(i === 0 ? 1.8 : 0.4 + rng() * 0.25);
      this.root.add(fish);
      this.swimmers.push({
        object: fish,
        species: i === 0 ? "turtle" : "triggerfish",
        x: -12 + rng() * 25,
        y: 1 + rng() * 9,
        z: -9.2 - rng() * 4,
        radius: 4 + rng() * 5,
        speed: 0.07 + rng() * 0.1,
        phase: rng() * TAU,
      });
    }
    this.lightShaft(13, 27, -11, 10, -6.9, -0.32);
    this.lightShaft(7, 25, 6, 11, -6.8, -0.3);

    // Fixed workbench remains usable regardless of player decorations.
    const desk = new THREE.Group();
    desk.position.set(-11.5, -1.5, -4);
    this.root.add(desk);
    this.box(5.6, 2.2, 2.2, dark, desk, 0, 1.05, 0);
    this.box(6, 0.28, 2.5, cream, desk, 0, 2.24, 0);
    this.box(4.8, 0.07, 0.12, warmGlow, desk, 0, 1.92, 1.14);
    for (let i = -1; i <= 1; i++)
      this.box(
        1.45,
        1.2,
        0.035,
        this.mat(0x456368, 0.5, 0.5),
        desk,
        i * 1.57,
        0.9,
        1.125,
      );
    const monitor = this.mesh(
      new THREE.BoxGeometry(2.5, 1.45, 0.2),
      dark,
      desk,
      0,
      3.2,
      -0.4,
    );
    monitor.rotation.x = -0.15;
    this.box(
      2.2,
      1.17,
      0.025,
      this.mat(0x52a99c, 0.3, 0.1, 0x5ae6c2, 0.4),
      monitor,
      0,
      0,
      0.13,
    );
    const screenLine = this.mat(0xabe9c9, 0.4, 0.1, 0xabe9c9, 0.5);
    for (let i = 0; i < 4; i++)
      this.box(
        1.2 + (i % 2) * 0.55,
        0.035,
        0.025,
        screenLine,
        monitor,
        -0.13,
        0.34 - i * 0.19,
        0.16,
      );
    this.box(0.17, 0.45, 0.25, brass, desk, 0, 2.6, -0.4);
    const oxygen = new THREE.Group();
    oxygen.position.set(-3.65, 0, -0.3);
    desk.add(oxygen);
    this.mesh(
      new THREE.CapsuleGeometry(0.42, 1.65, 4, 12),
      this.mat(0xbdcaba, 0.35, 0.55),
      oxygen,
      0,
      1.1,
      0,
    );
    this.mesh(
      new THREE.CylinderGeometry(0.21, 0.21, 0.3, 10),
      brass,
      oxygen,
      0,
      2.4,
      0,
    );
    this.box(1.6, 0.14, 0.18, warmGlow, desk, 0, 0.15, 1.17);
    this.label("FIELD LAB  /  01", "#b4cec1", 3.9, 0.65, desk, 0, 1.55, 1.15);
    const spot = new THREE.PointLight(0xffce93, 24, 13, 2);
    spot.position.set(-9, 5, 2);
    this.root.add(spot);

    // Placement coordinates are the same 12 × 6 grid used by the editor.
    for (const placement of save.placements) {
      const definition = DECORATIONS.find((d) => d.id === placement.id);
      if (!definition) continue;
      const x = (placement.x + definition.w / 2 - 6) * 2.2;
      const z = (placement.y + definition.h / 2 - 3) * 2.2;
      this.contactShadow(definition.w * 2.1, definition.h * 2, x, -1.66, z);
      if (placement.id === "tank") {
        const tank = this.aquarium(save);
        tank.position.set(x, -1.67, z);
        this.root.add(tank);
      } else {
        const object = createDecoration(placement.id);
        object.position.set(x, -1.64, z);
        object.scale.multiplyScalar(1.25);
        this.root.add(object);
        if (placement.id === "seaweedPot" || placement.id === "starMobile")
          this.sways.push({
            object,
            phase: placement.x,
            angle: object.rotation.z,
          });
      }
    }
    const perimeterLight = new THREE.PointLight(0x94dacc, 12, 16, 2);
    perimeterLight.position.set(10, 6, 0);
    this.root.add(perimeterLight);
    this.renderer.render(this.scene, this.camera);
  }

  private aquarium(save: SaveData) {
    const tank = new THREE.Group();
    const w = 8.8,
      h = 5.25,
      d = 4.35;
    const frameMat = this.mat(0xd5d9c2, 0.28, 0.4),
      darkMat = this.mat(0x244b50, 0.35, 0.48),
      trim = this.mat(0xc5a063, 0.28, 0.7);
    const lightMat = this.mat(0xb4f6df, 0.3, 0.15, 0x80ecd6, 1.6),
      sandMat = this.mat(0xd0c9a0, 0.9, 0.02);
    this.box(w + 0.5, 0.52, d + 0.35, darkMat, tank, 0, 0.27, 0);
    this.box(w + 0.34, 0.13, d + 0.25, trim, tank, 0, 0.57, 0);
    this.box(w + 0.14, 0.42, d + 0.1, frameMat, tank, 0, 0.84, 0);
    this.box(w + 0.25, 0.15, d + 0.2, frameMat, tank, 0, h + 1.1, 0);
    this.box(w - 0.05, 0.06, d - 0.05, lightMat, tank, 0, h + 0.98, 0);
    this.box(w - 0.28, 0.12, d - 0.3, sandMat, tank, 0, 1.08, 0);
    for (const z of [-d / 2 - 0.05, d / 2 - 0.08]) {
      const border = roundedRect(w + 0.17, h + 0.16, 0.57);
      border.holes.push(
        new THREE.Path(roundedRect(w - 0.18, h - 0.21, 0.43).getPoints(20)),
      );
      this.mesh(
        new THREE.ExtrudeGeometry(border, {
          depth: 0.16,
          bevelEnabled: true,
          bevelSize: 0.035,
          bevelThickness: 0.035,
          bevelSegments: 2,
          curveSegments: 12,
        }),
        frameMat,
        tank,
        0,
        h / 2 + 1.04,
        z,
      );
    }
    for (const x of [-w / 2, w / 2])
      for (const z of [-d / 2, d / 2]) {
        const upright = this.mesh(
          new THREE.CylinderGeometry(0.1, 0.1, h, 8),
          frameMat,
          tank,
          x,
          h / 2 + 1.04,
          z,
        );
        upright.castShadow = false;
      }
    this.gradient(
      w - 0.1,
      h - 0.1,
      0x4aaeb0,
      0x195966,
      tank,
      0,
      h / 2 + 1.04,
      -d / 2 + 0.06,
      true,
    );
    const waterMat = this.transparent(0x5fc9c2, 0.035);
    this.box(w - 0.14, h - 0.15, d - 0.12, waterMat, tank, 0, h / 2 + 1.02, 0);
    const glassMat = this.own(
      new THREE.MeshPhysicalMaterial({
        color: 0xc4f2e5,
        transparent: true,
        opacity: 0.1,
        roughness: 0.1,
        metalness: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.mesh(
      new THREE.PlaneGeometry(w - 0.15, h - 0.15),
      glassMat,
      tank,
      0,
      h / 2 + 1.06,
      d / 2 + 0.025,
    );
    for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) {
      const glass = this.mesh(
        new THREE.PlaneGeometry(d, h),
        glassMat,
        tank,
        x,
        h / 2 + 1.05,
        0,
      );
      glass.rotation.y = Math.PI / 2;
    }
    const caustic = this.caustics(w - 0.22, d - 0.25, tank, 0, 1.15, 0);
    caustic.rotation.x = -Math.PI / 2;
    // Two soft diagonal streaks make the front pane read as glass.
    for (let i = 0; i < 2; i++) {
      const streak = this.mesh(
        new THREE.PlaneGeometry(i ? 0.09 : 0.2, h * 0.94),
        this.transparent(0xe2fff2, 0.075),
        tank,
        -w * 0.25 + i * 0.45,
        h / 2 + 1.04,
        d / 2 + 0.04,
      );
      streak.rotation.z = -0.18;
    }
    const rng = seeded(12);
    for (let i = 0; i < 12; i++) {
      const x = -3.7 + rng() * 7.4,
        z = -1.6 + rng() * 2.9;
      const plant = createPlant(90 + i);
      plant.scale.setScalar(0.7 + rng() * 1.2);
      plant.position.set(x, 1.13, z);
      tank.add(plant);
      this.sways.push({
        object: plant,
        phase: rng() * TAU,
        angle: plant.rotation.z,
      });
    }
    for (let i = 0; i < 7; i++) {
      const rock = createRock(50 + i);
      rock.scale.set(
        0.5 + rng() * 0.55,
        0.36 + rng() * 0.35,
        0.5 + rng() * 0.4,
      );
      rock.position.set(-3.4 + rng() * 6.8, 1.08, -1.4 + rng() * 2.6);
      tank.add(rock);
      if (i < 5) {
        const coral = createCoral(i, i % 2 ? 0xe39680 : 0xe3c1a0);
        coral.position.copy(rock.position);
        coral.position.y += 0.25;
        coral.scale.setScalar(0.5 + rng() * 0.45);
        tank.add(coral);
      }
    }
    save.displayed.forEach((id, i) => {
      const fish = createCreature(id);
      const scale = id === "jellyfish" ? 0.65 : 0.6;
      fish.scale.multiplyScalar(scale);
      tank.add(fish);
      this.swimmers.push({
        object: fish,
        species: id,
        x: 0,
        y: 2.35 + (i % 3) * 0.77,
        z: 0.3 - (i % 2) * 0.8,
        radius: 2.4 + (i % 2) * 0.6,
        speed: 0.22 + i * 0.027,
        phase: i * 1.43,
      });
    });
    // An intentional empty habitat is still beautiful before the first rescue.
    this.label(
      "A Q U A R I U M    0 1",
      "#d8e6d3",
      4.5,
      0.7,
      tank,
      0,
      0.79,
      d / 2 + 0.075,
    );
    const lamp = new THREE.PointLight(0x85efdb, 18, 11, 2);
    lamp.position.set(0, h, 1);
    tank.add(lamp);
    return tank;
  }

  showDive(run: RunState) {
    this.reset();
    this.viewMode = "dive";
    this.map = run.map;
    this.resize();
    this.renderer.toneMappingExposure = 1.07;
    const biome = BIOMES.find((b) => b.id === run.biome)!;
    const abyss = run.biome === "abyss";
    this.scene.background = new THREE.Color(biome.bottomColor);
    this.scene.fog = new THREE.FogExp2(
      biome.bottomColor,
      abyss ? 0.014 : 0.009,
    );
    this.camera.position.set(run.player.x, run.player.y, 45);
    this.camera.lookAt(run.player.x, run.player.y, 0);
    this.root.add(
      new THREE.HemisphereLight(
        abyss ? 0x9baee9 : 0xe3edda,
        abyss ? 0x213153 : 0x173745,
        abyss ? 1.5 : 1.85,
      ),
    );
    const sun = new THREE.DirectionalLight(
      abyss ? 0xabbcff : 0xffedd0,
      abyss ? 1.2 : 2.8,
    );
    sun.position.set(-15, 40, 25);
    this.root.add(sun);
    const rim = new THREE.DirectionalLight(abyss ? 0x35cdd0 : 0x79e8d9, 1.45);
    rim.position.set(8, 4, -16);
    this.root.add(rim);
    this.waterBackdrop = this.gradient(
      run.map.width + 220,
      52,
      abyss ? 0x253b61 : run.biome === "wreck" ? 0x215e6b : 0x237f80,
      abyss ? 0x050e24 : 0x042133,
      this.root,
      run.map.width / 2,
      run.player.y,
      -50,
    );
    this.buildTerrain(run);
    this.buildParallaxReef(run);
    this.buildParticles(run);
    this.createBubbleTrail();
    run.map.exits.forEach((exit) => this.createExit(exit.x, exit.y));
    for (const gate of run.map.gates) {
      const object = this.createGate(gate.rect.w, gate.rect.h);
      object.position.set(
        gate.rect.x + gate.rect.w / 2,
        gate.rect.y + gate.rect.h / 2,
        0,
      );
      this.root.add(object);
      this.gates.set(gate.id, object);
    }
    run.pickups.forEach((pickup) => {
      const object = this.createPickup(pickup.item);
      object.position.set(pickup.x, pickup.y, 0.4);
      this.root.add(object);
      this.pickups.set(pickup.id, object);
    });
    run.creatures.forEach((creature) => {
      const object = createCreature(creature.species);
      if (creature.species === 'glowray') {
        object.scale.setScalar(2.15);
        const glow = this.own(new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(0x57d4de) } },
          vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
          fragmentShader: 'varying vec2 vUv;uniform vec3 uColor;void main(){float a=pow(max(0.,1.-length((vUv-.5)*2.)),2.)*.15;gl_FragColor=vec4(uColor,a);}',
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        this.mesh(new THREE.PlaneGeometry(7,4), glow, object, 0, 0, -.5);
      }
      object.position.set(creature.x, creature.y, 0.3);
      this.root.add(object);
      this.creatures.set(creature.id, object);
      const halo = this.mesh(
        new THREE.RingGeometry(0.82, 0.9, 36),
        this.transparent(0xff9b82, 0, true),
        object,
        0,
        0,
        0.65,
      );
      halo.scale.setScalar(SPECIES_BY_ID[creature.species].size);
      halo.name = "hit-halo";
    });
    this.diver = createDiver();
    this.diver.position.set(run.player.x, run.player.y, 0.6);
    this.root.add(this.diver);
    this.diverLight = new THREE.PointLight(
      abyss ? 0x9ff5e3 : 0xbbffee,
      abyss ? 26 : 8,
      abyss ? 15 : 8,
      1.7,
    );
    this.diverLight.position.set(run.player.x, run.player.y, 4);
    this.root.add(this.diverLight);
    this.diverHalo = this.mesh(
      new THREE.RingGeometry(1.15, 1.28, 48),
      this.transparent(0xff7b65, 0, true),
      this.root,
      run.player.x,
      run.player.y,
      1.2,
    );
    this.scanRing = this.createScanRing();
    this.root.add(this.scanRing);
    this.toolObjects = new THREE.Group();
    this.root.add(this.toolObjects);
    this.setTool(run.tool);
    this.update(0, 0, run);
  }

  private buildTerrain(run: RunState) {
    const map = run.map,
      rng = seeded(map.seed ^ 92812),
      abyss = run.biome === "abyss",
      wreck = run.biome === "wreck";
    const sand = this.mat(
      abyss ? 0x41516d : wreck ? 0x697c75 : 0xb3b29a,
      0.93,
      0.02,
    );
    const stoneFront = this.mat(
      abyss ? 0x384864 : wreck ? 0x52656a : 0x9d9d81,
      0.85,
      0.02,
    );
    const stoneEdge = this.mat(
      abyss ? 0x2e3b59 : wreck ? 0x3e5962 : 0x63817c,
      0.92,
      0.02,
    );
    const distantMat = this.mat(
      abyss ? 0x1c304d : wreck ? 0x225361 : 0x267784,
      1,
      0.0,
    );
    const nearMat = this.mat(abyss ? 0x112239 : 0x164b53, 0.9, 0.0);
    // Four separated layers produce a real parallax seascape, not a flat background.
    for (let i = 0; i < Math.ceil(map.width / 14) + 3; i++) {
      const x = i * 14 - 10;
      const ridge = createRock(map.seed + i * 8);
      ridge.position.set(x, -map.height + 6 + rng() * 12, -25);
      ridge.scale.set(14 + rng() * 8, 13 + rng() * 17, 5);
      this.replaceMaterial(ridge, distantMat);
      this.root.add(ridge);
      this.cullObjects.push(ridge);
      const rock = createRock(i * 13 + 5);
      rock.position.set(x + 6, -map.height - 1, -12);
      rock.scale.set(10 + rng() * 8, 6 + rng() * 8, 4);
      this.replaceMaterial(rock, stoneEdge);
      this.root.add(rock);
      this.cullObjects.push(rock);
    }
    this.box(
      map.width + 60,
      12,
      12,
      sand,
      this.root,
      map.width / 2,
      -map.height - 6,
      -2,
    );
    const floorCaustic = this.caustics(
      map.width,
      15,
      this.root,
      map.width / 2,
      -map.height + 0.07,
      0,
    );
    floorCaustic.rotation.x = -Math.PI / 2;
    for (const [index, rect] of map.obstacles.entries()) {
      const group = new THREE.Group();
      group.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2, 0);
      // Broad, layered stone faces closely follow the collision rectangle.
      const w = rect.w,
        h = rect.h;
      const s = new THREE.Shape();
      s.moveTo(-w / 2, -h / 2);
      s.lineTo(w / 2, -h / 2);
      s.lineTo(w / 2, h / 2 - 0.35);
      s.lineTo(w * 0.28, h / 2);
      s.lineTo(-w * 0.32, h / 2);
      s.lineTo(-w / 2, h / 2 - 0.32);
      s.closePath();
      const face = this.mesh(
        new THREE.ExtrudeGeometry(s, {
          depth: 3.6,
          bevelEnabled: true,
          bevelSize: 0.14,
          bevelThickness: 0.2,
          bevelSegments: 1,
        }),
        index % 3 ? stoneFront : stoneEdge,
        group,
        0,
        0,
        -1.8,
      );
      if (wreck && index % 3 === 0 && w > 5) {
        this.replaceMaterial(face, this.mat(0x65736a, 0.83, 0.38));
        const plank = this.mat(0x3a5257, 0.85, 0.24);
        for (let k = -w / 2 + 0.6; k < w / 2; k += 2)
          this.box(0.14, h - 0.3, 0.14, plank, group, k, 0, 1.96);
        for (let k = -h / 2 + 1; k < h / 2; k += 1.6)
          this.box(w - 0.4, 0.12, 0.17, plank, group, 0, k, 1.98);
        this.mesh(
          new THREE.TorusGeometry(Math.min(h, w) * 0.22, 0.13, 6, 24),
          this.mat(0x927b56, 0.7, 0.55),
          group,
          0,
          0.1,
          2.02,
        );
      }
      this.box(
        Math.max(0.4, w - 0.16),
        0.12,
        3.8,
        sand,
        group,
        0,
        h / 2 + 0.015,
        -0.1,
      );
      for (let j = 0; j < Math.min(5, Math.ceil(w / 2)); j++) {
        const px = -w / 2 + 0.7 + rng() * Math.max(0.2, w - 1.4),
          pz = -1 + rng() * 2.6;
        if (rng() > 0.45) {
          const coral = createCoral(
            index + j,
            abyss
              ? [0x63c4d5, 0xbba5e1, 0x799dde][j % 3]
              : [0xd9b18c, 0xc98677, 0xaac3a1][j % 3],
          );
          coral.position.set(px, h / 2 + 0.12, pz);
          coral.scale.setScalar(0.5 + rng() * 0.6);
          group.add(coral);
        } else {
          const plant = createPlant(index + j * 51);
          plant.position.set(px, h / 2 + 0.07, pz);
          plant.scale.setScalar(0.75 + rng() * 0.8);
          group.add(plant);
          this.sways.push({ object: plant, phase: rng() * TAU, angle: 0 });
        }
      }
      this.root.add(group);
      this.cullObjects.push(group);
    }
    // Authored scenery modules are deterministic, so every seed retains a coherent visual style.
    map.scenery.forEach((scenery, i) => {
      if (this.low && i % 3 === 2) return;
      const support = map.obstacles.find(
        (rect) =>
          scenery.x >= rect.x &&
          scenery.x <= rect.x + rect.w &&
          Math.abs(scenery.y - rect.y - rect.h) < 18,
      );
      if (!support && scenery.y > -map.height + 18) return;
      const group = new THREE.Group();
      group.position.set(
        scenery.x,
        support ? support.y + support.h + 0.12 : -map.height + 0.12,
        i % 4 === 0 ? 4.2 : -4 - rng() * 3,
      );
      const foreground = i % 4 === 0;
      if (scenery.kind % 3 === 0) {
        const coral = createCoral(
          scenery.kind + i,
          abyss
            ? [0x829be0, 0xb1a0d4, 0x8ed9c9][i % 3]
            : [0xd5a789, 0xcd8e7b, 0xe2c4a0, 0xa9bda0][i % 4],
        );
        coral.scale.setScalar(scenery.scale * (foreground ? 0.9 : 1.25));
        group.add(coral);
      } else if (scenery.kind % 3 === 1) {
        const plant = createPlant(i);
        plant.scale.setScalar(scenery.scale * (foreground ? 1.2 : 1.6));
        group.add(plant);
        this.sways.push({ object: plant, phase: rng() * TAU, angle: 0 });
      } else {
        const rock = createRock(i);
        rock.scale.set(scenery.scale * 1.4, scenery.scale, scenery.scale);
        group.add(rock);
        if (foreground) this.replaceMaterial(rock, nearMat);
      }
      this.root.add(group);
      this.cullObjects.push(group);
    });
    for (let i = 0; i < Math.ceil(map.width / 16); i++) {
      const x = i * 16 + rng() * 8,
        baseY = -map.height + 1;
      for (let j = 0; j < 3; j++) {
        const plant = createPlant(501 + i * 3 + j);
        plant.position.set(x + j * 1.5, baseY, -3 - rng() * 4);
        plant.scale.setScalar(1.5 + rng() * 2.5);
        this.root.add(plant);
        this.sways.push({ object: plant, phase: rng() * TAU, angle: 0 });
        this.cullObjects.push(plant);
      }
    }
    if (!abyss) {
      for (let i = 0; i < Math.ceil(map.width / 28) + 1; i++)
        this.lightShaft(
          9 + rng() * 6,
          map.height + 28,
          i * 28 + rng() * 10,
          -map.height / 2 + 13,
          -9,
          -0.28 - rng() * 0.1,
          wreck ? 0xabbec4 : 0xcaf3d2,
        );
      // Gently rolling surface fragments are visible near the deployment depth.
      this.box(
        map.width + 60,
        0.17,
        15,
        this.transparent(0x96ecd8, 0.22),
        this.root,
        map.width / 2,
        1.2,
        -4,
      );
    }
    for (let i = 0; i < (this.low ? 16 : 30); i++) {
      const fish = createCreature(abyss ? "seaangel" : "triggerfish");
      fish.scale.multiplyScalar(0.16 + rng() * 0.15);
      this.root.add(fish);
      this.swimmers.push({
        object: fish,
        species: abyss ? "seaangel" : "triggerfish",
        x: rng() * map.width,
        y: -5 - rng() * (map.height - 10),
        z: -8 - rng() * 13,
        radius: 4 + rng() * 8,
        speed: 0.05 + rng() * 0.08,
        phase: rng() * TAU,
      });
    }
  }

  private buildParallaxReef(run: RunState) {
    const abyss = run.biome === "abyss",
      wreck = run.biome === "wreck",
      rng = seeded(run.seed + 0x14294);
    const far = this.mat(abyss ? 0x183151 : wreck ? 0x204e60 : 0x235f6b, 0.95);
    const middle = this.mat(
      abyss ? 0x3b486a : wreck ? 0x526b6c : 0x99a18d,
      0.95,
    );
    const near = this.mat(abyss ? 0x263b53 : wreck ? 0x35565a : 0x547b70, 0.9);
    const coralColors = abyss
      ? [0x8c9ed7, 0xa296d1, 0x64b9c5]
      : wreck
        ? [0xb0ad82, 0x80a699, 0xb49e84]
        : [0xeaa08d, 0xf0c1a0, 0xa9c4a5];
    const luminous = abyss
      ? coralColors.map((color) => this.mat(color, 0.5, 0.15, color, 0.8))
      : [];
    const count = 9,
      span = 13;
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < count; i++) {
        const tile = new THREE.Group();
        tile.position.z = [-31, -17, -6][layer];
        const high =
          layer === 0
            ? 14 + rng() * 8
            : layer === 1
              ? 6 + rng() * 3
              : 3 + rng() * 2;
        const rock =
          layer === 0
            ? createRock(run.seed + layer * 61 + i * 19)
            : this.roundedBoulder(
                run.seed + layer * 61 + i * 19,
                layer === 1 ? middle : near,
              );
        rock.scale.set(
          layer === 0 ? 10 + rng() * 6 : 7 + rng() * 5,
          high,
          layer === 0 ? 4 : 2.8,
        );
        this.replaceMaterial(rock, [far, middle, near][layer]);
        tile.add(rock);
        if (layer !== 0) {
          // Broad foliose fans alternate with antler coral and tall kelp silhouettes.
          const gardenSize = this.low ? 3 : 5;
          for (let j = 0; j < gardenSize; j++) {
            const px = -5 + j * (10 / (gardenSize - 1)),
              py = high * (0.62 + Math.sin(j * 0.65) * 0.22);
            if ((i + j) % 3 === 0) {
              const plant = createPlant(i * 53 + j + layer * 714);
              plant.position.set(px, py, 2.3);
              plant.scale.setScalar((layer === 1 ? 2.8 : 2.3) + rng() * 1.9);
              if (layer === 2)
                this.replaceMaterial(
                  plant,
                  this.mat(abyss ? 0x487b8b : 0x346f66, 0.8),
                );
              tile.add(plant);
              this.sways.push({ object: plant, phase: rng() * TAU, angle: 0 });
            } else {
              const coral = createCoral(i * 3 + j, coralColors[(i + j) % 3]);
              coral.position.set(px, py, 2.5);
              coral.scale.setScalar((layer === 1 ? 2.2 : 1.8) + rng() * 1.5);
              if (abyss) this.replaceMaterial(coral, luminous[(i + j) % 3]);
              tile.add(coral);
            }
          }
          // A low foreground rock shelf catches the sun while its underside stays dark.
          const lip = this.roundedBoulder(
            i * 17 + 125,
            layer === 1 ? middle : near,
          );
          lip.position.set(-2.1, high * 0.52, 2);
          lip.scale.set(5.8, 0.65, 1.4);
          tile.add(lip);
        }
        this.root.add(tile);
        this.parallaxTiles.push({
          object: tile,
          origin: i * span,
          total: count * span,
          speed: [0.16, 0.4, 0.7][layer],
          offset: [-13, -5, -5][layer],
        });
      }
    }
    // Batched shoals move more slowly than the diver, strengthening the sense of depth.
    const fishShape = new THREE.Shape();
    fishShape.moveTo(0.5, 0);
    fishShape.quadraticCurveTo(0.05, 0.24, -0.38, 0.055);
    fishShape.lineTo(-0.68, 0.24);
    fishShape.lineTo(-0.6, 0);
    fishShape.lineTo(-0.68, -0.24);
    fishShape.lineTo(-0.38, -0.055);
    fishShape.quadraticCurveTo(0.05, -0.24, 0.5, 0);
    const fishGeometry = new THREE.ShapeGeometry(fishShape, 6);
    this.schoolFish = new THREE.InstancedMesh(
      fishGeometry,
      this.own(
        new THREE.MeshBasicMaterial({
          color: abyss ? 0x528997 : 0x2b7e83,
          side: THREE.DoubleSide,
        }),
      ),
      this.low ? 30 : 54,
    );
    this.schoolFish.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.schoolFish.frustumCulled = false;
    this.root.add(this.schoolFish);
  }

  private roundedBoulder(seed: number, material: THREE.Material) {
    const root = new THREE.Group(),
      rng = seeded(seed);
    for (let i = 0; i < 3; i++) {
      const geometry = new THREE.SphereGeometry(1, 20, 14);
      const positions = geometry.getAttribute("position");
      for (let j = 0; j < positions.count; j++) {
        const x = positions.getX(j),
          y = positions.getY(j),
          z = positions.getZ(j);
        const warp =
          1 + Math.sin(x * 4.1 + seed) * Math.cos(y * 3.4 + z * 2.6) * 0.07;
        positions.setXYZ(j, x * warp, Math.max(-0.48, y * warp), z * warp);
      }
      geometry.computeVertexNormals();
      const rock = this.mesh(
        geometry,
        material,
        root,
        (rng() - 0.5) * 0.85,
        0.19 + i * 0.14,
        (rng() - 0.5) * 0.45,
      );
      rock.scale.set(
        0.75 + rng() * 0.48,
        0.54 + rng() * 0.43,
        0.65 + rng() * 0.37,
      );
      rock.rotation.y = rng() * Math.PI;
    }
    return root;
  }

  private replaceMaterial(object: THREE.Object3D, material: THREE.Material) {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) child.material = material;
    });
  }

  private buildParticles(run: RunState) {
    const count = this.low ? 190 : 460,
      rng = seeded(run.seed + 142);
    const positions = new Float32Array(count * 3),
      phases = new Float32Array(count),
      sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rng() * run.map.width;
      positions[i * 3 + 1] = -rng() * run.map.height;
      positions[i * 3 + 2] = -15 + rng() * 22;
      phases[i] = rng() * TAU;
      sizes[i] = 0.7 + rng() * 1.7;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    const material = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uHeight: { value: run.map.height },
          uRatio: { value: this.renderer.getPixelRatio() },
          uColor: {
            value: new THREE.Color(run.biome === "abyss" ? 0x91d1e9 : 0xccede0),
          },
        },
        vertexShader: `attribute float aPhase;attribute float aSize;uniform float uTime;uniform float uHeight;uniform float uRatio;varying float vAlpha;
        void main(){vec3 p=position;p.x+=sin(uTime*.08+aPhase)*.8;p.y=-mod(-p.y-uTime*.08,uHeight);vAlpha=.22+.2*sin(aPhase+uTime*.3);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=aSize*2.*uRatio;}`,
        fragmentShader: `uniform vec3 uColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5);float a=(1.-smoothstep(.12,.5,d))*vAlpha;gl_FragColor=vec4(uColor,a);}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shaders.push(material);
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.root.add(points);
  }

  private createBubbleTrail() {
    this.bubbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 7, 5),
      this.transparent(0xd2faf0, 0.23),
      this.low ? 14 : 24,
    );
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbles.frustumCulled = false;
    this.root.add(this.bubbles);
  }

  private createExit(x: number, y: number) {
    const group = new THREE.Group();
    group.position.set(x, y, -0.7);
    this.root.add(group);
    this.exitObjects.push(group);
    const cream = this.mat(0xe7ead1, 0.4, 0.4),
      navy = this.mat(0x265559, 0.4, 0.5),
      gold = this.mat(0xedbd64, 0.35, 0.6),
      glow = this.mat(0x9cf1cf, 0.2, 0.1, 0x8cefc7, 1.8);
    this.mesh(new THREE.TorusGeometry(1.6, 0.13, 8, 48), cream, group, 0, 0, 0);
    this.mesh(
      new THREE.TorusGeometry(1.38, 0.055, 6, 48),
      glow,
      group,
      0,
      0,
      0.03,
    );
    for (let i = 0; i < 4; i++) {
      const theta = (i * Math.PI) / 2;
      const bracket = this.box(
        0.25,
        0.48,
        0.2,
        navy,
        group,
        Math.cos(theta) * 1.6,
        Math.sin(theta) * 1.6,
        0,
      );
      bracket.rotation.z = theta - Math.PI / 2;
    }
    this.box(1.4, 0.34, 0.55, navy, group, 0, -1.55, 0.1);
    this.box(0.54, 0.12, 0.06, gold, group, 0, -1.32, 0.44);
    this.bar(
      [
        v3(-0.6, 1.47, 0),
        v3(-0.8, 4, -0.4),
        v3(-0.5, 8, -0.5),
        v3(-0.65, 16, -0.4),
      ],
      0.025,
      cream,
      group,
    );
    this.bar(
      [v3(0.6, 1.47, 0), v3(0.9, 4, -0.4), v3(0.6, 8, -0.5), v3(0.7, 16, -0.4)],
      0.025,
      cream,
      group,
    );
    this.mesh(new THREE.ConeGeometry(0.26, 0.4, 3), glow, group, 0, 0.3, 0.1);
    this.box(0.085, 0.7, 0.1, glow, group, 0, -0.18, 0.1);
    const aura = this.mesh(
      new THREE.CircleGeometry(2.3, 48),
      this.transparent(0x82f5d0, 0.055, true),
      group,
      0,
      0,
      -0.1,
    );
    aura.name = "aura";
    this.label("RETURN", "#c0edd3", 2.15, 0.48, group, 0, -2.03, 0.1);
    const light = new THREE.PointLight(0x9ceccc, 10, 7, 2);
    light.position.z = 2;
    group.add(light);
  }

  private createGate(width: number, height: number) {
    const group = new THREE.Group(),
      metal = this.mat(0x485f63, 0.6, 0.7),
      stripe = this.mat(0xd0ad68, 0.6, 0.45),
      glow = this.mat(0xeeae79, 0.3, 0.2, 0xdca765, 0.6);
    for (let i = -height / 2; i < height / 2; i += 1.2) {
      const slat = this.box(width, 0.35, 0.6, metal, group, 0, i + 0.4, 0.7);
      slat.rotation.z = 0.12;
      this.box(width * 0.5, 0.13, 0.05, stripe, group, 0, i + 0.4, 1.04);
    }
    for (const x of [-width / 2, width / 2])
      this.box(0.35, height + 0.4, 1, metal, group, x, 0, 0.6);
    this.box(0.17, height - 0.4, 0.13, glow, group, 0, 0, 1.1);
    this.mesh(
      new THREE.RingGeometry(0.45, 0.52, 4),
      stripe,
      group,
      0,
      0.1,
      1.17,
    );
    return group;
  }

  private createPickup(item: string) {
    const group = new THREE.Group();
    const blueprint = item.startsWith("blueprint");
    const colors: Record<string, number> = {
      scrap: 0xc9c8ad,
      mineral: 0x95d3d4,
      fiber: 0xb7d49b,
      shell: 0xefb39a,
      fang: 0xe2d5a9,
      lumen: 0xa8b8ff,
      blueprintReef: 0xecc780,
      blueprintDeep: 0xc4b0f8,
    };
    const color = colors[item] ?? 0xb4ebdf;
    const m = this.mat(
      color,
      0.3,
      blueprint ? 0.45 : 0.3,
      color,
      blueprint ? 0.65 : 0.15,
    );
    if (blueprint) {
      this.box(0.84, 0.65, 0.15, this.mat(0x254d5b, 0.36, 0.6), group, 0, 0, 0);
      this.box(0.68, 0.5, 0.02, m, group, 0, 0, 0.1);
      const lines = this.mat(0x3f7479, 0.5);
      for (let i = 0; i < 3; i++)
        this.box(
          0.43 - i * 0.07,
          0.035,
          0.02,
          lines,
          group,
          -0.025,
          0.12 - i * 0.12,
          0.12,
        );
      const ring = this.mesh(
        new THREE.RingGeometry(0.86, 0.89, 48),
        this.transparent(color, 0.47, true),
        group,
        0,
        0,
        0,
      );
      ring.name = "pickup-ring";
      this.mesh(new THREE.OctahedronGeometry(0.14), m, group, 0, 0.89, 0);
      const light = new THREE.PointLight(color, 3, 4, 2);
      light.position.z = 1;
      group.add(light);
    } else if (item === "fiber") {
      for (let i = 0; i < 3; i++) {
        const leaf = this.mesh(
          new THREE.CapsuleGeometry(0.1, 0.55, 2, 6),
          m,
          group,
          -0.17 + i * 0.17,
          0.05,
          0,
        );
        leaf.rotation.z = -0.28 + i * 0.25;
      }
      this.box(0.63, 0.1, 0.18, this.mat(0x467873, 0.8), group, 0, -0.1, 0.1);
    } else if (item === "scrap") {
      const piece = this.box(0.55, 0.43, 0.24, m, group, 0, 0, 0);
      piece.rotation.z = 0.27;
      this.mesh(
        new THREE.TorusGeometry(0.24, 0.085, 6, 12),
        this.mat(0x789997, 0.5, 0.65),
        group,
        0.1,
        0.09,
        0.21,
      );
    } else if (item === "shell" || item === "fang") {
      this.mesh(
        new THREE.ConeGeometry(0.28, 0.64, item === "shell" ? 7 : 5),
        m,
        group,
        0,
        0,
        0,
      ).rotation.z = item === "shell" ? -Math.PI / 2 : -0.3;
    } else {
      this.mesh(
        new THREE.OctahedronGeometry(0.42),
        m,
        group,
        0,
        0,
        0,
      ).rotation.z = 0.3;
      this.mesh(
        new THREE.OctahedronGeometry(0.21),
        m,
        group,
        0.29,
        -0.15,
        0.08,
      );
    }
    if (!blueprint)
      this.mesh(
        new THREE.RingGeometry(0.65, 0.68, 24),
        this.transparent(color, 0.26, true),
        group,
        0,
        0,
        -0.08,
      );
    group.userData.baseY = 0;
    group.userData.blueprint = blueprint;
    return group;
  }

  private createScanRing() {
    const material = this.own(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uColor: { value: new THREE.Color(0xa7f3d3) },
        },
        vertexShader:
          "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: `varying vec2 vUv;uniform float uTime;uniform float uProgress;uniform vec3 uColor;
        void main(){vec2 p=vUv-.5;float r=length(p);float a=fract((atan(p.y,p.x)+1.5708)/6.28318+1.);float ring=(1.-smoothstep(.009,.018,abs(r-.43)));
          float progress=1.-step(uProgress,a);float marks=pow(max(0.,cos(a*6.28318*24.)),18.);
          float alpha=ring*(.16+.76*progress)+marks*(1.-smoothstep(.003,.008,abs(r-.48)))*.45;
          gl_FragColor=vec4(uColor,alpha);}`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shaders.push(material);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
    mesh.visible = false;
    return mesh;
  }

  private setTool(tool: string) {
    if (!this.toolObjects || tool === this.previousTool) return;
    this.toolObjects.children.forEach((o) => (o.visible = false));
    let object = this.toolObjects.getObjectByName(tool);
    if (!object) {
      object = new THREE.Group();
      object.name = tool;
      this.toolObjects.add(object);
      const metal = this.mat(0x769a9c, 0.35, 0.6),
        dark = this.mat(0x244551, 0.6, 0.4);
      if (tool === "net") {
        const hoop = this.mesh(
          new THREE.TorusGeometry(0.47, 0.055, 6, 24),
          metal,
          object,
          0.72,
          0.1,
          0.1,
        );
        hoop.rotation.y = 0.2;
        for (let i = -2; i <= 2; i++)
          this.box(
            0.7,
            0.012,
            0.01,
            this.transparent(0xd7f1d8, 0.45),
            object,
            0.73,
            0.1 + i * 0.13,
            0.1,
          );
        this.box(0.7, 0.085, 0.085, metal, object, 0.15, 0.1, 0.1);
      } else if (tool === "spear") {
        this.box(1.2, 0.11, 0.14, dark, object, 0.4, 0.1, 0.1);
        this.box(1.35, 0.035, 0.035, metal, object, 0.68, 0.15, 0.1);
        this.mesh(
          new THREE.ConeGeometry(0.12, 0.28, 5),
          metal,
          object,
          1.45,
          0.15,
          0.1,
        ).rotation.z = -Math.PI / 2;
      } else {
        this.box(0.62, 0.24, 0.23, dark, object, 0.46, 0.11, 0.1);
        const glow = this.mat(
          tool === "scanner" ? 0xabe9c7 : 0xf2c285,
          0.22,
          0.25,
          tool === "scanner" ? 0x8eeee2 : 0xedb774,
          1.3,
        );
        this.mesh(
          new THREE.CylinderGeometry(0.15, 0.15, 0.12, 12),
          glow,
          object,
          0.82,
          0.12,
          0.1,
        ).rotation.z = Math.PI / 2;
      }
    }
    object.visible = true;
    this.previousTool = tool;
  }

  update(dt: number, time: number, run?: RunState, _save?: SaveData) {
    if (this.disposed) return;
    for (const shader of this.shaders)
      if (shader.uniforms.uTime) shader.uniforms.uTime.value = time;
    for (const sway of this.sways) {
      if (!sway.object.parent?.visible) continue;
      sway.object.rotation.z =
        sway.angle + Math.sin(time * 0.6 + sway.phase) * 0.055;
    }
    for (const fish of this.swimmers) {
      const t = time * fish.speed + fish.phase;
      const vx = Math.cos(t);
      fish.object.position.set(
        fish.x + Math.sin(t) * fish.radius,
        fish.y + Math.sin(t * 1.6) * 0.28,
        fish.z + Math.cos(t) * 0.23,
      );
      const magnitude = Math.abs(fish.object.scale.x);
      fish.object.scale.x = (vx < 0 ? -1 : 1) * magnitude;
      animateCreature(fish.object, time + fish.phase, 0.65);
      if (this.viewMode === "dive")
        fish.object.visible =
          Math.abs(fish.object.position.x - this.camera.position.x) < 52 &&
          Math.abs(fish.object.position.y - this.camera.position.y) < 38;
    }
    if (this.viewMode === "dive" && run && this.diver)
      this.updateDive(dt, time, run);
    this.renderer.render(this.scene, this.camera);
  }

  private updateDive(dt: number, time: number, run: RunState) {
    const player = run.player,
      diver = this.diver!;
    diver.position.set(player.x, player.y, 0.7);
    const speed = Math.hypot(player.vx, player.vy),
      angle =
        speed > 0.1 ? Math.atan2(player.vy, Math.abs(player.vx) + 0.05) : 0;
    diver.scale.x = (player.facing < 0 ? -1 : 1) * 0.9;
    diver.rotation.z = angle * (player.facing < 0 ? -1 : 1) * 0.35;
    animateDiver(diver, time, speed, angle);
    const ax = this.hasAim ? this.aim.x : player.facing,
      ay = this.hasAim ? this.aim.y : 0;
    const cos = Math.cos(diver.rotation.z),
      sin = Math.sin(diver.rotation.z);
    const arm = diver.userData.aimArm as THREE.Object3D | undefined;
    if (arm)
      arm.rotation.z = Math.atan2(
        ay * cos - ax * sin,
        player.facing * (ax * cos + ay * sin),
      );
    if (this.diverLight)
      this.diverLight.position.set(
        player.x + player.facing * 1.2,
        player.y + 0.6,
        3.2,
      );
    if (this.diverHalo) {
      this.diverHalo.position.set(player.x, player.y, 2);
      (this.diverHalo.material as THREE.MeshBasicMaterial).opacity =
        player.hitFlash * 0.55;
      this.diverHalo.scale.setScalar(1 + player.hitFlash * 0.5);
    }
    if (this.toolObjects) {
      this.setTool(run.tool);
      const shoulderX = player.x + cos * 0.225 * player.facing + sin * 0.108;
      const shoulderY = player.y + sin * 0.225 * player.facing - cos * 0.108;
      this.toolObjects.position.set(
        shoulderX + ax * 0.35,
        shoulderY + ay * 0.35,
        1.17,
      );
      this.toolObjects.scale.x = 1;
      this.toolObjects.rotation.z = Math.atan2(ay, ax);
    }
    const aspect = (this.camera.right - this.camera.left) / this.viewHeight;
    const halfW = (this.viewHeight * aspect) / 2,
      halfH = this.viewHeight / 2;
    const targetX = clamp(
      player.x + player.vx * 0.28,
      Math.min(halfW - 4, run.map.width / 2),
      Math.max(run.map.width - halfW + 4, run.map.width / 2),
    );
    const targetY = clamp(
      player.y + player.vy * 0.18,
      -run.map.height + halfH - 5,
      5 - halfH,
    );
    const smoothing = dt > 0 ? 1 - Math.exp(-dt * 4) : 1;
    this.camera.position.x += (targetX - this.camera.position.x) * smoothing;
    this.camera.position.y += (targetY - this.camera.position.y) * smoothing;
    if (this.waterBackdrop)
      this.waterBackdrop.position.y = this.camera.position.y;
    for (const tile of this.parallaxTiles) {
      const x =
        ((tile.origin -
          this.camera.position.x * tile.speed +
          tile.total * 100) %
          tile.total) -
        tile.total / 2;
      tile.object.position.x = this.camera.position.x + x;
      const sideRise =
        tile.speed > 0.5 ? Math.min(1.5, Math.abs(x) / halfW) ** 1.6 * 4.8 : 0;
      tile.object.position.y =
        this.camera.position.y - halfH + tile.offset + sideRise;
      tile.object.visible = Math.abs(x) < halfW + 20;
    }
    if (this.schoolFish) {
      for (let i = 0; i < this.schoolFish.count; i++) {
        const school = Math.floor(i / 18),
          index = i % 18;
        const lane =
          ((school * 25 + time * 0.42 - this.camera.position.x * 0.22 + 1500) %
            76) -
          38;
        this.dummy.position.set(
          this.camera.position.x + lane + (index % 6) * 1.3,
          this.camera.position.y +
            4 +
            Math.sin(school * 3.1 + index * 1.1) * 2.4 +
            Math.sin(time * 0.9 + index) * 0.13,
          -13 - school * 3,
        );
        this.dummy.scale.setScalar(0.3 + (index % 4) * 0.05);
        this.dummy.rotation.set(0, 0, Math.sin(time * 2 + index) * 0.1);
        this.dummy.updateMatrix();
        this.schoolFish.setMatrixAt(i, this.dummy.matrix);
      }
      this.schoolFish.instanceMatrix.needsUpdate = true;
    }
    for (const object of this.cullObjects)
      object.visible =
        Math.abs(object.position.x - this.camera.position.x) < halfW + 28 &&
        Math.abs(object.position.y - this.camera.position.y) < halfH + 35;
    for (const creature of run.creatures) {
      const object = this.creatures.get(creature.id);
      if (!object) continue;
      object.visible = creature.alive && !creature.captured;
      if (!object.visible) continue;
      object.position.set(creature.x, creature.y, 0.45);
      const scale = Math.abs(object.scale.x);
      object.scale.x = (creature.facing < 0 ? -1 : 1) * scale;
      animateCreature(
        object,
        time + creature.homeX,
        Math.min(1.8, 0.5 + Math.hypot(creature.vx, creature.vy) * 0.16),
      );
      const halo = object.getObjectByName("hit-halo") as THREE.Mesh | undefined;
      if (halo) {
        (halo.material as THREE.MeshBasicMaterial).opacity =
          creature.hitFlash * 0.8;
        halo.scale.setScalar(
          SPECIES_BY_ID[creature.species].size * (1 + creature.hitFlash * 0.5),
        );
      }
    }
    for (const pickup of run.pickups) {
      let object = this.pickups.get(pickup.id);
      if (!object) {
        object = this.createPickup(pickup.item);
        this.root.add(object);
        this.pickups.set(pickup.id, object);
      }
      object.visible = !pickup.collected;
      if (object.visible) {
        object.position.set(
          pickup.x,
          pickup.y + Math.sin(time * 1.7 + pickup.x) * 0.15,
          0.5,
        );
        object.rotation.y = object.userData.blueprint
          ? Math.sin(time + pickup.x) * 0.22
          : time * 0.3 + pickup.x;
      }
    }
    for (const gate of run.map.gates) {
      const object = this.gates.get(gate.id);
      if (object) {
        object.visible = !gate.open;
        object.scale.x = 1 - gate.progress * 0.15;
      }
    }
    const ids = new Set(run.projectiles.map((p) => p.id));
    for (const [id, projectile] of this.projectiles)
      if (!ids.has(id)) {
        projectile.visible = false;
      }
    for (const p of run.projectiles) {
      let object = this.projectiles.get(p.id);
      if (!object) {
        // Reuse inactive projectiles, avoiding geometry churn during long fights.
        const unused = [...this.projectiles.entries()].find(
          ([id]) => !ids.has(id),
        );
        if (unused) {
          this.projectiles.delete(unused[0]);
          object = unused[1];
        } else {
          object = new THREE.Group();
          this.box(
            1.2,
            0.045,
            0.045,
            this.mat(0xd9dfc2, 0.27, 0.8),
            object,
            0,
            0,
            0,
          );
          const tip = this.mesh(
            new THREE.ConeGeometry(0.1, 0.25, 4),
            this.mat(0xb3edcf, 0.3, 0.5, 0x87ddc7, 0.5),
            object,
            0.69,
            0,
            0,
          );
          tip.rotation.z = -Math.PI / 2;
          this.root.add(object);
        }
        this.projectiles.set(p.id, object);
      }
      object.visible = true;
      object.position.set(p.x, p.y, 1.2);
      object.rotation.z = Math.atan2(p.vy, p.vx);
    }
    if (this.scanRing) {
      const target = run.creatures.find(
        (c) => c.id === run.targetId && c.alive,
      );
      this.scanRing.visible =
        !!target && (run.tool === "scanner" || run.tool === "net");
      if (target) {
        this.scanRing.position.set(target.x, target.y, 2.3);
        this.scanRing.scale.setScalar(
          Math.max(0.75, SPECIES_BY_ID[target.species].size * 0.58),
        );
        this.scanRing.material.uniforms.uProgress.value =
          run.tool === "scanner" ? target.scanProgress : run.progress;
      }
    }
    for (let i = 0; i < this.exitObjects.length; i++) {
      const exit = this.exitObjects[i];
      exit.position.y = run.map.exits[i].y + Math.sin(time * 0.8 + i) * 0.08;
      const aura = exit.getObjectByName("aura");
      if (aura) aura.scale.setScalar(1 + Math.sin(time * 1.3) * 0.08);
    }
    if (this.bubbles) {
      for (let i = 0; i < this.bubbles.count; i++) {
        const life = (time * 0.38 + i / this.bubbles.count) % 1;
        this.dummy.position.set(
          player.x -
            player.facing * (0.5 + life * 0.8) +
            Math.sin(i * 13 + time) * life * 0.5,
          player.y + 0.4 + life * 5,
          0.45 + (i % 3) * 0.14,
        );
        const scale = 0.035 + life * 0.075;
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        this.bubbles.setMatrixAt(i, this.dummy.matrix);
      }
      this.bubbles.instanceMatrix.needsUpdate = true;
    }
  }

  pointerToWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.mouse, this.camera);
    this.raycaster.ray.intersectPlane(this.waterPlane, this.projected);
    return { x: this.projected.x, y: this.projected.y };
  }

  dispose() {
    if (this.disposed) return;
    this.reset();
    this.renderer.dispose();
    this.disposed = true;
  }
}
