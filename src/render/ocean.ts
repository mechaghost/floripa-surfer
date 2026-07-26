import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Uniform,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import type { SurferState } from '../game/simulation/surfer';
import { sampleSurfaceInto, sampleWave, type SurfaceSample } from '../game/simulation/waves';

export type OceanBoardState = Pick<
  SurferState,
  'position' | 'height' | 'heading' | 'bank' | 'pitch' | 'speed' | 'airtime' | 'verticalVelocity'
>;

export type Ocean = {
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  update: (time: number, board: OceanBoardState) => void;
};

export type BoardWaterDeformation = {
  heightOffset: number;
  alpha: number;
  foam: number;
};

export type WaterDeformationStamp = {
  x: number;
  z: number;
  heading: number;
  age: number;
  lifetime: number;
  strength: number;
  width: number;
  length: number;
};

const deep = new Color('#00677b');
const shadow = new Color('#05495f');
const face = new Color('#06a7b8');
const brightFace = new Color('#60d1d6');
const foam = new Color('#f2ffff');
const VISUAL_CENTER_SMOOTHING = 0.55;
const WATER_DEPTH_OFFSET_FACTOR = 1;
const WATER_DEPTH_OFFSET_UNITS = 2;
const BOARD_LENGTH = 4.65;
const BOARD_WIDTH = 2.05;
const WAKE_STAMP_LIMIT = 34;
const WAKE_STAMP_CULL_CROSS = 2.15;
const WAKE_STAMP_CULL_LONGITUDINAL = 2.15;
const OCEAN_NORMAL_UPDATE_INTERVAL = 2;
const BOARD_DEFORM_RADIUS_SQ = 68;

const scratchSurface: SurfaceSample = {
  height: 0,
  offsetX: 0,
  offsetZ: 0,
  curl: 0,
  whitewater: 0,
  foam: 0,
  thin: 0,
  cave: 0,
  faceLight: 0,
};

