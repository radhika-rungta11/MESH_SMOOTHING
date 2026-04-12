import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

export async function loadOriginalTexturedOBJ({ objUrl, mtlUrl }) {
  const mtlLoader = new MTLLoader();
  const materials = await mtlLoader.loadAsync(mtlUrl);
  materials.preload();

  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);

  const root = await objLoader.loadAsync(objUrl);

  let mesh = null;
  root.traverse((child) => {
    if (child.isMesh && !mesh) {
      mesh = child;
    }
  });

  if (!mesh) {
    throw new Error('No mesh found in OBJ.');
  }

  const cloned = new THREE.Mesh(
    mesh.geometry.clone(),
    Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone()
  );

  cloned.geometry.computeVertexNormals();
  cloned.updateMatrixWorld(true);

  return cloned;
}