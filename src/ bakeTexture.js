import * as THREE from 'three';
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

function getVec3(attr, i) {
  return new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i));
}

function getVec2(attr, i) {
  return new THREE.Vector2(attr.getX(i), attr.getY(i));
}

function barycentric2D(p, a, b, c) {
  const v0 = new THREE.Vector2().subVectors(b, a);
  const v1 = new THREE.Vector2().subVectors(c, a);
  const v2 = new THREE.Vector2().subVectors(p, a);

  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return null;

  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;

  return { u, v, w };
}

function insideBarycentric(b) {
  return b && b.u >= 0 && b.v >= 0 && b.w >= 0;
}

function sampleTextureColor(image, u, v) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * (image.width - 1))));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor((1 - v) * (image.height - 1))));
  const data = ctx.getImageData(x, y, 1, 1).data;

  return [data[0], data[1], data[2], data[3]];
}

function writePixel(imageData, x, y, rgba) {
  const idx = (y * imageData.width + x) * 4;
  imageData.data[idx + 0] = rgba[0];
  imageData.data[idx + 1] = rgba[1];
  imageData.data[idx + 2] = rgba[2];
  imageData.data[idx + 3] = rgba[3];
}

export async function bakeTextureFromOriginal({
  sourceMesh,
  targetGeometry,
  size = 1024,
}) {
  sourceMesh.updateMatrixWorld(true);

  if (!sourceMesh.geometry.boundsTree) {
    sourceMesh.geometry.computeBoundsTree();
  }

  const sourceMaterial = Array.isArray(sourceMesh.material)
    ? sourceMesh.material[0]
    : sourceMesh.material;

  if (!sourceMaterial?.map?.image) {
    throw new Error('Source mesh does not have a readable color texture map.');
  }

  const pos = targetGeometry.attributes.position;
  const uv = targetGeometry.attributes.uv;
  const index = targetGeometry.index?.array;

  if (!uv) {
    throw new Error('Target geometry has no UVs. Unwrap first.');
  }
  if (!index) {
    throw new Error('Target geometry must be indexed.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(size, size);

  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const rayOrigin = new THREE.Vector3();

  for (let f = 0; f < index.length; f += 3) {
    const i0 = index[f + 0];
    const i1 = index[f + 1];
    const i2 = index[f + 2];

    p0.copy(getVec3(pos, i0));
    p1.copy(getVec3(pos, i1));
    p2.copy(getVec3(pos, i2));

    const uv0 = getVec2(uv, i0);
    const uv1 = getVec2(uv, i1);
    const uv2 = getVec2(uv, i2);

    faceNormal
      .subVectors(p1, p0)
      .cross(new THREE.Vector3().subVectors(p2, p0))
      .normalize();

    const minX = Math.max(0, Math.floor(Math.min(uv0.x, uv1.x, uv2.x) * size));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(uv0.x, uv1.x, uv2.x) * size));
    const minY = Math.max(0, Math.floor(Math.min(uv0.y, uv1.y, uv2.y) * size));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(uv0.y, uv1.y, uv2.y) * size));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;

        const bc = barycentric2D(new THREE.Vector2(u, v), uv0, uv1, uv2);
        if (!insideBarycentric(bc)) continue;

        worldPoint
          .set(0, 0, 0)
          .addScaledVector(p0, bc.u)
          .addScaledVector(p1, bc.v)
          .addScaledVector(p2, bc.w);

        let hit = null;

        rayOrigin.copy(worldPoint).addScaledVector(faceNormal, 1e-4);
        raycaster.set(rayOrigin, faceNormal);
        hit = raycaster.intersectObject(sourceMesh, true)[0] || null;

        if (!hit) {
          rayOrigin.copy(worldPoint).addScaledVector(faceNormal, -1e-4);
          raycaster.set(rayOrigin, faceNormal.clone().negate());
          hit = raycaster.intersectObject(sourceMesh, true)[0] || null;
        }

        if (!hit || !hit.uv) continue;

        const rgba = sampleTextureColor(sourceMaterial.map.image, hit.uv.x, hit.uv.y);
        writePixel(imageData, x, size - 1 - y, rgba);
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}