type StampBounds = {
  x: number;
  z: number;
  radiusSq: number;
};

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(290, 235, 164, 156);
  geometry.rotateX(-Math.PI / 2);

  const vertexCount = geometry.attributes.position.count;
  const basePositions = new Float32Array(geometry.attributes.position.array);
  const colors = new Float32Array(vertexCount * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const info = new Float32Array(vertexCount * 3);
  geometry.setAttribute('info', new BufferAttribute(info, 3));

  const material = new ShaderMaterial({
    lights: true,
    // The curling lip folds the sheet over itself, so the tube interior shows
    // the underside of the surface.
    side: DoubleSide,
    uniforms: UniformsUtils.merge([
      UniformsLib.lights,
      {
        uTime: new Uniform(0),
        uSunDirection: new Uniform(new Vector3(-0.38, 0.78, 0.5).normalize()),
        uDeep: new Uniform(deep),
        uFace: new Uniform(face),
        uFoam: new Uniform(foam),
      },
    ]),
    vertexShader: `
      #include <common>
      #include <shadowmap_pars_vertex>

      attribute vec3 color;
      attribute vec3 info;

      varying vec3 vColor;
      varying vec3 vInfo;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vColor = color;
        vInfo = info;
        vec3 transformedNormal = normal;
        vNormal = normalize(normalMatrix * transformedNormal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;

        #include <shadowmap_vertex>

        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp float;

      #include <common>
      #include <packing>
      #include <bsdfs>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>

      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform vec3 uDeep;
      uniform vec3 uFace;
      uniform vec3 uFoam;

      varying vec3 vColor;
      varying vec3 vInfo;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      float waveLine(vec2 p, float scale, float speed, float width) {
        float ridge = sin(p.x * scale + p.y * scale * 0.42 + uTime * speed);
        return smoothstep(1.0 - width, 1.0, ridge);
      }

      void main() {
        float interior = gl_FrontFacing ? 0.0 : 1.0;
        vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0);
        float sun = pow(max(dot(reflect(-uSunDirection, normal), viewDirection), 0.0), 26.0);
        float softSun = pow(max(dot(normal, uSunDirection), 0.0), 1.15);
        float facetLight = clamp(normal.y * 0.62 + normal.z * 0.16 + 0.42, 0.0, 1.0);

        float foamAmount = vInfo.x;
        float thin = vInfo.y;
        // Underside of the folded sheet is always tube interior.
        float cave = max(vInfo.z, interior * 0.85);

        vec2 p = vWorldPosition.xz;
        float longFoamLines =
          waveLine(p + vec2(0.0, uTime * 0.25), 0.17, 0.42, 0.035) * 0.34 +
          waveLine(p.yx + vec2(uTime * 0.18, 0.0), 0.24, -0.35, 0.03) * 0.2;

        // Smooth boiling noise so whitewater and the lip edge churn without
        // reading as a hard cell grid.
        float boil = 0.5 + 0.5 * (
          sin(p.x * 2.1 + p.y * 1.7 + uTime * 1.9) * 0.5 +
          sin(p.x * 4.7 - p.y * 3.9 - uTime * 2.7 + 1.7) * 0.33 +
          sin(p.x * 9.3 + p.y * 8.1 + uTime * 3.6) * 0.17
        );
        float foamDetail = smoothstep(0.22, 0.78, foamAmount * (0.62 + 0.38 * boil) + longFoamLines * foamAmount * 0.4);

        vec3 water = mix(uDeep, uFace, clamp(vColor.g * 1.18 + softSun * 0.16, 0.0, 1.0));
        water = mix(water, vColor, 0.7);
        water *= 0.76 + facetLight * 0.38;
        water += vec3(0.08, 0.2, 0.22) * fresnel * (1.0 - cave * 0.8);
        water += vec3(0.08, 0.14, 0.14) * longFoamLines * (1.0 - cave);
        water += vec3(1.0, 0.96, 0.78) * sun * 0.28 * (1.0 - cave * 0.7);

        // Flow streaks climbing the steep part of the face keep the wall from
        // reading as a flat sheet.
        float steep = clamp(1.0 - normal.y, 0.0, 1.0);
        float faceStreak = waveLine(vec2(p.x * 0.62 + p.y * 0.2, p.y * 0.3 + uTime * 0.4), 1.1, 1.3, 0.3);
        water += vec3(0.045, 0.15, 0.16) * faceStreak * steep * (1.0 - cave * 0.6);

        // Inside the tube: darker, greener, the sky reflection dies off, but
        // sunlight filtering through the water keeps an emerald glow alive.
        water = mix(water, water * vec3(0.42, 0.66, 0.72), cave * 0.8);
        water += vec3(0.01, 0.16, 0.15) * interior * (0.4 + softSun * 0.6);

        // The pitching lip is thin enough to glow with backlit sunlight, and
        // seen from inside the tube the curtain keeps a softer glow.
        float backlight = clamp(dot(viewDirection, -uSunDirection) * 0.5 + 0.5, 0.0, 1.0);
        water += vec3(0.14, 0.78, 0.72) * thin * (0.35 + backlight * 0.65) * (0.55 - interior * 0.2);

        water = mix(water, uFoam, clamp(foamDetail * 0.9 + foamAmount * 0.22, 0.0, 0.95));

        float castShadow = 1.0 - getShadowMask();
        water *= 1.0 - castShadow * 0.34;
        water = mix(water, vec3(0.02, 0.2, 0.25), castShadow * 0.16);

        gl_FragColor = vec4(water, 1.0);
      }
    `,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = WATER_DEPTH_OFFSET_FACTOR;
  material.polygonOffsetUnits = WATER_DEPTH_OFFSET_UNITS;

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  const tint = new Color();
  let visualCenterX = 0;
  let visualCenterZ = 0;
  let previousUpdateTime: number | null = null;
  let initialized = false;
  let wakeEmitCarry = 0;
  let wakeStampIndex = 0;
  let normalUpdateFrame = 0;
  const wakeStamps: WaterDeformationStamp[] = [];
  const stampBounds: StampBounds[] = [];

  function update(time: number, board: OceanBoardState): void {
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
    const infoAttribute = geometry.attributes.info;
    const dt = previousUpdateTime === null ? 1 / 60 : Math.min(1 / 15, Math.max(0, time - previousUpdateTime));
    previousUpdateTime = time;
    if (!initialized) {
      visualCenterX = board.position.x;
      visualCenterZ = board.position.z;
      initialized = true;
    } else {
      visualCenterX = dampValue(visualCenterX, board.position.x, VISUAL_CENTER_SMOOTHING, dt);
      visualCenterZ = dampValue(visualCenterZ, board.position.z, VISUAL_CENTER_SMOOTHING, dt);
    }
    mesh.position.set(visualCenterX, 0, visualCenterZ);
    material.uniforms.uTime.value = time;
    ageWakeStamps(wakeStamps, dt);

    const boardContact = getBoardWaterContactStrength(
      sampleWave(board.position.x, board.position.z, time).height,
      board.height,
      board,
    );
    const speedPressure = clamp((board.speed - 2.8) / 10, 0, 1);
    const emitRate = boardContact * speedPressure * 22;
    wakeEmitCarry = emitRate > 0 ? wakeEmitCarry + emitRate * dt : 0;
    while (wakeEmitCarry >= 1) {
      addWakeStamp(wakeStamps, board, boardContact * (0.72 + speedPressure * 0.42), wakeStampIndex);
      wakeStampIndex += 1;
      wakeEmitCarry -= 1;
    }

    stampBounds.length = wakeStamps.length;
    for (let i = 0; i < wakeStamps.length; i += 1) {
      const stamp = wakeStamps[i];
      const life = clamp(stamp.age / stamp.lifetime, 0, 1);
      const width = stamp.width * (1 + life * 0.72);
      const length = stamp.length * (1 + life * 1.15);
      const radius = Math.max(width * WAKE_STAMP_CULL_CROSS, length * WAKE_STAMP_CULL_LONGITUDINAL);
      stampBounds[i] = { x: stamp.x, z: stamp.z, radiusSq: radius * radius };
    }

    const boardX = board.position.x;
    const boardZ = board.position.z;

    for (let i = 0; i < position.count; i += 1) {
      const baseX = basePositions[i * 3];
      const baseZ = basePositions[i * 3 + 2];
      const worldX = baseX + visualCenterX;
      const worldZ = baseZ + visualCenterZ;
      const surf = sampleSurfaceInto(scratchSurface, worldX, worldZ, time);

      let heightOffset = 0;
      let contactFoam = 0;
      const dxBoard = worldX - boardX;
      const dzBoard = worldZ - boardZ;
      if (dxBoard * dxBoard + dzBoard * dzBoard < BOARD_DEFORM_RADIUS_SQ) {
        const liveDeformation = getBoardWaterDeformation(worldX, worldZ, surf.height, board);
        heightOffset += liveDeformation.heightOffset;
        contactFoam += liveDeformation.foam;
      }
      for (let stampIndex = 0; stampIndex < wakeStamps.length; stampIndex += 1) {
        const bounds = stampBounds[stampIndex];
        const dxStamp = worldX - bounds.x;
        const dzStamp = worldZ - bounds.z;
        if (dxStamp * dxStamp + dzStamp * dzStamp > bounds.radiusSq) {
          continue;
        }
        const wakeDeformation = getWakeStampDeformation(worldX, worldZ, wakeStamps[stampIndex]);
        heightOffset += wakeDeformation.heightOffset;
        contactFoam += wakeDeformation.foam;
      }

      const foamTotal = Math.min(1, surf.foam + contactFoam);
      position.setXYZ(i, baseX + surf.offsetX, surf.height + heightOffset, baseZ + surf.offsetZ);

      const broadShade = Math.sin(worldX * 0.035 + worldZ * 0.048 + time * 0.025) * 0.5 + 0.5;
      const colorMix = Math.min(
        1,
        surf.faceLight * 0.9 + Math.max(0, surf.height) * 0.24 + broadShade * 0.1,
      );
      const boardShadow = Math.min(0.45, Math.max(0, -heightOffset) * 2.4);
      const boardLip = Math.min(0.38, Math.max(0, heightOffset) * 2.6);
      tint.copy(deep).lerp(face, colorMix);
      tint.lerp(brightFace, surf.curl * 0.24 + surf.faceLight * (0.14 + broadShade * 0.16));
      if (broadShade < 0.2) {
        tint.lerp(shadow, 0.08);
      }
      tint.lerp(shadow, boardShadow + surf.cave * 0.3);
      tint.lerp(brightFace, boardLip);
      tint.lerp(foam, foamTotal * 0.34);
      color.setXYZ(i, tint.r, tint.g, tint.b);
      infoAttribute.setXYZ(i, foamTotal, surf.thin, surf.cave);
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    infoAttribute.needsUpdate = true;
    if (normalUpdateFrame % OCEAN_NORMAL_UPDATE_INTERVAL === 0) {
      geometry.computeVertexNormals();
    }
    normalUpdateFrame += 1;
  }

  return { mesh, update };
}

export function getBoardWaterDeformation(
  worldX: number,
  worldZ: number,
  waterHeight: number,
  board: OceanBoardState,
): BoardWaterDeformation {
  const forwardX = Math.sin(board.heading);
  const forwardZ = -Math.cos(board.heading);
  const rightX = Math.cos(board.heading);
  const rightZ = Math.sin(board.heading);
  const dx = worldX - board.position.x;
  const dz = worldZ - board.position.z;
  const localX = dx * rightX + dz * rightZ;
  const localZ = dx * forwardX + dz * forwardZ;
  const halfLength = BOARD_LENGTH * 0.5;
  const lengthT = Math.abs(localZ) / halfLength;
  const tailTaper = smoothstep(0.62, 1, lengthT);
  const halfWidth = (BOARD_WIDTH * 0.5) * (1 - tailTaper * 0.5);
  const widthT = Math.abs(localX) / Math.max(0.08, halfWidth);
  const boardHeight = board.height - Math.sin(board.pitch) * localZ - Math.sin(board.bank) * localX * 0.42;
  const contact = getBoardWaterContactStrength(waterHeight, boardHeight, board);
  const speedPressure = clamp((board.speed - 3.5) / 12, 0, 1);
  const rear = smoothstep(0.04, 0.82, -localZ / halfLength);
  const front = smoothstep(0.04, 0.82, localZ / halfLength);

  const hull =
    (1 - smoothstep(0.78, 1.2, lengthT)) *
    (1 - smoothstep(0.72, 1.14, widthT)) *
    (1 - front * 0.28);
  const rail =
    smoothstep(0.58, 1.02, widthT) *
    (1 - smoothstep(1.02, 1.45, widthT)) *
    (1 - smoothstep(0.9, 1.22, lengthT)) *
    (0.68 + rear * 0.36);
  const nose = smoothstep(0.24, 0.86, front) * (1 - smoothstep(0.62, 1.28, widthT));
  const tailWake = smoothstep(0.1, 0.96, rear) * (1 - smoothstep(0.44, 1.46, widthT));
  const pressure = contact * (0.58 + speedPressure * 0.42);
  const depression = -0.18 * hull * pressure * (0.82 + rear * 0.3);
  const railLift = 0.12 * rail * pressure * (0.7 + speedPressure * 0.5);
  const noseLift = 0.02 * nose * pressure * speedPressure;
  const tailDraw = -0.075 * tailWake * pressure * (0.55 + speedPressure * 0.45);
  const wakeLift = 0.028 * tailWake * pressure * speedPressure;
  const influence = clamp(Math.max(hull * 0.88, rail, nose * 0.72, tailWake * 0.5) * contact, 0, 1);

  return {
    heightOffset: depression + railLift + noseLift + tailDraw + wakeLift,
    alpha: influence,
    foam: clamp(rail * pressure * 0.7 + tailWake * pressure * speedPressure * 0.38, 0, 1),
  };
}

export function getTemporalWaterDeformation(
  worldX: number,
  worldZ: number,
  stamps: WaterDeformationStamp[],
): BoardWaterDeformation {
  let heightOffset = 0;
  let alpha = 0;
  let foamAmount = 0;

  for (const stamp of stamps) {
    if (!isNearWakeStamp(worldX, worldZ, stamp)) {
      continue;
    }

    const deformation = getWakeStampDeformation(worldX, worldZ, stamp);
    heightOffset += deformation.heightOffset;
    alpha = Math.max(alpha, deformation.alpha);
    foamAmount += deformation.foam;
  }

  return {
    heightOffset,
    alpha: clamp(alpha, 0, 1),
    foam: clamp(foamAmount, 0, 1),
  };
}

export function getWakeStampDeformation(
  worldX: number,
  worldZ: number,
  stamp: WaterDeformationStamp,
): BoardWaterDeformation {
  const life = clamp(stamp.age / stamp.lifetime, 0, 1);
  const fade = Math.pow(1 - life, 2.2);
  if (fade <= 0) {
    return { heightOffset: 0, alpha: 0, foam: 0 };
  }

  const forwardX = Math.sin(stamp.heading);
  const forwardZ = -Math.cos(stamp.heading);
  const rightX = Math.cos(stamp.heading);
  const rightZ = Math.sin(stamp.heading);
  const dx = worldX - stamp.x;
  const dz = worldZ - stamp.z;
  const localX = dx * rightX + dz * rightZ;
  const localZ = dx * forwardX + dz * forwardZ;
  const width = stamp.width * (1 + life * 0.72);
  const length = stamp.length * (1 + life * 1.15);
  const cross = Math.abs(localX) / width;
  const longitudinal = Math.abs(localZ) / length;
  if (cross > WAKE_STAMP_CULL_CROSS || longitudinal > WAKE_STAMP_CULL_LONGITUDINAL) {
    return { heightOffset: 0, alpha: 0, foam: 0 };
  }

  const core = Math.exp(-(cross * cross * 1.85 + longitudinal * longitudinal * 1.15));
  const railRim =
    smoothstep(0.48, 0.88, cross) *
    (1 - smoothstep(0.88, 1.32, cross)) *
    (1 - smoothstep(0.4, 1.15, longitudinal));
  const trough = -0.08 * stamp.strength * fade * core;
  const rebound = 0.032 * stamp.strength * fade * railRim;

  return {
    heightOffset: trough + rebound,
    alpha: clamp(Math.max(core, railRim) * fade * stamp.strength, 0, 1),
    foam: clamp(railRim * fade * stamp.strength * 0.55, 0, 1),
  };
}

function isNearWakeStamp(worldX: number, worldZ: number, stamp: WaterDeformationStamp): boolean {
  const life = clamp(stamp.age / stamp.lifetime, 0, 1);
  if (life >= 1) {
    return false;
  }

  const width = stamp.width * (1 + life * 0.72);
  const length = stamp.length * (1 + life * 1.15);
  const radius = Math.max(width * WAKE_STAMP_CULL_CROSS, length * WAKE_STAMP_CULL_LONGITUDINAL);
  const dx = worldX - stamp.x;
  const dz = worldZ - stamp.z;

  return dx * dx + dz * dz <= radius * radius;
}

function dampValue(current: number, target: number, smoothing: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-smoothing * dt));
}

function ageWakeStamps(stamps: WaterDeformationStamp[], dt: number): void {
  for (const stamp of stamps) {
    stamp.age += dt;
  }

  for (let index = stamps.length - 1; index >= 0; index -= 1) {
    if (stamps[index].age >= stamps[index].lifetime) {
      stamps.splice(index, 1);
    }
  }
}

function addWakeStamp(
  stamps: WaterDeformationStamp[],
  board: OceanBoardState,
  strength: number,
  index: number,
): void {
  const forwardX = Math.sin(board.heading);
  const forwardZ = -Math.cos(board.heading);
  const rightX = Math.cos(board.heading);
  const rightZ = Math.sin(board.heading);
  const side = (index % 2 === 0 ? -1 : 1) * (0.12 + pseudo(index * 7.3) * 0.34);
  const tailDistance = 0.78 + pseudo(index * 5.1 + 2.4) * 0.9;
  const x = board.position.x - forwardX * tailDistance + rightX * side;
  const z = board.position.z - forwardZ * tailDistance + rightZ * side;

  stamps.push({
    x,
    z,
    heading: board.heading,
    age: 0,
    lifetime: 0.82 + clamp(board.speed / 18, 0, 1) * 0.72,
    strength: clamp(strength, 0, 1),
    width: 0.54 + pseudo(index * 3.9 + 1.1) * 0.16,
    length: 1.05 + clamp(board.speed / 16, 0, 1) * 0.62,
  });

  while (stamps.length > WAKE_STAMP_LIMIT) {
    stamps.shift();
  }
}

function getBoardWaterContactStrength(waterHeight: number, boardHeight: number, board: OceanBoardState): number {
  if (board.airtime > 0 || board.verticalVelocity > 0.08) {
    return 0;
  }

  return smoothstep(-0.28, 0.08, waterHeight - boardHeight);
}

function pseudo(value: number): number {
  const raw = Math.sin(value * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
