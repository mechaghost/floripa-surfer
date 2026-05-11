import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Uniform,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import type { SurferState } from '../game/simulation/surfer';
import { sampleWave } from '../game/simulation/waves';

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

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(300, 250, 156, 128);
  geometry.rotateX(-Math.PI / 2);

  const colors = new Float32Array(geometry.attributes.position.count * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const material = new ShaderMaterial({
    lights: true,
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

      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        vColor = color;
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
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      float waveLine(vec2 p, float scale, float speed, float width) {
        float ridge = sin(p.x * scale + p.y * scale * 0.42 + uTime * speed);
        return smoothstep(1.0 - width, 1.0, ridge);
      }

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0);
        float sun = pow(max(dot(reflect(-uSunDirection, normal), viewDirection), 0.0), 26.0);
        float softSun = pow(max(dot(normal, uSunDirection), 0.0), 1.15);
        float facetLight = clamp(normal.y * 0.62 + normal.z * 0.16 + 0.42, 0.0, 1.0);

        vec2 p = vWorldPosition.xz;
        float longFoamLines =
          waveLine(p + vec2(0.0, uTime * 0.25), 0.17, 0.42, 0.035) * 0.34 +
          waveLine(p.yx + vec2(uTime * 0.18, 0.0), 0.24, -0.35, 0.03) * 0.2;

        float crest = smoothstep(0.48, 0.92, vColor.b - max(vColor.r, vColor.g) * 0.22);
        vec3 water = mix(uDeep, uFace, clamp(vColor.g * 1.18 + softSun * 0.16, 0.0, 1.0));
        water = mix(water, vColor, 0.7);
        water *= 0.76 + facetLight * 0.38;
        water += vec3(0.08, 0.2, 0.22) * fresnel;
        water += vec3(0.08, 0.14, 0.14) * longFoamLines;
        water += vec3(1.0, 0.96, 0.78) * sun * 0.28;
        water = mix(water, uFoam, clamp(crest * 0.64 + longFoamLines * crest * 0.38, 0.0, 0.86));

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
  const wakeStamps: WaterDeformationStamp[] = [];

  function update(time: number, board: OceanBoardState): void {
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
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

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const worldX = x + visualCenterX;
      const worldZ = z + visualCenterZ;
      const wave = sampleWave(worldX, worldZ, time);
      const liveDeformation = getBoardWaterDeformation(worldX, worldZ, wave.height, board);
      const wakeDeformation = getTemporalWaterDeformation(worldX, worldZ, wakeStamps);
      const heightOffset = liveDeformation.heightOffset + wakeDeformation.heightOffset;
      const foamAmount = Math.min(1, liveDeformation.foam + wakeDeformation.foam);
      position.setY(i, wave.height + heightOffset);

      const broadShade = Math.sin(worldX * 0.035 + worldZ * 0.048 + time * 0.025) * 0.5 + 0.5;
      const crossShade = Math.sin(worldX * 0.09 - worldZ * 0.025 + time * 0.045) * 0.5 + 0.5;
      const longBand = Math.sin(worldX * 0.07 + worldZ * 0.11 + time * 0.22) * 0.5 + 0.5;
      const colorMix = Math.min(1, wave.facePower * 0.78 + Math.max(0, wave.height) * 0.06 + broadShade * 0.08);
      const highlight = Math.min(1, wave.lipPower * 0.42 + Math.pow(longBand, 5) * wave.facePower * 0.24);
      const boardShadow = Math.min(0.45, Math.max(0, -heightOffset) * 2.4);
      const boardLip = Math.min(0.38, Math.max(0, heightOffset) * 2.6);
      tint.copy(deep).lerp(face, colorMix).lerp(brightFace, crossShade * 0.08);
      if (broadShade < 0.2) {
        tint.lerp(shadow, 0.08);
      }
      tint.lerp(shadow, boardShadow);
      tint.lerp(brightFace, boardLip);
      tint.lerp(foam, foamAmount * 0.36);
      tint.lerp(foam, highlight);
      color.setXYZ(i, tint.r, tint.g, tint.b);
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    geometry.computeVertexNormals();
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
