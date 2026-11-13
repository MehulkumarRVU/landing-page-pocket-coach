// TrinariX / PocketCoach landing page — 3D + interaction layer.
// Build: node build.mjs  (bundles this file + three.js into index.html)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const COLORS = {
  court: 0x110a1c,
  line: 0xf4ecdd,
  signal: 0xd8b26a,
  teal: 0x9c7fe0,
  muted: 0x7a6696,
  body: 0xf1e8da,
};
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(pointer: fine)').matches;

/* ------------------------------------------------------------------ */
/*  Pose maths                                                         */
/* ------------------------------------------------------------------ */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

function lerpPose(a, b, t) {
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const va = a[k], vb = b[k];
    if (typeof va === 'number' || typeof vb === 'number') {
      out[k] = lerp(va ?? DEFAULT_SCALARS[k] ?? 0, vb ?? DEFAULT_SCALARS[k] ?? 0, t);
    } else {
      const A = va || [0, 0, 0], B = vb || [0, 0, 0];
      out[k] = [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
    }
  }
  return out;
}
const DEFAULT_SCALARS = { rootY: 0.95, rootZ: 0, rootX: 0 };

// frames: [{ p: pose, t: seconds to travel to next frame }]
function samplePose(frames, time) {
  const total = frames.reduce((s, f) => s + f.t, 0);
  let local = ((time % total) + total) % total;
  for (let i = 0; i < frames.length; i++) {
    if (local <= frames[i].t) {
      const next = frames[(i + 1) % frames.length];
      return lerpPose(frames[i].p, next.p, ease(local / frames[i].t));
    }
    local -= frames[i].t;
  }
  return frames[0].p;
}
const mirror = (o) => o; // poses are authored per side explicitly

/* ---------- movement library (angles in radians) ---------- */
const STAND = {
  rootY: 0.95,
  shoulderL: [-0.05, 0, 0.12], shoulderR: [-0.05, 0, -0.12],
  elbowL: [-0.15, 0, 0], elbowR: [-0.15, 0, 0],
};
const GUARD = {
  rootY: 0.92, pelvis: [0, 0.35, 0], chest: [0.05, -0.25, 0], neck: [0, -0.15, 0],
  shoulderL: [-0.55, 0, 0.18], elbowL: [-2.15, 0, 0],
  shoulderR: [-0.45, 0, -0.18], elbowR: [-2.25, 0, 0],
  hipL: [-0.25, 0, 0.1], kneeL: [0.35, 0, 0], ankleL: [-0.1, 0, 0],
  hipR: [0.2, 0, -0.1], kneeR: [0.3, 0, 0], ankleR: [-0.15, 0, 0],
};
const JAB = {
  ...GUARD, chest: [0.05, -0.45, 0],
  shoulderL: [-1.52, 0, 0.04], elbowL: [-0.06, 0, 0],
};
const CROSS = {
  ...GUARD, pelvis: [0, 0.05, 0], chest: [0.08, 0.3, 0], neck: [0, -0.2, 0],
  shoulderR: [-1.55, 0, -0.02], elbowR: [-0.05, 0, 0],
  hipR: [0.05, 0.2, -0.1], kneeR: [0.2, 0, 0],
};
const MOVES = {
  jab: [
    { p: GUARD, t: 0.55 }, { p: JAB, t: 0.22 }, { p: GUARD, t: 0.45 },
    { p: CROSS, t: 0.24 }, { p: GUARD, t: 0.7 },
  ],
  squat: [
    { p: { ...STAND, shoulderL: [-0.25, 0, 0.1], shoulderR: [-0.25, 0, -0.1] }, t: 1.1 },
    {
      p: {
        rootY: 0.53, rootZ: -0.24, spine: [0.55, 0, 0], chest: [0.1, 0, 0], neck: [-0.4, 0, 0],
        shoulderL: [-1.35, 0, 0.08], shoulderR: [-1.35, 0, -0.08], elbowL: [-0.05, 0, 0], elbowR: [-0.05, 0, 0],
        hipL: [-1.5, 0, 0.18], kneeL: [1.9, 0, 0], ankleL: [-0.4, 0, 0],
        hipR: [-1.5, 0, -0.18], kneeR: [1.9, 0, 0], ankleR: [-0.4, 0, 0],
      }, t: 0.9,
    },
  ],
  stretch: [
    { p: { ...STAND, shoulderL: [0, 0, 2.75], elbowL: [0, 0, 0.1], spine: [0, 0, 0.32], chest: [0, 0, 0.12], hipL: [0, 0, 0.08], hipR: [0, 0, -0.08], shoulderR: [0.1, 0, -0.35] }, t: 1.5 },
    { p: STAND, t: 0.6 },
    { p: { ...STAND, shoulderR: [0, 0, -2.75], elbowR: [0, 0, -0.1], spine: [0, 0, -0.32], chest: [0, 0, -0.12], hipL: [0, 0, 0.08], hipR: [0, 0, -0.08], shoulderL: [0.1, 0, 0.35] }, t: 1.5 },
    { p: STAND, t: 0.6 },
  ],
};

