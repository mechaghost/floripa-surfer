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
import { sampleWave } from '../game/simulation/waves';

export type Ocean = {
  mesh: Mesh<BufferGeometry, ShaderMaterial>;
  update: (time: number, center: { x: number; z: number }) => void;
};

const deep = new Color('#00677b');
const shadow = new Color('#05495f');
const face = new Color('#06a7b8');
const brightFace = new Color('#60d1d6');
const foam = new Color('#f2ffff');
const VISUAL_CENTER_SMOOTHING = 0.55;
const WATER_DEPTH_OFFSET_FACTOR = 1;
const WATER_DEPTH_OFFSET_UNITS = 2;

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(300, 250, 86, 64);
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

  function update(time: number, center: { x: number; z: number }): void {
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
    const dt = previousUpdateTime === null ? 1 / 60 : Math.min(1 / 15, Math.max(0, time - previousUpdateTime));
    previousUpdateTime = time;
    if (!initialized) {
      visualCenterX = center.x;
      visualCenterZ = center.z;
      initialized = true;
    } else {
      visualCenterX = dampValue(visualCenterX, center.x, VISUAL_CENTER_SMOOTHING, dt);
      visualCenterZ = dampValue(visualCenterZ, center.z, VISUAL_CENTER_SMOOTHING, dt);
    }
    mesh.position.set(visualCenterX, 0, visualCenterZ);
    material.uniforms.uTime.value = time;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const worldX = x + visualCenterX;
      const worldZ = z + visualCenterZ;
      const wave = sampleWave(worldX, worldZ, time);
      position.setY(i, wave.height);

      const broadShade = Math.sin(worldX * 0.035 + worldZ * 0.048 + time * 0.025) * 0.5 + 0.5;
      const crossShade = Math.sin(worldX * 0.09 - worldZ * 0.025 + time * 0.045) * 0.5 + 0.5;
      const longBand = Math.sin(worldX * 0.07 + worldZ * 0.11 + time * 0.22) * 0.5 + 0.5;
      const colorMix = Math.min(1, wave.facePower * 0.78 + Math.max(0, wave.height) * 0.06 + broadShade * 0.08);
      const highlight = Math.min(1, wave.lipPower * 0.42 + Math.pow(longBand, 5) * wave.facePower * 0.24);
      tint.copy(deep).lerp(face, colorMix).lerp(brightFace, crossShade * 0.08);
      if (broadShade < 0.2) {
        tint.lerp(shadow, 0.08);
      }
      tint.lerp(foam, highlight);
      color.setXYZ(i, tint.r, tint.g, tint.b);
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return { mesh, update };
}

function dampValue(current: number, target: number, smoothing: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-smoothing * dt));
}
