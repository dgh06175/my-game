import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ART, material } from "./materials";

// Original procedural models. The game downloads no third-party models or textures.
// X is the swimming axis; Y is up, and Z gives every silhouette real volume.
const sphere = new THREE.SphereGeometry(1, 20, 14);
const smallSphere = new THREE.SphereGeometry(1, 12, 9);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 14);
const box = new THREE.BoxGeometry(1, 1, 1);
for (const geometry of [sphere, smallSphere, cylinder, box])
  geometry.userData.shared = true;
type Mat = THREE.Material;
type V3 = [number, number, number];
type Motion = {
  node: THREE.Object3D;
  axis: "x" | "y" | "z";
  rest: number;
  amplitude: number;
  speed: number;
  phase: number;
};

/** Batch same-material details while preserving every independently animated part. */
function finishModel(root: THREE.Group): THREE.Group {
  const animated = new Set<THREE.Object3D>();
  const groups: THREE.Group[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Group) groups.push(node);
    for (const item of (node.userData.motions ?? []) as Motion[])
      animated.add(item.node);
    if (node.userData.bell) animated.add(node.userData.bell);
    if (node.userData.aimArm) animated.add(node.userData.aimArm);
  });
  for (const group of groups.reverse()) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const child of group.children) {
      if (
        !(child instanceof THREE.Mesh) ||
        animated.has(child) ||
        child.children.length ||
        Array.isArray(child.material) ||
        child.material.transparent
      )
        continue;
      const key = `${child.material.uuid}/${!!child.geometry.index}/${Object.keys(child.geometry.attributes).sort().join(",")}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(child);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 3) continue;
      const transformed = bucket.map((part) => {
        part.updateMatrix();
        return part.geometry.clone().applyMatrix4(part.matrix);
      });
      const geometry = mergeGeometries(transformed, false);
      for (const temporary of transformed) temporary.dispose();
      if (!geometry) continue;
      // Cloning a shared primitive copies userData; this new allocation is not shared.
      geometry.userData.shared = false;
      group.add(new THREE.Mesh(geometry, bucket[0].material));
      for (const part of bucket) {
        group.remove(part);
        if (!part.geometry.userData.shared) part.geometry.dispose();
      }
    }
  }
  return root;
}

function mesh(
  geometry: THREE.BufferGeometry,
  mat: Mat,
  at: V3 = [0, 0, 0],
  scale: V3 = [1, 1, 1],
) {
  const part = new THREE.Mesh(geometry, mat);
  part.position.set(...at);
  part.scale.set(...scale);
  part.castShadow = false;
  part.receiveShadow = true;
  return part;
}

function orb(
  parent: THREE.Object3D,
  mat: Mat,
  at: V3,
  scale: V3,
  detail = false,
) {
  const part = mesh(detail ? smallSphere : sphere, mat, at, scale);
  parent.add(part);
  return part;
}

function block(parent: THREE.Object3D, mat: Mat, at: V3, scale: V3) {
  const part = mesh(box, mat, at, scale);
  parent.add(part);
  return part;
}

function tube(
  points: V3[],
  radius: number,
  mat: Mat,
  segments = 18,
  radial = 7,
) {
  const path = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
  );
  return mesh(
    new THREE.TubeGeometry(path, segments, radius, radial, false),
    mat,
  );
}

function rod(parent: THREE.Object3D, a: V3, b: V3, radius: number, mat: Mat) {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b);
  const part = mesh(cylinder, mat);
  part.position.copy(start).add(end).multiplyScalar(0.5);
  part.scale.set(radius, start.distanceTo(end), radius);
  part.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    end.sub(start).normalize(),
  );
  parent.add(part);
  return part;
}

/** Rounded outline with a small bevel: a fin has thickness when the camera moves. */
function fin(points: [number, number][], mat: Mat, depth = 0.035) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    true,
    "catmullrom",
    0.25,
  );
  const shape = new THREE.Shape(
    curve.getPoints(30).map((p) => new THREE.Vector2(p.x, p.y)),
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.018,
    bevelThickness: 0.018,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -depth / 2);
  return mesh(geometry, mat);
}

function motion(
  root: THREE.Group,
  node: THREE.Object3D,
  axis: Motion["axis"],
  amplitude: number,
  speed: number,
  phase = 0,
) {
  const list: Motion[] = (root.userData.motions ??= []);
  list.push({ node, axis, rest: node.rotation[axis], amplitude, speed, phase });
}

function eye(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius = 0.085,
  iris = 0xf4d989,
) {
  for (const side of [-1, 1]) {
    orb(
      parent,
      material(iris, 0.28),
      [x, y, z * side],
      [radius * 1.16, radius * 1.16, radius * 0.42],
      true,
    );
    orb(
      parent,
      ART.eye,
      [x + radius * 0.19, y, (z + radius * 0.26) * side],
      [radius * 0.7, radius * 0.78, radius * 0.26],
      true,
    );
    orb(
      parent,
      ART.white,
      [x + radius * 0.32, y + radius * 0.35, (z + radius * 0.44) * side],
      [radius * 0.19, radius * 0.19, radius * 0.12],
      true,
    );
  }
}

function fishTail(root: THREE.Group, x: number, mat: Mat, size = 1) {
  const pivot = new THREE.Group();
  pivot.position.x = x;
  pivot.name = "tail";
  const shape = fin(
    [
      [0.08, 0],
      [-0.35, 0.36],
      [-0.67, 0.55],
      [-0.56, 0],
      [-0.67, -0.55],
      [-0.35, -0.36],
    ],
    mat,
  );
  shape.scale.setScalar(size);
  pivot.add(shape);
  root.add(pivot);
  motion(root, pivot, "y", 0.42, 6.2);
  return pivot;
}

function fishFins(root: THREE.Group, color: number, height = 0.45) {
  const mat = material(color, 0.44);
  const dorsal = fin(
    [
      [0.5, 0],
      [0.23, height],
      [-0.25, height * 0.78],
      [-0.65, 0],
    ],
    mat,
  );
  dorsal.position.y = 0.33;
  root.add(dorsal);
  motion(root, dorsal, "x", 0.08, 3.3);
  for (const side of [-1, 1]) {
    const pectoral = fin(
      [
        [0.1, 0.05],
        [-0.04, -0.24],
        [-0.45, -0.42],
        [-0.3, 0.02],
      ],
      mat,
    );
    pectoral.position.set(0.15, -0.09, side * 0.29);
    pectoral.rotation.x = side * 0.6;
    root.add(pectoral);
    motion(root, pectoral, "x", 0.32, 4.8, side);
  }
}

function createClownfish() {
  const root = new THREE.Group();
  const orange = material(0xf39841, 0.45);
  orb(root, orange, [0, 0, 0], [0.84, 0.45, 0.28]);
  orb(root, material(0xffc160), [0.28, -0.17, 0], [0.47, 0.2, 0.245]);
  for (const [x, y, z] of [
    [0.46, 0.372, 0.233],
    [-0.05, 0.465, 0.291],
    [-0.59, 0.33, 0.208],
  ]) {
    orb(root, ART.ink, [x, 0, 0], [0.145, y, z]);
    orb(root, ART.white, [x, 0, 0], [0.105, y + 0.008, z + 0.008]);
  }
  const tail = fishTail(root, -0.7, ART.ink, 0.75);
  const inner = fin(
    [
      [0.02, 0],
      [-0.28, 0.25],
      [-0.45, 0.32],
      [-0.39, 0],
      [-0.45, -0.32],
      [-0.28, -0.25],
    ],
    orange,
  );
  inner.position.z = 0.03;
  tail.add(inner);
  fishFins(root, 0xe7752c, 0.27);
  eye(root, 0.56, 0.12, 0.21, 0.085);
  orb(root, material(0xf8b067), [0.8, -0.035, 0], [0.11, 0.08, 0.12], true);
  root.scale.setScalar(0.95);
  return root;
}

function createSeahorse() {
  const root = new THREE.Group();
  const body = material(0xf2c167),
    ridge = material(0xdc8851);
  const spine = tube(
    [
      [-0.11, -0.3, 0],
      [-0.16, 0.1, 0],
      [-0.17, 0.56, 0],
      [0.05, 0.89, 0],
      [0.34, 0.86, 0],
    ],
    0.155,
    body,
    28,
    10,
  );
  root.add(spine);
  orb(root, body, [-0.05, 0.06, 0], [0.26, 0.47, 0.17]);
  orb(root, body, [0.23, 0.89, 0], [0.26, 0.19, 0.15]);
  rod(root, [0.33, 0.86, 0], [0.69, 0.76, 0], 0.065, body);
  orb(root, ridge, [0.69, 0.76, 0], [0.035, 0.075, 0.075], true);
  const curl = tube(
    [
      [-0.06, -0.27, 0],
      [0.03, -0.66, 0],
      [-0.13, -0.94, 0],
      [-0.41, -0.9, 0],
      [-0.49, -0.66, 0],
      [-0.35, -0.59, 0],
      [-0.26, -0.71, 0],
    ],
    0.065,
    body,
    30,
    8,
  );
  root.add(curl);
  motion(root, curl, "y", 0.13, 1.6);
  for (let i = 0; i < 7; i++) {
    const y = -0.3 + i * 0.14;
    root.add(
      tube(
        [
          [-0.23, y, 0.025],
          [-0.1, y - 0.06, 0.169],
          [0.08, y - 0.05, 0.16],
          [0.17, y, 0.06],
        ],
        0.016,
        ridge,
        10,
        5,
      ),
    );
  }
  const backfin = fin(
    [
      [0, 0.3],
      [-0.32, 0.22],
      [-0.41, -0.15],
      [-0.08, -0.3],
    ],
    material(0xffd69a, 0.46, 0.02, 0, 0.75),
  );
  backfin.position.set(-0.25, 0.18, 0);
  root.add(backfin);
  motion(root, backfin, "y", 0.42, 15);
  for (let i = 0; i < 4; i++) {
    const crown = fin(
      [
        [0, 0],
        [-0.07, 0.16 + (i % 2) * 0.06],
        [0.08, 0.06],
      ],
      ridge,
    );
    crown.position.set(-0.01 + i * 0.09, 1.02, 0);
    root.add(crown);
  }
  eye(root, 0.23, 0.96, 0.139, 0.069, 0xf6e5a3);
  root.scale.setScalar(0.8);
  return root;
}

function turtleFlipper(
  root: THREE.Group,
  x: number,
  side: number,
  front: boolean,
) {
  const pivot = new THREE.Group();
  pivot.position.set(x, -0.09, side * 0.34);
  const flipper = fin(
    [
      [0.16, 0.06],
      [0.16, -0.36],
      [-0.2, front ? -0.96 : -0.54],
      [-0.44, front ? -0.93 : -0.5],
      [-0.32, -0.24],
      [-0.1, 0.11],
    ],
    material(0x84b899),
  );
  flipper.rotation.x = side * 0.9;
  pivot.add(flipper);
  root.add(pivot);
  motion(root, pivot, "x", 0.28, 2.3, side + (front ? 0 : 0.9));
}

function createTurtle() {
  const root = new THREE.Group();
  orb(root, material(0xc7cfa2), [0, -0.12, 0], [0.96, 0.22, 0.55]);
  orb(root, material(0x427e75, 0.65), [-0.08, 0.06, 0], [1.01, 0.43, 0.61]);
  // Raised polygonal scutes form a shell that reads from both camera sides.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = -0.71 + i * 0.32;
      const shrink = Math.sqrt(Math.max(0.1, 1 - (x / 1.03) ** 2));
      const scute = mesh(
        new THREE.IcosahedronGeometry(1, 0),
        material(i % 2 ? 0x679887 : 0x588f7a),
      );
      scute.position.set(x, 0.12, side * (0.48 * shrink));
      scute.scale.set(0.235, 0.27 * shrink, 0.16);
      root.add(scute);
    }
  }
  orb(root, material(0x92b999), [0.94, 0.03, 0], [0.41, 0.22, 0.25]);
  orb(root, material(0xabcba5), [1.17, 0.045, 0], [0.24, 0.2, 0.24]);
  eye(root, 1.22, 0.105, 0.214, 0.047);
  turtleFlipper(root, 0.48, -1, true);
  turtleFlipper(root, 0.48, 1, true);
  turtleFlipper(root, -0.63, -1, false);
  turtleFlipper(root, -0.63, 1, false);
  root.add(
    tube(
      [
        [-0.86, -0.11, 0],
        [-1.14, -0.18, 0],
        [-1.24, -0.2, 0],
      ],
      0.055,
      material(0x86b097),
      8,
      6,
    ),
  );
  return root;
}

function createCrab() {
  const root = new THREE.Group();
  const shell = material(0xc97a58, 0.48),
    edge = material(0xe5a378),
    dark = material(0x9f5849);
  orb(root, shell, [0, 0.03, 0], [0.54, 0.34, 0.66]);
  orb(root, edge, [0.09, -0.13, 0], [0.43, 0.14, 0.55]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Group();
      const x = -0.42 + i * 0.23;
      leg.position.set(x, -0.05, side * 0.44);
      leg.add(
        tube(
          [
            [0, 0, 0],
            [-0.18, 0.05, side * 0.45],
            [0.03, -0.33, side * 0.61],
            [0.16, -0.4, side * 0.62],
          ],
          0.055,
          shell,
          10,
          6,
        ),
      );
      root.add(leg);
      motion(root, leg, "x", 0.18, 5.2, i * 1.6 + side);
    }
    const claw = new THREE.Group();
    claw.position.set(0.39, 0.01, side * 0.4);
    claw.add(
      tube(
        [
          [0, 0, 0],
          [0.29, 0.06, side * 0.29],
          [0.6, 0.14, side * 0.29],
        ],
        0.095,
        shell,
        10,
        7,
      ),
    );
    orb(claw, edge, [0.62, 0.14, side * 0.3], [0.27, 0.18, 0.19]);
    const tip = fin(
      [
        [0, -0.13],
        [0.34, -0.06],
        [0.48, 0.1],
        [0.21, 0.03],
        [0, 0.08],
      ],
      shell,
      0.09,
    );
    tip.position.set(0.73, 0.15, side * 0.3);
    claw.add(tip);
    const thumb = fin(
      [
        [0, -0.04],
        [0.26, 0.15],
        [0.41, 0.18],
        [0.19, 0.23],
        [0, 0.14],
      ],
      dark,
      0.07,
    );
    thumb.position.set(0.7, 0.18, side * 0.3);
    claw.add(thumb);
    root.add(claw);
    motion(root, claw, "z", 0.08, 2.8, side);
    rod(
      root,
      [0.33, 0.18, side * 0.27],
      [0.49, 0.47, side * 0.32],
      0.034,
      dark,
    );
    orb(root, ART.eye, [0.5, 0.48, side * 0.32], [0.082, 0.083, 0.075], true);
    orb(
      root,
      ART.white,
      [0.53, 0.51, side * 0.37],
      [0.018, 0.022, 0.012],
      true,
    );
  }
  for (let i = 0; i < 5; i++)
    orb(root, edge, [-0.4 + i * 0.19, 0.31, 0], [0.055, 0.04, 0.065], true);
  return root;
}

function createTriggerfish() {
  const root = new THREE.Group();
  orb(root, material(0x599b9a), [0, 0, 0], [0.83, 0.57, 0.27]);
  orb(root, material(0xd5c591), [0.43, -0.04, 0], [0.37, 0.31, 0.235]);
  fishTail(root, -0.73, material(0x265d73), 0.63);
  fishFins(root, 0x3b8090, 0.49);
  const chin = fin(
    [
      [0.55, 0],
      [0.2, -0.48],
      [-0.35, -0.14],
      [-0.57, 0],
    ],
    material(0x84bfbc),
  );
  chin.position.y = -0.3;
  root.add(chin);
  for (const side of [-1, 1]) {
    const stripe = tube(
      [
        [0.42, 0.42, side * 0.165],
        [0.32, 0.18, side * 0.265],
        [0.44, -0.1, side * 0.258],
        [0.62, -0.22, side * 0.158],
      ],
      0.065,
      material(0x173e57),
      15,
      7,
    );
    root.add(stripe);
    for (let i = 0; i < 12; i++) {
      const x = -0.57 + (i % 4) * 0.18,
        y = -0.21 + Math.floor(i / 4) * 0.2;
      const z =
        0.28 * Math.sqrt(Math.max(0.1, 1 - (x / 0.9) ** 2 - (y / 0.65) ** 2));
      orb(
        root,
        material(0xb5ddc1),
        [x, y, z * side],
        [0.032, 0.048, 0.014],
        true,
      );
    }
  }
  eye(root, 0.48, 0.2, 0.215, 0.08);
  orb(root, material(0xe5d498), [0.81, -0.08, 0], [0.1, 0.09, 0.11], true);
  return root;
}

function createPuffer() {
  const root = new THREE.Group();
  orb(root, material(0xd5c185), [0, 0, 0], [0.69, 0.59, 0.46]);
  orb(root, material(0xf0deb2), [0.15, -0.23, 0], [0.51, 0.36, 0.39]);
  fishTail(root, -0.61, material(0xc19960), 0.48);
  for (const side of [-1, 1]) {
    const pectoral = fin(
      [
        [0, 0],
        [-0.26, 0.13],
        [-0.43, -0.12],
        [-0.21, -0.19],
      ],
      material(0xf1dc9a, 0.5, 0.03, 0, 0.85),
    );
    pectoral.position.set(0.02, -0.05, side * 0.43);
    root.add(pectoral);
    motion(root, pectoral, "y", 0.45, 10, side);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 6; col++) {
        const theta = (col / 5) * 2.4 + 0.3,
          phi = 0.45 + row * 0.43;
        const x = Math.cos(theta) * 0.63,
          y = Math.cos(phi) * 0.46;
        const z = side * Math.sin(theta) * Math.sin(phi) * 0.46;
        orb(root, material(0x776e49), [x, y, z], [0.043, 0.05, 0.036], true);
        if (row === 0) {
          const spike = mesh(
            new THREE.ConeGeometry(0.022, 0.12, 5),
            material(0xe7d59c),
          );
          spike.position.set(x, y + 0.05, z);
          spike.rotation.z = -x * 0.8;
          root.add(spike);
        }
      }
  }
  eye(root, 0.49, 0.15, 0.31, 0.13, 0xf7eac8);
  orb(root, material(0xaa875c), [0.674, -0.035, 0], [0.069, 0.075, 0.12], true);
  return root;
}

function createRay(glowing = false) {
  const root = new THREE.Group();
  const body = material(
    glowing ? 0x77c5e0 : 0x697e92,
    0.42,
    0.12,
    glowing ? 0.23 : 0,
  );
  const belly = material(
    glowing ? 0xc1f5ec : 0xc0c3b6,
    0.46,
    0.06,
    glowing ? 0.2 : 0,
  );
  orb(root, belly, [0.03, -0.06, 0], [0.87, 0.15, 0.48]);
  orb(root, body, [0, 0.02, 0], [0.9, 0.21, 0.48]);
  for (const side of [-1, 1]) {
    const wingPivot = new THREE.Group();
    wingPivot.position.set(0, 0, side * 0.24);
    // A swept wing in the X/Z plane, with a rounded, sculpted leading edge.
    const wing = fin(
      [
        [0.8, 0],
        [0.32, 0.72],
        [-0.25, 1.17],
        [-0.57, 1.22],
        [-0.27, 0.53],
        [-0.75, 0.05],
      ],
      body,
      0.055,
    );
    wing.rotation.x = (side * Math.PI) / 2;
    wingPivot.add(wing);
    root.add(wingPivot);
    motion(
      root,
      wingPivot,
      "x",
      0.38,
      glowing ? 1.5 : 2,
      side > 0 ? 0 : Math.PI,
    );
    const cephalic = tube(
      [
        [0.68, 0, side * 0.26],
        [0.99, 0.04, side * 0.33],
        [1.12, 0.12, side * 0.22],
      ],
      0.057,
      body,
      10,
      7,
    );
    root.add(cephalic);
    if (glowing) {
      const rim = tube(
        [
          [0.73, 0, 0],
          [0.3, 0.02, side * 0.7],
          [-0.25, 0.015, side * 1.16],
          [-0.55, 0, side * 1.2],
        ],
        0.017,
        ART.glow,
        18,
        5,
      );
      wingPivot.add(rim);
      for (let i = 0; i < 9; i++) {
        orb(
          wingPivot,
          ART.glow,
          [
            0.38 - (i % 3) * 0.24,
            0.055,
            side * (0.25 + Math.floor(i / 3) * 0.22),
          ],
          [0.026, 0.019, 0.026],
          true,
        );
      }
    }
  }
  const tail = tube(
    [
      [-0.72, 0, 0],
      [-1.24, -0.04, 0],
      [-1.8, 0.02, 0.1],
      [-2.1, 0.16, 0.12],
    ],
    0.041,
    body,
    25,
    6,
  );
  root.add(tail);
  motion(root, tail, "y", 0.11, 2.1);
  eye(root, 0.55, 0.16, 0.3, 0.052, glowing ? 0x9dfbea : 0xd9c78b);
  // A small roll presents both the breadth and underside of the ray from a side camera.
  root.rotation.x = 0.48;
  if (glowing) root.scale.setScalar(1.32);
  return root;
}

function createMoray() {
  const root = new THREE.Group();
  const green = material(0x739584),
    dark = material(0x3a5f62);
  const body = tube(
    [
      [0.63, 0.08, 0],
      [0.12, 0, 0],
      [-0.48, -0.08, 0.04],
      [-1.0, -0.22, 0.08],
      [-1.52, -0.13, 0.05],
      [-1.9, 0.15, 0],
    ],
    0.19,
    green,
    34,
    10,
  );
  root.add(body);
  motion(root, body, "y", 0.13, 3.4);
  const dorsal = fin(
    [
      [0.5, 0.07],
      [-0.12, 0.33],
      [-0.68, 0.18],
      [-1.22, 0.21],
      [-1.82, 0.4],
      [-1.92, 0.15],
      [-1.1, -0.04],
      [-0.2, -0.01],
    ],
    dark,
  );
  root.add(dorsal);
  motion(root, dorsal, "y", 0.15, 3.4, 0.2);
  orb(root, green, [0.64, 0.08, 0], [0.43, 0.25, 0.24]);
  orb(root, dark, [0.93, -0.03, 0], [0.17, 0.14, 0.185]);
  orb(root, green, [0.81, -0.13, 0], [0.28, 0.068, 0.185]);
  eye(root, 0.79, 0.16, 0.2, 0.06, 0xe1d490);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const tooth = mesh(new THREE.ConeGeometry(0.019, 0.074, 5), ART.pearl, [
        0.77 + i * 0.069,
        -0.02,
        side * 0.16,
      ]);
      tooth.rotation.z = Math.PI;
      root.add(tooth);
    }
    for (let i = 0; i < 18; i++) {
      const x = 0.47 - (i % 9) * 0.19,
        y = (i < 9 ? 0.12 : -0.08) - Math.max(0, -x) * 0.08;
      orb(root, dark, [x, y, side * 0.185], [0.045, 0.035, 0.013], true);
    }
  }
  return root;
}

function createJellyfish() {
  const root = new THREE.Group();
  const bell = mesh(
    new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.57),
    material(0xb9abe4, 0.28, 0.05, 0.35, 0.64),
    [0, 0.22, 0],
    [0.58, 0.4, 0.58],
  );
  bell.name = "bell";
  root.add(bell);
  root.userData.bell = bell;
  orb(
    root,
    material(0xd4c5fa, 0.3, 0.08, 0.65, 0.72),
    [0, 0.27, 0],
    [0.29, 0.2, 0.29],
  );
  const rim = mesh(
    new THREE.TorusGeometry(0.545, 0.031, 7, 32),
    material(0xe9c6ff, 0.36, 0.04, 0.9),
    [0, 0.15, 0],
  );
  rim.rotation.x = Math.PI / 2;
  root.add(rim);
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6,
      x = Math.cos(angle) * 0.46,
      z = Math.sin(angle) * 0.46;
    const tentacle = tube(
      [
        [x, 0.14, z],
        [x * 0.84, -0.24, z * 0.85],
        [x + Math.sin(i) * 0.09, -0.62 - (i % 3) * 0.1, z],
        [x * 0.65 + Math.cos(i) * 0.1, -0.98 - (i % 3) * 0.15, z * 0.75],
      ],
      0.013,
      material(0xd2bce9, 0.5, 0, 0.3, 0.7),
      16,
      5,
    );
    root.add(tentacle);
    motion(root, tentacle, "z", 0.07, 1.7, i * 0.4);
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const arm = tube(
      [
        [0, 0.21, 0],
        [Math.cos(angle) * 0.12, -0.17, Math.sin(angle) * 0.12],
        [Math.cos(angle + 0.4) * 0.22, -0.46, Math.sin(angle + 0.4) * 0.22],
        [Math.cos(angle + 0.8) * 0.13, -0.78, Math.sin(angle + 0.8) * 0.13],
      ],
      0.047,
      material(0xba87d1, 0.55, 0, 0.2, 0.85),
      15,
      6,
    );
    root.add(arm);
    motion(root, arm, "y", 0.22, 1.7, i);
  }
  return root;
}

function createSeaangel() {
  const root = new THREE.Group();
  const translucent = material(0xc8eafa, 0.25, 0.06, 0.28, 0.8);
  orb(root, translucent, [0, 0, 0], [0.22, 0.58, 0.18]);
  orb(
    root,
    material(0xfba789, 0.35, 0.05, 0.5),
    [0, 0.18, 0.025],
    [0.11, 0.22, 0.115],
  );
  orb(root, translucent, [0, 0.48, 0], [0.18, 0.17, 0.15]);
  for (const side of [-1, 1]) {
    const wing = fin(
      [
        [0, 0.1],
        [side * 0.38, 0.27],
        [side * 0.65, 0.08],
        [side * 0.73, -0.2],
        [side * 0.33, -0.14],
        [0, -0.08],
      ],
      translucent,
      0.022,
    );
    wing.position.y = 0.1;
    root.add(wing);
    motion(root, wing, "y", 0.48, 3, side > 0 ? 0 : Math.PI);
    root.add(
      tube(
        [
          [side * 0.07, 0.56, 0],
          [side * 0.12, 0.76, 0],
          [side * 0.19, 0.81, 0],
        ],
        0.027,
        translucent,
        8,
        6,
      ),
    );
    orb(root, ART.glow, [side * 0.19, 0.81, 0], [0.031, 0.04, 0.03], true);
  }
  const tip = fin(
    [
      [-0.15, -0.29],
      [0, -0.89],
      [0.16, -0.29],
    ],
    translucent,
  );
  root.add(tip);
  motion(root, tip, "y", 0.2, 2.4);
  root.scale.setScalar(0.85);
  return root;
}

function createAngler() {
  const root = new THREE.Group();
  const dark = material(0x4d5576, 0.72),
    finMat = material(0x6c6389, 0.58);
  orb(root, dark, [-0.09, 0.03, 0], [0.73, 0.58, 0.44]);
  fishTail(root, -0.68, finMat, 0.54);
  fishFins(root, 0x766a8e, 0.27);
  orb(root, material(0x16263f, 0.8), [0.55, -0.12, 0], [0.21, 0.33, 0.335]);
  const jaw = tube(
    [
      [0.48, 0.18, -0.3],
      [0.68, -0.06, -0.25],
      [0.66, -0.39, 0],
      [0.68, -0.06, 0.25],
      [0.48, 0.18, 0.3],
    ],
    0.042,
    finMat,
    22,
    7,
  );
  root.add(jaw);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const tooth = mesh(
        new THREE.ConeGeometry(0.022, 0.17 - (i % 2) * 0.04, 5),
        material(0xd9dcb4),
        [0.65, -0.27 + i * 0.073, side * (0.18 + i * 0.019)],
      );
      tooth.rotation.z = -0.55;
      if (i > 2) tooth.rotation.z = Math.PI + 0.45;
      root.add(tooth);
    }
    orb(root, material(0x374662), [0.29, 0.24, side * 0.348], [0.2, 0.16, 0.1]);
  }
  eye(root, 0.39, 0.24, 0.417, 0.064, 0xabdbb3);
  const lure = new THREE.Group();
  lure.add(
    tube(
      [
        [0.05, 0.52, 0],
        [0.16, 1.02, 0],
        [0.65, 1.14, 0],
        [0.84, 0.78, 0],
      ],
      0.028,
      finMat,
      25,
      6,
    ),
  );
  orb(lure, ART.glow, [0.84, 0.75, 0], [0.12, 0.14, 0.12]);
  orb(
    lure,
    material(0x8bffe0, 0.4, 0, 0.7, 0.15),
    [0.84, 0.75, 0],
    [0.2, 0.21, 0.2],
  );
  root.add(lure);
  motion(root, lure, "z", 0.1, 1.8);
  return root;
}

export function createCreature(speciesId: string): THREE.Group {
  const factories: Record<string, () => THREE.Group> = {
    clownfish: createClownfish,
    seahorse: createSeahorse,
    turtle: createTurtle,
    crab: createCrab,
    triggerfish: createTriggerfish,
    puffer: createPuffer,
    ray: () => createRay(false),
    moray: createMoray,
    jellyfish: createJellyfish,
    seaangel: createSeaangel,
    angler: createAngler,
    glowray: () => createRay(true),
  };
  const root = (factories[speciesId] ?? createClownfish)();
  root.name = speciesId;
  root.userData.speciesId = speciesId;
  return finishModel(root);
}

export function animateCreature(
  group: THREE.Group,
  time: number,
  moving = 1,
): void {
  const intensity = 0.45 + Math.min(1.5, Math.abs(moving)) * 0.55;
  for (const part of (group.userData.motions ?? []) as Motion[]) {
    part.node.rotation[part.axis] =
      part.rest +
      Math.sin(time * part.speed + part.phase) * part.amplitude * intensity;
  }
  const bell = group.userData.bell as THREE.Mesh | undefined;
  if (bell) {
    const pulse = Math.sin(time * 2.5);
    bell.scale.set(
      0.58 * (1 + pulse * 0.07),
      0.4 * (1 - pulse * 0.11),
      0.58 * (1 + pulse * 0.07),
    );
  }
}

export function createDiver(): THREE.Group {
  const root = new THREE.Group();
  const suit = material(0x17465b, 0.55),
    trim = material(0xeac16b, 0.4, 0.2),
    orange = material(0xf0a65d, 0.42);
  orb(root, suit, [0, 0, 0], [0.52, 0.23, 0.225]);
  orb(root, material(0x246074), [0.2, 0.02, 0], [0.29, 0.26, 0.245]);
  // Raised wetsuit seams and chest harness wrap the three-dimensional torso.
  for (const x of [-0.24, 0.14]) {
    const belt = mesh(new THREE.TorusGeometry(0.225, 0.023, 6, 20), trim, [
      x,
      0,
      0,
    ]);
    belt.rotation.y = Math.PI / 2;
    belt.scale.set(1, 1.08, 1);
    root.add(belt);
  }
  orb(root, material(0xf1bf92), [0.63, 0.06, 0], [0.24, 0.22, 0.22]);
  orb(root, suit, [0.59, 0.11, -0.045], [0.22, 0.21, 0.19]);
  // Wide copper-rimmed mask, with tinted glass and a bright specular glint.
  const mask = orb(root, trim, [0.754, 0.09, 0.055], [0.135, 0.16, 0.235]);
  mask.rotation.z = -0.16;
  orb(
    root,
    material(0x6acbd6, 0.08, 0.38, 0.14),
    [0.787, 0.106, 0.065],
    [0.12, 0.127, 0.211],
  );
  orb(
    root,
    material(0xd9fbf0, 0.12, 0.2, 0.4),
    [0.815, 0.152, 0.2],
    [0.034, 0.024, 0.051],
    true,
  );
  orb(root, ART.rubber, [0.829, -0.077, 0.04], [0.09, 0.063, 0.11], true);
  root.add(
    tube(
      [
        [0.83, -0.08, 0.08],
        [0.65, -0.23, 0.22],
        [0.25, -0.2, 0.3],
        [-0.21, 0.26, 0.24],
      ],
      0.027,
      ART.rubber,
      22,
      6,
    ),
  );
  // Two compressed-air cylinders with valves and distinct metal straps.
  for (const side of [-1, 1]) {
    orb(
      root,
      material(0xe6cb88, 0.31, 0.56),
      [-0.07, 0.29, side * 0.12],
      [0.38, 0.125, 0.115],
    );
    rod(
      root,
      [0.24, 0.3, side * 0.12],
      [0.36, 0.3, side * 0.12],
      0.045,
      ART.metal,
    );
    orb(root, orange, [0.34, 0.32, side * 0.12], [0.043, 0.042, 0.048], true);
    for (const x of [-0.26, 0.11])
      block(root, ART.rubber, [x, 0.39, side * 0.12], [0.042, 0.028, 0.21]);
  }
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(-0.4, -0.01, side * 0.115);
    orb(leg, suit, [-0.23, -0.045, 0], [0.32, 0.115, 0.1]);
    orb(leg, material(0x276275), [-0.48, -0.13, 0], [0.17, 0.115, 0.105]);
    orb(leg, suit, [-0.69, -0.145, 0], [0.26, 0.087, 0.085]);
    const flipper = fin(
      [
        [0.07, 0.08],
        [-0.3, 0.15],
        [-0.67, 0.1],
        [-0.75, -0.09],
        [-0.2, -0.14],
        [0.06, -0.06],
      ],
      trim,
      0.045,
    );
    flipper.position.set(-0.89, -0.15, 0);
    flipper.rotation.x = 0.25;
    leg.add(flipper);
    for (let i = 0; i < 2; i++)
      rod(
        leg,
        [-1.02, -0.09 + i * 0.09, 0.04],
        [-1.49, -0.1 + i * 0.1, 0.045],
        0.013,
        orange,
      );
    root.add(leg);
    motion(root, leg, "z", 0.2, 5.4, side > 0 ? 0 : Math.PI);
  }
  const arm = new THREE.Group();
  arm.name = "aimArm";
  arm.position.set(0.25, -0.12, 0.19);
  rod(arm, [0, 0, 0], [0.27, -0.21, 0.04], 0.082, suit);
  orb(arm, orange, [0.25, -0.2, 0.04], [0.09, 0.078, 0.08], true);
  rod(arm, [0.27, -0.21, 0.04], [0.57, -0.12, 0.06], 0.065, suit);
  orb(arm, ART.rubber, [0.61, -0.11, 0.06], [0.11, 0.074, 0.077], true);
  block(arm, ART.metal, [0.72, -0.06, 0.06], [0.32, 0.1, 0.1]);
  orb(arm, ART.glow, [0.895, -0.06, 0.06], [0.025, 0.044, 0.044], true);
  root.add(arm);
  root.userData.aimArm = arm;
  const backArm = new THREE.Group();
  backArm.position.set(0.2, -0.12, -0.2);
  backArm.add(
    tube(
      [
        [0, 0, 0],
        [0.16, -0.3, 0],
        [0.48, -0.22, 0.01],
      ],
      0.068,
      suit,
      12,
      8,
    ),
  );
  orb(backArm, ART.rubber, [0.48, -0.22, 0.01], [0.095, 0.071, 0.075], true);
  root.add(backArm);
  motion(root, backArm, "z", 0.1, 2.5);
  root.scale.setScalar(0.9);
  root.name = "diver";
  return finishModel(root);
}

export function animateDiver(
  group: THREE.Group,
  time: number,
  speed: number,
  aimAngle: number,
): void {
  animateCreature(group, time, speed);
  const arm = group.userData.aimArm as THREE.Group | undefined;
  if (arm)
    arm.rotation.z =
      Math.max(-0.75, Math.min(0.75, aimAngle)) * 0.55 +
      Math.sin(time * 1.4) * 0.018;
}

function seeded(seed: number) {
  let state = seed | 0 || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCoral(kind: number, color?: number): THREE.Group {
  const root = new THREE.Group();
  const random = seeded(kind * 187 + (color ?? 7));
  const colors = [0xe58b82, 0xe9b091, 0xa39cd0, 0x74bdb4, 0xd69baf, 0xe4c496];
  const coralMat = material(
    color ?? colors[Math.abs(kind) % colors.length],
    0.76,
  );
  if (Math.abs(kind) % 3 === 0) {
    // Branching antler coral, with smooth junctions and light-colored polyps.
    for (let i = 0; i < 6; i++) {
      const angle = i * 2.4,
        height = 0.65 + random() * 0.65;
      const x = Math.cos(angle) * (0.25 + random() * 0.35),
        z = Math.sin(angle) * 0.32;
      root.add(
        tube(
          [
            [0, 0, 0],
            [x * 0.35, height * 0.35, z * 0.3],
            [x, height * 0.75, z],
            [x * 1.06, height, z * 1.05],
          ],
          0.055 + random() * 0.025,
          coralMat,
          14,
          7,
        ),
      );
      orb(
        root,
        coralMat,
        [x * 1.06, height, z * 1.05],
        [0.064, 0.077, 0.064],
        true,
      );
      for (const side of [-1, 1]) {
        const tip: V3 = [
          x + side * (0.15 + random() * 0.16),
          height * (0.84 + random() * 0.2),
          z + side * 0.1,
        ];
        root.add(
          tube(
            [
              [x * 0.72, height * 0.57, z * 0.7],
              [tip[0] * 0.96, tip[1] * 0.9, tip[2]],
              tip,
            ],
            0.034,
            coralMat,
            10,
            6,
          ),
        );
        orb(root, material(0xf4d4be), tip, [0.038, 0.047, 0.038], true);
      }
    }
  } else if (Math.abs(kind) % 3 === 1) {
    // Layered foliose coral has a rippled edge and a concave, bowl-shaped surface.
    for (let layer = 0; layer < 3; layer++) {
      const geo = new THREE.CircleGeometry(
        0.7 - layer * 0.14,
        32,
        0,
        Math.PI * 2,
      );
      const positions = geo.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i),
          y = positions.getY(i),
          a = Math.atan2(y, x),
          r = Math.hypot(x, y);
        positions.setXYZ(
          i,
          x * (1 + Math.sin(a * 7) * 0.08),
          0.16 * r + Math.sin(a * 7 + layer) * 0.055 * r,
          y,
        );
      }
      geo.computeVertexNormals();
      const plate = mesh(geo, coralMat, [
        (layer % 2) * 0.12,
        0.18 + layer * 0.25,
        -layer * 0.07,
      ]);
      plate.rotation.z = -0.07 + layer * 0.08;
      root.add(plate);
      rod(
        root,
        [0, 0, 0],
        [0, 0.22 + layer * 0.25, -layer * 0.07],
        0.06,
        coralMat,
      );
    }
  } else {
    // Clustered tube sponge, with individually open dark mouths.
    for (let i = 0; i < 8; i++) {
      const x = (random() - 0.5) * 0.8,
        z = (random() - 0.5) * 0.5,
        h = 0.35 + random() * 0.7,
        r = 0.08 + random() * 0.06;
      const body = mesh(
        new THREE.CylinderGeometry(r, r * 0.7, h, 12, 1, true),
        coralMat,
        [x, h / 2, z],
      );
      body.rotation.z = x * -0.16;
      root.add(body);
      const lip = mesh(
        new THREE.TorusGeometry(r * 0.86, r * 0.18, 6, 12),
        coralMat,
        [x + h * x * 0.08, h, z],
      );
      lip.rotation.x = Math.PI / 2;
      root.add(lip);
      const inside = mesh(
        new THREE.CircleGeometry(r * 0.78, 12),
        material(0x475264),
        [x + h * x * 0.08, h - 0.035, z],
      );
      inside.rotation.x = -Math.PI / 2;
      root.add(inside);
    }
  }
  root.name = "coral";
  return finishModel(root);
}

export function createRock(seed: number): THREE.Group {
  const root = new THREE.Group();
  const random = seeded(seed + 53);
  const colors = [0x567b7a, 0x577171, 0x64827c, 0x6f8d83];
  for (let i = 0; i < 3; i++) {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const positions = geometry.getAttribute("position");
    for (let p = 0; p < positions.count; p++) {
      const x = positions.getX(p),
        y = positions.getY(p),
        z = positions.getZ(p);
      const warp =
        1 + Math.sin(x * 5.13 + seed) * Math.cos(z * 4.12 - y * 3) * 0.12;
      positions.setXYZ(p, x * warp, Math.max(-0.4, y * warp), z * warp);
    }
    geometry.computeVertexNormals();
    const rock = mesh(
      geometry,
      material(colors[((seed + i) >>> 0) % colors.length], 0.94),
      [(random() - 0.5) * 0.9, 0.21 + i * 0.13, (random() - 0.5) * 0.55],
      [0.7 + random() * 0.65, 0.5 + random() * 0.52, 0.55 + random() * 0.55],
    );
    rock.rotation.set(random() * 0.15, random() * 2, random() * 0.15);
    root.add(rock);
  }
  root.name = "rock";
  return finishModel(root);
}

export function createPlant(seed: number): THREE.Group {
  const root = new THREE.Group();
  const random = seeded(seed + 701);
  const mat = material(seed % 2 ? 0x3d927f : 0x609f8b, 0.75);
  for (let i = 0; i < 5; i++) {
    const h = 0.8 + random() * 1.1,
      bend = (random() - 0.5) * 0.45,
      offset = (random() - 0.5) * 0.28;
    const blade = new THREE.BufferGeometry();
    const vertices: number[] = [],
      indices: number[] = [];
    const strips = 13;
    for (let j = 0; j <= strips; j++) {
      const t = j / strips,
        width = Math.sin(Math.PI * Math.pow(t, 0.65)) * 0.075 + 0.007;
      const x = offset + bend * t * t + Math.sin(t * 6 + i) * 0.045;
      for (const side of [-1, 1])
        vertices.push(
          x + side * width,
          t * h,
          Math.sin(t * 4.5 + i) * 0.1 + side * 0.015,
        );
      if (j < strips) {
        const a = j * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    blade.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    blade.setIndex(indices);
    blade.computeVertexNormals();
    const leaf = mesh(blade, mat, [0, 0, (random() - 0.5) * 0.2]);
    root.add(leaf);
    motion(root, leaf, "z", 0.07, 1.1, i * 0.6 + seed);
  }
  root.userData.sway = true;
  root.name = "plant";
  return finishModel(root);
}

function plinth(root: THREE.Group, width = 1, height = 0.18) {
  block(root, ART.metal, [0, height / 2, 0], [width, height, width * 0.6]);
  block(
    root,
    ART.gold,
    [0, height + 0.014, 0],
    [width * 0.9, 0.028, width * 0.54],
  );
}

function createShell(): THREE.Group {
  const root = new THREE.Group();
  const shell = material(0xe9c5ac, 0.56);
  for (let i = 0; i < 9; i++) {
    const angle = -0.8 + i * 0.2,
      rib = orb(
        root,
        shell,
        [Math.sin(angle) * 0.3, 0.38 + Math.cos(angle) * 0.2, 0],
        [0.075, 0.42, 0.12],
      );
    rib.rotation.z = -angle;
  }
  orb(root, material(0xc99482), [0, 0.21, 0.12], [0.42, 0.14, 0.32]);
  return root;
}

export function createDecoration(id: string): THREE.Group {
  const root = new THREE.Group();
  root.name = id;
  switch (id) {
    case "tank": {
      const w = 3.2,
        h = 2.1,
        d = 1.1;
      block(root, ART.metal, [0, 0.15, 0], [w + 0.15, 0.3, d + 0.13]);
      block(root, material(0xb1a68a), [0, 0.36, 0], [w - 0.15, 0.09, d - 0.08]);
      block(root, ART.glass, [0, h / 2 + 0.35, 0], [w, h, d]);
      for (const x of [-w / 2, w / 2])
        for (const z of [-d / 2, d / 2])
          rod(root, [x, 0.3, z], [x, h + 0.36, z], 0.045, ART.metal);
      block(root, ART.metal, [0, h + 0.4, 0], [w + 0.15, 0.12, d + 0.13]);
      block(root, ART.glow, [0, h + 0.31, 0], [w * 0.8, 0.025, 0.08]);
      const coral = createCoral(3);
      coral.scale.setScalar(0.45);
      coral.position.set(-1.05, 0.4, -0.12);
      root.add(coral);
      const plant = createPlant(4);
      plant.scale.setScalar(0.45);
      plant.position.set(1.15, 0.4, 0);
      root.add(plant);
      break;
    }
    case "coralLamp": {
      plinth(root, 0.8);
      const coral = createCoral(0, 0xe9a39c);
      coral.position.y = 0.2;
      coral.scale.setScalar(0.8);
      root.add(coral);
      orb(
        root,
        material(0xffc7aa, 0.4, 0, 0.7),
        [0.02, 1.07, 0],
        [0.12, 0.13, 0.12],
      );
      break;
    }
    case "shellSeat":
      root.add(createShell());
      break;
    case "seaweedPot": {
      const pot = mesh(
        new THREE.CylinderGeometry(0.3, 0.24, 0.36, 16),
        material(0xdec4a1),
        [0, 0.18, 0],
      );
      root.add(pot);
      const plant = createPlant(17);
      plant.position.y = 0.3;
      plant.scale.setScalar(0.66);
      root.add(plant);
      break;
    }
    case "pearlLight": {
      const shell = createShell();
      shell.scale.setScalar(0.8);
      shell.rotation.x = -0.6;
      root.add(shell);
      orb(
        root,
        material(0xf1e9c9, 0.15, 0.2, 0.6),
        [0, 0.38, 0.24],
        [0.23, 0.23, 0.23],
      );
      break;
    }
    case "shipWheel": {
      plinth(root, 0.9);
      rod(root, [0, 0.12, -0.09], [0, 0.98, -0.09], 0.075, ART.bronze);
      const wheel = mesh(
        new THREE.TorusGeometry(0.46, 0.047, 7, 28),
        ART.bronze,
        [0, 0.91, 0],
      );
      root.add(wheel);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        rod(
          root,
          [0, 0.91, 0],
          [Math.cos(a) * 0.62, 0.91 + Math.sin(a) * 0.62, 0],
          0.028,
          ART.bronze,
        );
      }
      orb(root, ART.gold, [0, 0.91, 0.04], [0.11, 0.11, 0.06]);
      break;
    }
    case "anchor": {
      plinth(root, 1);
      rod(root, [0, 0.31, 0], [0, 1.35, 0], 0.058, ART.metal);
      rod(root, [-0.35, 1.04, 0], [0.35, 1.04, 0], 0.049, ART.metal);
      root.add(
        tube(
          [
            [-0.53, 0.67, 0],
            [-0.35, 0.36, 0],
            [0, 0.25, 0],
            [0.35, 0.36, 0],
            [0.53, 0.67, 0],
          ],
          0.058,
          ART.metal,
          18,
          7,
        ),
      );
      root.add(
        mesh(
          new THREE.TorusGeometry(0.11, 0.032, 6, 16),
          ART.bronze,
          [0, 1.39, 0],
        ),
      );
      for (const s of [-1, 1]) {
        const tip = fin(
          [
            [0, 0],
            [s * 0.2, 0.1],
            [s * 0.09, -0.2],
          ],
          ART.metal,
        );
        tip.position.set(s * 0.46, 0.63, 0);
        root.add(tip);
      }
      break;
    }
    case "modelSub": {
      plinth(root, 1.3);
      rod(root, [0, 0.18, 0], [0, 0.42, 0], 0.05, ART.gold);
      orb(root, material(0xe7b966, 0.34, 0.3), [0, 0.65, 0], [0.7, 0.27, 0.28]);
      orb(
        root,
        material(0x6baab5, 0.17, 0.3),
        [0.47, 0.69, 0.05],
        [0.2, 0.2, 0.255],
      );
      rod(root, [-0.15, 0.79, 0], [-0.15, 1.06, 0], 0.045, ART.metal);
      rod(root, [-0.15, 1.06, 0], [0.02, 1.06, 0], 0.045, ART.metal);
      const tail = fin(
        [
          [0.05, 0],
          [-0.16, 0.3],
          [-0.25, -0.26],
        ],
        ART.metal,
      );
      tail.position.set(-0.59, 0.65, 0);
      root.add(tail);
      break;
    }
    case "reefSculpture": {
      plinth(root, 1.05);
      const rock = createRock(41);
      rock.scale.setScalar(0.45);
      rock.position.y = 0.25;
      root.add(rock);
      const coral = createCoral(0, 0x81baac);
      coral.scale.setScalar(0.63);
      coral.position.set(0.1, 0.46, 0);
      root.add(coral);
      break;
    }
    case "starMobile": {
      plinth(root, 0.7);
      root.add(
        tube(
          [
            [0, 0.18, 0],
            [0, 1.4, 0],
            [0.28, 1.67, 0],
            [0.65, 1.52, 0],
          ],
          0.027,
          ART.bronze,
          18,
          6,
        ),
      );
      for (let i = 0; i < 3; i++) {
        const x = 0.11 + i * 0.23,
          y = 1.03 - (i % 2) * 0.17;
        rod(root, [x, 1.5, 0], [x, y, 0], 0.006, ART.pearl);
        const pts: [number, number][] = Array.from({ length: 10 }, (_, p) => {
          const a = (p * Math.PI) / 5 + Math.PI / 2,
            r = p % 2 ? 0.065 : 0.15;
          return [Math.cos(a) * r, Math.sin(a) * r];
        });
        const star = fin(pts, ART.gold);
        star.position.set(x, y, 0);
        root.add(star);
        motion(root, star, "y", 0.6, 1.2, i);
      }
      break;
    }
    case "abyssCrystal": {
      plinth(root, 0.95);
      for (let i = 0; i < 5; i++) {
        const c = mesh(
          new THREE.CylinderGeometry(0, 0.13, 0.75 + (i % 3) * 0.2, 5),
          material(i % 2 ? 0x8ca8dc : 0x91e2d5, 0.22, 0.27, 0.4),
          [(i - 2) * 0.12, 0.52 + (i % 3) * 0.07, (i % 2) * 0.16],
        );
        c.rotation.z = (i - 2) * -0.16;
        root.add(c);
      }
      break;
    }
    case "discoveryTrophy": {
      plinth(root, 1.2, 0.25);
      rod(root, [0, 0.25, 0], [0, 0.84, 0], 0.04, ART.gold);
      const ray = createRay(true);
      ray.scale.setScalar(0.43);
      ray.position.set(0.12, 0.99, 0);
      ray.rotation.x = 0.75;
      root.add(ray);
      block(root, ART.gold, [0, 0.13, 0.367], [0.49, 0.1, 0.015]);
      break;
    }
    default:
      plinth(root);
      orb(root, ART.pearl, [0, 0.53, 0], [0.3, 0.3, 0.3]);
  }
  return finishModel(root);
}