// Adaptive: one shoulder press, three body configurations.
const LEGS = {
  standing: { rootY: 0.95, hipL: [0, 0, 0.06], hipR: [0, 0, -0.06] },
  seated: {
    rootY: 0.52, hipL: [-1.57, 0, 0.12], kneeL: [1.57, 0, 0], hipR: [-1.57, 0, -0.12], kneeR: [1.57, 0, 0],
  },
  wheelchair: {
    rootY: 0.58, spine: [-0.08, 0, 0], hipL: [-1.45, 0, 0.1], kneeL: [1.3, 0, 0], ankleL: [0.15, 0, 0],
    hipR: [-1.45, 0, -0.1], kneeR: [1.3, 0, 0], ankleR: [0.15, 0, 0],
  },
};
const PRESS_DOWN = { shoulderL: [0, 0, 1.45], elbowL: [0, 0, 1.55], shoulderR: [0, 0, -1.45], elbowR: [0, 0, -1.55] };
const PRESS_UP = { shoulderL: [0, 0, 2.85], elbowL: [0, 0, 0.12], shoulderR: [0, 0, -2.85], elbowR: [0, 0, -0.12] };
const adaptiveMove = (mode) => [
  { p: { ...LEGS[mode], ...PRESS_DOWN }, t: 1.0 },
  { p: { ...LEGS[mode], ...PRESS_UP }, t: 0.9 },
];

/* ------------------------------------------------------------------ */
/*  Rig: an FK skeleton drawn as MediaPipe-style landmarks             */
/* ------------------------------------------------------------------ */
const SKELETON = [
  // name, parent, offset
  ['pelvis', null, [0, 0.95, 0]],
  ['spine', 'pelvis', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.22, 0]],
  ['neck', 'chest', [0, 0.2, 0]],
  ['head', 'neck', [0, 0.13, 0]],
  ['shoulderL', 'chest', [0.18, 0.16, 0]], ['elbowL', 'shoulderL', [0, -0.28, 0]],
  ['wristL', 'elbowL', [0, -0.25, 0]], ['handL', 'wristL', [0, -0.08, 0]],
  ['shoulderR', 'chest', [-0.18, 0.16, 0]], ['elbowR', 'shoulderR', [0, -0.28, 0]],
  ['wristR', 'elbowR', [0, -0.25, 0]], ['handR', 'wristR', [0, -0.08, 0]],
  ['hipL', 'pelvis', [0.1, -0.02, 0]], ['kneeL', 'hipL', [0, -0.42, 0]],
  ['ankleL', 'kneeL', [0, -0.42, 0]], ['toeL', 'ankleL', [0, -0.07, 0.13]],
  ['hipR', 'pelvis', [-0.1, -0.02, 0]], ['kneeR', 'hipR', [0, -0.42, 0]],
  ['ankleR', 'kneeR', [0, -0.42, 0]], ['toeR', 'ankleR', [0, -0.07, 0.13]],
];
const FACE = [['nose', [0, -0.01, 0.1]], ['eyeL', [0.035, 0.025, 0.088]], ['eyeR', [-0.035, 0.025, 0.088]], ['earL', [0.08, 0, 0]], ['earR', [-0.08, 0, 0]]];
const LANDMARKS = ['head', 'shoulderL', 'elbowL', 'wristL', 'handL', 'shoulderR', 'elbowR', 'wristR', 'handR', 'hipL', 'kneeL', 'ankleL', 'toeL', 'hipR', 'kneeR', 'ankleR', 'toeR'];
const BONES = [
  ['shoulderL', 'shoulderR'], ['hipL', 'hipR'], ['shoulderL', 'hipL'], ['shoulderR', 'hipR'],
  ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['wristL', 'handL'],
  ['shoulderR', 'elbowR'], ['elbowR', 'wristR'], ['wristR', 'handR'],
  ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['ankleL', 'toeL'],
  ['hipR', 'kneeR'], ['kneeR', 'ankleR'], ['ankleR', 'toeR'],
  ['neck', 'nose'],
];
const BODY_SEGMENTS = [
  ['shoulderL', 'elbowL', 0.05], ['elbowL', 'wristL', 0.042], ['shoulderR', 'elbowR', 0.05], ['elbowR', 'wristR', 0.042],
  ['hipL', 'kneeL', 0.075], ['kneeL', 'ankleL', 0.055], ['hipR', 'kneeR', 0.075], ['kneeR', 'ankleR', 0.055],
  ['ankleL', 'toeL', 0.04], ['ankleR', 'toeR', 0.04], ['pelvis', 'neck', 0.14],
];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

