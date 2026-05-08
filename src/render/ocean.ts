import {
  BufferAttribute,
  Color,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { sampleWave } from '../game/simulation/waves';

export type Ocean = {
  mesh: Mesh<PlaneGeometry, MeshStandardMaterial>;
  update: (time: number, center: { x: number; z: number }) => void;
};

const deep = new Color('#07566f');
const face = new Color('#0b9fb3');
const foam = new Color('#f2fbff');

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(240, 210, 90, 76);
  geometry.rotateX(-Math.PI / 2);

  const colors = new Float32Array(geometry.attributes.position.count * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  const material = new MeshStandardMaterial({
    color: '#1389a4',
    roughness: 0.32,
    metalness: 0.04,
    vertexColors: true,
  });

  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;

  function update(time: number, center: { x: number; z: number }): void {
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
    mesh.position.set(center.x, 0, center.z);

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const wave = sampleWave(x + center.x, z + center.z, time);
      position.setY(i, wave.height);

      const tint = deep.clone().lerp(face, wave.facePower).lerp(foam, wave.lipPower * 0.45);
      color.setXYZ(i, tint.r, tint.g, tint.b);
    }

    position.needsUpdate = true;
    color.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return { mesh, update };
}
