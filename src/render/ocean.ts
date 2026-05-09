import {
  BufferAttribute,
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
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  update: (time: number, center: { x: number; z: number }) => void;
};

const deep = new Color('#04516a');
const face = new Color('#0ca8bd');
const foam = new Color('#effdff');

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(260, 230, 116, 96);
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
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.2);
        float sun = pow(max(dot(reflect(-uSunDirection, normal), viewDirection), 0.0), 34.0);
        float softSun = pow(max(dot(normal, uSunDirection), 0.0), 1.35);

        vec2 p = vWorldPosition.xz;
        float microRipples =
          waveLine(p + vec2(0.0, uTime * 0.55), 0.82, 1.9, 0.12) * 0.28 +
          waveLine(p.yx + vec2(uTime * 0.22, 0.0), 1.34, -1.2, 0.08) * 0.18 +
          waveLine(p + vec2(12.0, -5.0), 2.7, 2.65, 0.045) * 0.12;

        float crest = smoothstep(0.48, 0.92, vColor.b - max(vColor.r, vColor.g) * 0.22);
        vec3 water = mix(uDeep, uFace, clamp(vColor.g * 1.35 + softSun * 0.24, 0.0, 1.0));
        water = mix(water, vColor, 0.44);
        water += vec3(0.08, 0.17, 0.19) * fresnel;
        water += vec3(0.05, 0.1, 0.12) * microRipples;
        water += vec3(1.0, 0.92, 0.72) * sun * 0.38;
        water = mix(water, uFoam, clamp(crest * 0.72 + microRipples * crest * 0.4, 0.0, 0.92));

        float castShadow = 1.0 - getShadowMask();
        water *= 1.0 - castShadow * 0.48;
        water = mix(water, vec3(0.015, 0.18, 0.23), castShadow * 0.22);

        gl_FragColor = vec4(water, 1.0);
      }
    `,
  });

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;

  function update(time: number, center: { x: number; z: number }): void {
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
    mesh.position.set(center.x, 0, center.z);
    material.uniforms.uTime.value = time;

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const wave = sampleWave(x + center.x, z + center.z, time);
      position.setY(i, wave.height);

      const chop = Math.sin((x + center.x) * 0.85 + (z + center.z) * 0.34 + time * 3.2) * 0.5 + 0.5;
      const highlight = Math.min(1, wave.lipPower * 0.58 + chop * wave.facePower * 0.14);
      const tint = deep.clone().lerp(face, wave.facePower * 0.88).lerp(foam, highlight);
      color.setXYZ(i, tint.r, tint.g, tint.b);
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return { mesh, update };
}