class Rig {
  constructor({ jointSize = 0.028, withBody = false, boneColor = COLORS.line, jointColor = COLORS.signal } = {}) {
    this.group = new THREE.Group();
    this.skel = new THREE.Group();
    this.skel.visible = false; // kinematic tree only; we draw separately
    this.group.add(this.skel);
    this.nodes = {};
    for (const [name, parent, off] of SKELETON) {
      const n = new THREE.Object3D();
      n.position.set(...off);
      n.userData.base = new THREE.Vector3(...off);
      (parent ? this.nodes[parent] : this.skel).add(n);
      this.nodes[name] = n;
    }
    for (const [name, off] of FACE) {
      const n = new THREE.Object3D();
      n.position.set(...off);
      this.nodes.head.add(n);
      this.nodes[name] = n;
    }

    this.vis = new THREE.Group();
    this.group.add(this.vis);
    this.world = {}; // rig-local positions

    // Landmarks
    this.jointMat = new THREE.MeshStandardMaterial({ color: 0xe8c47c, metalness: 1, roughness: 0.22, emissive: 0x3a2508, emissiveIntensity: 0.6, transparent: true });
    this.haloMat = new THREE.MeshBasicMaterial({ color: jointColor, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending });
    const jg = new THREE.SphereGeometry(jointSize, 16, 12);
    const hg = new THREE.SphereGeometry(jointSize * 2.3, 16, 12);
    this.joints = [...LANDMARKS, 'nose', 'eyeL', 'eyeR', 'earL', 'earR'].map((name) => {
      const small = ['nose', 'eyeL', 'eyeR', 'earL', 'earR'].includes(name);
      const m = new THREE.Mesh(jg, this.jointMat);
      if (small) m.scale.setScalar(0.55);
      if (name === 'head') m.scale.setScalar(0.001);
      const h = new THREE.Mesh(hg, this.haloMat);
      if (small || name === 'head') h.visible = false;
      m.add(h);
      this.vis.add(m);
      return { name, mesh: m, halo: h, intro: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6) };
    });

    // Bones
    this.boneMat = new THREE.MeshBasicMaterial({ color: boneColor, transparent: true, opacity: 0.85 });
    const bg = new THREE.CylinderGeometry(0.009, 0.009, 1, 6);
    this.bones = BONES.map(([a, b]) => {
      const m = new THREE.Mesh(bg, this.boneMat);
      this.vis.add(m);
      return { a, b, mesh: m };
    });

    // Optional solid body (used for the "capture" stage)
    this.bodyParts = [];
    if (withBody) {
      this.bodyMat = new THREE.MeshPhysicalMaterial({ color: COLORS.body, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15, transparent: true, opacity: 1 });
      for (const [a, b, r] of BODY_SEGMENTS) {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, 1, 6, 14), this.bodyMat);
        m.userData.r = r;
        this.vis.add(m);
        this.bodyParts.push({ a, b, mesh: m });
      }
      this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), this.bodyMat);
      this.vis.add(this.headMesh);
    }

    this.intro = 1; // 1 = scattered, 0 = assembled
    this.pose = {};
  }

  applyPose(pose) {
    this.pose = pose;
    for (const [name] of SKELETON) {
      const n = this.nodes[name];
      const r = pose[name];
      if (r) n.rotation.set(r[0], r[1], r[2]); else n.rotation.set(0, 0, 0);
    }
    this.nodes.pelvis.position.set(pose.rootX ?? 0, pose.rootY ?? 0.95, pose.rootZ ?? 0);
    this.skel.updateMatrixWorld(true);
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    for (const name in this.nodes) {
      const v = (this.world[name] ||= new THREE.Vector3());
      this.nodes[name].getWorldPosition(v).applyMatrix4(inv);
    }
    this.draw();
  }

  draw() {
    const k = ease(Math.min(1, Math.max(0, this.intro)));
    for (const j of this.joints) {
      j.mesh.position.copy(this.world[j.name]).lerp(j.intro, k);
    }
    const showBones = 1 - Math.min(1, this.intro * 1.6);
    for (const bn of this.bones) {
      this.place(bn.mesh, this.world[bn.a], this.world[bn.b], 1);
      bn.mesh.visible = showBones > 0.02;
    }
    this.boneMat.opacity = 0.85 * showBones * (this.boneAlpha ?? 1);
    for (const bp of this.bodyParts) this.place(bp.mesh, this.world[bp.a], this.world[bp.b], 1, true);
    if (this.headMesh) this.headMesh.position.copy(this.world.head);
  }

  place(mesh, a, b, _s, capsule = false) {
    _a.subVectors(b, a);
    const len = _a.length();
    mesh.position.copy(a).addScaledVector(_a, 0.5);
    mesh.quaternion.setFromUnitVectors(_up, _a.normalize());
    if (capsule) {
      // CapsuleGeometry length=1 plus 2r caps; scale only cylinder part
      const r = mesh.userData.r;
      mesh.scale.set(1, Math.max(0.01, (len) / (1 + 2 * r)), 1);
    } else mesh.scale.set(1, len, 1);
  }

  angle(a, b, c) {
    _a.subVectors(this.world[a], this.world[b]).normalize();
    _b.subVectors(this.world[c], this.world[b]).normalize();
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_a.dot(_b), -1, 1)));
  }
}

/* Animated driver: plays a movement, blends on switch */
class Driver {
  constructor(rig, frames) {
    this.rig = rig; this.frames = frames; this.t = 0; this.blend = 1; this.from = null;
  }
  set(frames) {
    this.from = { ...this.rig.pose }; this.frames = frames; this.t = 0; this.blend = 0;
  }
  update(dt, speed = 1) {
    this.t += dt * speed;
    let p = samplePose(this.frames, this.t);
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.6);
      p = lerpPose(this.from, p, ease(this.blend));
    }
    this.rig.applyPose(p);
  }
}

/* Angle arc helper */
class AngleArc {
  constructor(color, radius = 0.12) {
    this.r = radius;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(33 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
    this.line = new THREE.Line(this.geo, this.mat);
    const fanGeo = new THREE.BufferGeometry();
    this.fanPos = new Float32Array(32 * 9);
    fanGeo.setAttribute('position', new THREE.BufferAttribute(this.fanPos, 3));
    this.fanMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    this.fan = new THREE.Mesh(fanGeo, this.fanMat);
    this.group = new THREE.Group();
    this.group.add(this.line, this.fan);
  }
  update(a, b, c) {
    const u = new THREE.Vector3().subVectors(a, b).normalize();
    const v = new THREE.Vector3().subVectors(c, b).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(u, v);
    const id = new THREE.Quaternion();
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const qi = id.clone().slerp(q, i / 32);
      const p = u.clone().applyQuaternion(qi).multiplyScalar(this.r).add(b);
      pts.push(p);
      this.pos.set([p.x, p.y, p.z], i * 3);
    }
    for (let i = 0; i < 32; i++) {
      this.fanPos.set([b.x, b.y, b.z, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z], i * 9);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.fan.geometry.attributes.position.needsUpdate = true;
    this.fan.geometry.computeBoundingSphere();
    this.geo.computeBoundingSphere();
  }
  set opacity(o) { this.mat.opacity = o; this.fanMat.opacity = 0.18 * o; this.group.visible = o > 0.01; }
}

/* ------------------------------------------------------------------ */
/*  Stage helper + shared loop                                         */
/* ------------------------------------------------------------------ */
const stages = [];
function makeStage(canvas, { fov = 32, cam = [0, 1.3, 4.6], target = [0, 0.9, 0] } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 100);
  camera.position.set(...cam);
  camera.lookAt(...target);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xfff3dc, 0x2a1a40, 0.9));
  const dl = new THREE.DirectionalLight(0xfff0d0, 1.6);
  dl.position.set(2, 4, 3);
  scene.add(dl);
  const st = { canvas, renderer, scene, camera, visible: false, update: null, target: new THREE.Vector3(...target) };
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  st.resize = resize;
  resize();
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; }, { rootMargin: '100px' }).observe(canvas);
  stages.push(st);
  return st;
}

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const s of stages) {
    if (!s.visible) continue;
    s.update?.(dt);
    s.renderer.render(s.scene, s.camera);
  }
  requestAnimationFrame(loop);
}

function projectTo(stage, v3, el) {
  const p = v3.clone().project(stage.camera);
  const x = (p.x * 0.5 + 0.5) * stage.canvas.clientWidth;
  const y = (-p.y * 0.5 + 0.5) * stage.canvas.clientHeight;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}

function floorDisc(radius = 1.4) {
  const g = new THREE.Group();
  const polar = new THREE.PolarGridHelper(radius, 12, 5, 64, COLORS.muted, COLORS.muted);
  polar.material.transparent = true;
  polar.material.opacity = 0.22;
  g.add(polar);
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.012, radius, 96), new THREE.MeshBasicMaterial({ color: COLORS.signal, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  return g;
}

/* ------------------------------------------------------------------ */
/*  HERO                                                               */
/* ------------------------------------------------------------------ */
function initHero() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const st = makeStage(canvas, { fov: 30, cam: [1.0, 1.35, 4.0], target: [0, 0.88, 0] });
  const rig = new Rig({ jointSize: 0.03 });
  st.scene.add(rig.group);
  st.scene.add(floorDisc(1.25));

  // scanning plane
  const scan = new THREE.Mesh(
    new THREE.RingGeometry(0.0, 0.55, 64),
    new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
  );
  scan.rotation.x = -Math.PI / 2;
  const scanEdge = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.004, 6, 96),
    new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0.8 })
  );
  scanEdge.rotation.x = Math.PI / 2;
  const scanG = new THREE.Group();
  scanG.add(scan, scanEdge);
  st.scene.add(scanG);

  // dust
  const N = 700;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 1.6 + Math.random() * 3.5, a = Math.random() * Math.PI * 2;
    pos.set([Math.cos(a) * r, Math.random() * 3.2 - 0.3, Math.sin(a) * r], i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(pg, new THREE.PointsMaterial({ color: COLORS.line, size: 0.012, transparent: true, opacity: 0.55, sizeAttenuation: true }));
  st.scene.add(dust);

  const arcElbow = new AngleArc(COLORS.teal, 0.11);
  const arcKnee = new AngleArc(COLORS.signal, 0.13);
  st.scene.add(arcElbow.group, arcKnee.group);

  let controls = null;
  if (FINE_POINTER) {
    controls = new OrbitControls(st.camera, canvas);
    controls.target.copy(st.target);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.minPolarAngle = 0.9;
    controls.maxPolarAngle = 1.65;
    controls.autoRotate = !REDUCED;
    controls.autoRotateSpeed = 0.6;
  }

  const drv = new Driver(rig, MOVES.jab);
  let current = 'jab';
  rig.intro = REDUCED ? 0 : 1;
  const introStart = performance.now() + 250;

  // HUD
  const hud = {
    move: document.querySelector('[data-hud="move"]'),
    a1l: document.querySelector('[data-hud="a1-label"]'), a1: document.querySelector('[data-hud="a1"]'),
    a2l: document.querySelector('[data-hud="a2-label"]'), a2: document.querySelector('[data-hud="a2"]'),
    tag1: document.querySelector('[data-tag="1"]'), tag2: document.querySelector('[data-tag="2"]'),
  };
  const CFG = {
    jab: { name: 'Jab-cross', a: ['shoulderL', 'elbowL', 'wristL', 'Lead elbow'], b: ['hipL', 'kneeL', 'ankleL', 'Front knee'] },
    squat: { name: 'Bodyweight squat', a: ['shoulderR', 'hipR', 'kneeR', 'Hip angle'], b: ['hipR', 'kneeR', 'ankleR', 'Knee angle'] },
    stretch: { name: 'Standing side stretch', a: ['elbowL', 'shoulderL', 'hipL', 'Left shoulder'], b: ['elbowR', 'shoulderR', 'hipR', 'Right shoulder'] },
  };

  document.querySelectorAll('[data-move]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.move;
      if (m === current) return;
      current = m;
      drv.set(MOVES[m]);
      document.querySelectorAll('[data-move]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      hud.move.textContent = CFG[m].name;
      hud.a1l.textContent = CFG[m].a[3];
      hud.a2l.textContent = CFG[m].b[3];
    });
  });

  let t = 0, hudTick = 0;
  st.update = (dt) => {
    t += dt;
    const now = performance.now();
    if (rig.intro > 0 && now > introStart) rig.intro = Math.max(0, 1 - (now - introStart) / 1700);
    drv.update(REDUCED ? 0 : dt);
    const c = CFG[current];
    arcElbow.update(rig.world[c.a[0]], rig.world[c.a[1]], rig.world[c.a[2]]);
    arcKnee.update(rig.world[c.b[0]], rig.world[c.b[1]], rig.world[c.b[2]]);
    const show = 1 - Math.min(1, rig.intro * 2);
    arcElbow.opacity = show; arcKnee.opacity = show;

    scanG.position.y = 0.05 + (Math.sin(t * 0.9) * 0.5 + 0.5) * 1.75;
    dust.rotation.y += dt * 0.02;
    for (const j of rig.joints) j.halo.scale.setScalar(1 + Math.sin(t * 3 + j.mesh.position.y * 4) * 0.15);
    if (controls) controls.update();

    hudTick += dt;
    if (hudTick > 0.08) {
      hudTick = 0;
      hud.a1.textContent = Math.round(rig.angle(c.a[0], c.a[1], c.a[2])) + '°';
      hud.a2.textContent = Math.round(rig.angle(c.b[0], c.b[1], c.b[2])) + '°';
    }
    projectTo(st, rig.world[c.a[1]], hud.tag1);
    projectTo(st, rig.world[c.b[1]], hud.tag2);
    hud.tag1.style.opacity = hud.tag2.style.opacity = show;
  };
}

/* ------------------------------------------------------------------ */
/*  HOW IT WORKS (scroll-pinned, 4 stages)                             */
/* ------------------------------------------------------------------ */
function initProcess() {
  const section = document.getElementById('how');
  const canvas = document.getElementById('process-canvas');
  if (!section || !canvas) return;
  const st = makeStage(canvas, { fov: 30, cam: [0.9, 1.25, 4.7], target: [0, 0.88, 0] });
  const rig = new Rig({ withBody: true, jointSize: 0.026 });
  st.scene.add(rig.group);
  rig.intro = 0;
  st.scene.add(floorDisc(1.1));

  const arcA = new AngleArc(COLORS.teal, 0.12);
  const arcB = new AngleArc(COLORS.signal, 0.14);
  st.scene.add(arcA.group, arcB.group);

  // progress bars ("Improve")
  const bars = new THREE.Group();
  const heights = [0.35, 0.5, 0.48, 0.68, 0.82, 1.0];
  const barMeshes = heights.map((h, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1, 0.11), new THREE.MeshStandardMaterial({ color: i === heights.length - 1 ? 0xe8c47c : 0x7d5cc4, metalness: i === heights.length - 1 ? 1 : 0.35, transparent: true, roughness: 0.25 }));
    m.position.set(-0.55 + i * 0.22, 0, -0.9);
    m.userData.h = h;
    bars.add(m);
    return m;
  });
  st.scene.add(bars);

  const drv = new Driver(rig, MOVES.squat);
  const steps = [...section.querySelectorAll('.step')];
  const frame = section.querySelector('.viewfinder');
  const tags = [...section.querySelectorAll('.p-tag')];
  let stage = 0;
  const cur = { body: 1, joints: 0, bones: 0, arcs: 0, bars: 0 };
  const TARGET = [
    { body: 1, joints: 0, bones: 0, arcs: 0, bars: 0 },
    { body: 0.12, joints: 1, bones: 1, arcs: 0, bars: 0 },
    { body: 0.08, joints: 1, bones: 1, arcs: 1, bars: 0 },
    { body: 0.08, joints: 1, bones: 0.6, arcs: 0.5, bars: 1 },
  ];

  const onScroll = () => {
    const r = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
    const s = Math.min(3, Math.floor(p * 4 * 0.999));
    section.style.setProperty('--p', p.toFixed(3));
    if (s !== stage) {
      stage = s;
      steps.forEach((el, i) => el.classList.toggle('active', i === s));
      section.dataset.stage = s;
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  steps.forEach((el, i) => el.classList.toggle('active', i === stage));

  let t = 0;
  st.update = (dt) => {
    t += dt;
    drv.update(REDUCED ? 0 : dt, 0.85);
    const tgt = TARGET[stage];
    for (const k in cur) cur[k] = lerp(cur[k], tgt[k], Math.min(1, dt * 5));
    rig.bodyMat.opacity = cur.body;
    rig.bodyMat.visible = cur.body > 0.02;
    rig.jointMat.opacity = cur.joints;
    rig.haloMat.opacity = 0.18 * cur.joints;
    rig.boneAlpha = cur.bones;
    arcA.update(rig.world.shoulderR, rig.world.hipR, rig.world.kneeR);
    arcB.update(rig.world.hipR, rig.world.kneeR, rig.world.ankleR);
    arcA.opacity = cur.arcs; arcB.opacity = cur.arcs;
    barMeshes.forEach((m, i) => {
      const k = Math.min(1, Math.max(0, cur.bars * 1.6 - i * 0.1));
      const h = Math.max(0.001, m.userData.h * k);
      m.scale.y = h;
      m.position.y = h / 2;
      m.material.opacity = Math.min(1, k * 1.5);
      m.visible = k > 0.01;
    });
    st.camera.position.x = 0.9 + Math.sin(t * 0.25) * 0.25;
    st.camera.lookAt(st.target);
    projectTo(st, rig.world.hipR, tags[0]);
    projectTo(st, rig.world.kneeR, tags[1]);
    tags[0].querySelector('b').textContent = Math.round(rig.angle('shoulderR', 'hipR', 'kneeR')) + '°';
    tags[1].querySelector('b').textContent = Math.round(rig.angle('hipR', 'kneeR', 'ankleR')) + '°';
    tags.forEach((el) => (el.style.opacity = cur.arcs));
    if (frame) frame.style.opacity = Math.max(0, cur.body - 0.1);
  };
}

/* ------------------------------------------------------------------ */
/*  ADAPTIVE (standing / seated / wheelchair)                          */
/* ------------------------------------------------------------------ */
function initAdaptive() {
  const canvas = document.getElementById('adaptive-canvas');
  if (!canvas) return;
  const st = makeStage(canvas, { fov: 30, cam: [1.9, 1.2, 4.4], target: [0, 0.68, 0] });
  const rig = new Rig({ jointSize: 0.028 });
  rig.intro = 0;
  st.scene.add(rig.group);
  st.scene.add(floorDisc(1.15));

  const propMat = new THREE.MeshStandardMaterial({ color: 0x3b2557, roughness: 0.35, metalness: 0.4, transparent: true });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd9d2e3, roughness: 0.2, metalness: 1, transparent: true });

  // Chair
  const chair = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.04, 0.42), propMat);
  seat.position.set(0, 0.44, 0.04);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.035), propMat);
  back.position.set(0, 0.72, -0.17);
  chair.add(seat, back);
  for (const [x, z] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.22], [0.2, 0.22]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 8), lineMat);
    leg.position.set(x, 0.22, z);
    chair.add(leg);
  }
  // Wheelchair
  const wc = new THREE.Group();
  const wSeat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.04, 0.42), propMat);
  wSeat.position.set(0, 0.5, 0.04);
  const wBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.03), propMat);
  wBack.position.set(0, 0.75, -0.18);
  wBack.rotation.x = -0.1;
  wc.add(wSeat, wBack);
  for (const x of [-0.29, 0.29]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 10, 48), lineMat);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(x, 0.31, -0.06);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.008, 8, 48), new THREE.MeshStandardMaterial({ color: 0xe8c47c, metalness: 1, roughness: 0.2, transparent: true }));
    rim.rotation.y = Math.PI / 2;
    rim.position.set(x + Math.sign(x) * 0.03, 0.31, -0.06);
    const caster = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 20), lineMat);
    caster.rotation.y = Math.PI / 2;
    caster.position.set(x * 0.75, 0.06, 0.32);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.45, 6), lineMat);
    strut.position.set(x * 0.75, 0.29, 0.3);
    wc.add(wheel, rim, caster, strut);
  }
  const footrest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.12), lineMat);
  footrest.position.set(0, 0.08, 0.5);
  wc.add(footrest);
  st.scene.add(chair, wc);
  const props = { standing: [], seated: [chair], wheelchair: [wc] };
  const fade = { chair: 0, wc: 0 };

  let mode = 'standing';
  const drv = new Driver(rig, adaptiveMove(mode));
  const note = document.querySelector('[data-adaptive-note]');
  const NOTES = {
    standing: 'Standing configuration — full-body landmarks, camera at chest height.',
    seated: 'Seated configuration — upper-body focus; leg landmarks are not scored.',
    wheelchair: 'Wheelchair configuration — upper-body focus with camera framed for the chair.',
  };
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode;
      drv.set(adaptiveMove(mode));
      document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      if (note) note.textContent = NOTES[mode];
    });
  });

  let t = 0;
  st.update = (dt) => {
    t += dt;
    drv.update(REDUCED ? 0 : dt);
    fade.chair = lerp(fade.chair, mode === 'seated' ? 1 : 0, Math.min(1, dt * 4));
    fade.wc = lerp(fade.wc, mode === 'wheelchair' ? 1 : 0, Math.min(1, dt * 4));
    chair.visible = fade.chair > 0.02; wc.visible = fade.wc > 0.02;
    chair.position.y = (1 - fade.chair) * -0.3;
    wc.position.y = (1 - fade.wc) * -0.3;
    chair.traverse((o) => o.material && (o.material.opacity = Math.max(fade.chair, fade.wc)));
    wc.traverse((o) => o.material && (o.material.opacity = Math.max(fade.chair, fade.wc)));
    // legs dim when not scored
    const dim = mode === 'standing' ? 1 : 0.25;
    for (const j of rig.joints) {
      if (/^(hip|knee|ankle|toe)/.test(j.name)) j.mesh.scale.setScalar(lerp(j.mesh.scale.x, dim, dt * 4));
    }
    st.camera.position.x = Math.sin(t * 0.3) * 0.5 + 1.7;
    st.camera.lookAt(st.target);
  };
}

/* ------------------------------------------------------------------ */
/*  DOM interactions                                                   */
/* ------------------------------------------------------------------ */
function initDom() {
  document.documentElement.classList.add('js');
  // reveal-on-scroll (one-shot, subtle)
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.18 });
  document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));

  // nav state
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // mobile menu
  const menuBtn = document.querySelector('.menu-btn');
  menuBtn?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => {
    nav.classList.remove('open');
    menuBtn?.setAttribute('aria-expanded', 'false');
  }));

  // coming soon dialog
  const comingSoon = document.getElementById('coming-soon');
  document.querySelectorAll('[data-coming-soon-trigger]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      if (nav.classList.contains('open')) {
        nav.classList.remove('open');
        menuBtn?.setAttribute('aria-expanded', 'false');
      }
      comingSoon.showModal();
    });
  });
  document.querySelectorAll('[data-coming-soon-close]').forEach((button) => {
    button.addEventListener('click', () => comingSoon.close());
  });
  comingSoon.addEventListener('click', (event) => {
    if (event.target === comingSoon) comingSoon.close();
  });

  // B2C / B2B switch
  document.querySelectorAll('[data-market]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.market;
      document.querySelectorAll('[data-market]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      document.querySelectorAll('[data-market-panel]').forEach((p) => (p.hidden = p.dataset.marketPanel !== m));
      document.querySelector('.market-switch').dataset.active = m;
    });
  });

  // magnetic primary buttons (pointer only)
  if (FINE_POINTER && !REDUCED) {
    document.querySelectorAll('.btn-primary').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.25}px)`;
      });
      b.addEventListener('pointerleave', () => (b.style.transform = ''));
    });
  }

  // category spotlight
  document.querySelectorAll('.cat').forEach((c) => {
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', `${e.clientX - r.left}px`);
      c.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  // banner parallax
  const banner = document.querySelector('.banner');
  if (banner && !REDUCED) {
    const img = banner.querySelector('img');
    const para = () => {
      const r = banner.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      img.style.setProperty('--py', `${(-k * 60).toFixed(1)}px`);
    };
    window.addEventListener('scroll', para, { passive: true });
    para();
  }

  document.getElementById('year').textContent = new Date().getFullYear();
}

/* ------------------------------------------------------------------ */
function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

initDom();
if (webglOk()) {
  initHero();
  initProcess();
  initAdaptive();
  requestAnimationFrame(loop);
} else {
  document.documentElement.classList.add('no-webgl');
}
