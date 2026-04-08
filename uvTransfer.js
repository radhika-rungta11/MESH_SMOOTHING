import * as THREE from 'three';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toNonIndexedGeometry(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!g.getAttribute('position')) {
    throw new Error('Geometry has no position attribute.');
  }
  return g;
}

function getTriangleVertex(attr, triIndex, corner) {
  const i = triIndex * 3 + corner;
  return new THREE.Vector3().fromBufferAttribute(attr, i);
}

function getTriangleUV(attr, triIndex, corner) {
  const i = triIndex * 3 + corner;
  return new THREE.Vector2().fromBufferAttribute(attr, i);
}

function closestPointOnSegment(p, a, b) {
  const ab = new THREE.Vector3().subVectors(b, a);
  const t = THREE.MathUtils.clamp(
    new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-12),
    0,
    1
  );
  return new THREE.Vector3().copy(a).addScaledVector(ab, t);
}

function closestPointOnTriangle(p, a, b, c) {
  // Real-Time Collision Detection style region tests

  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const ap = new THREE.Vector3().subVectors(p, a);

  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return a.clone();

  const bp = new THREE.Vector3().subVectors(p, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return b.clone();

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return a.clone().addScaledVector(ab, v);
  }

  const cp = new THREE.Vector3().subVectors(p, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return c.clone();

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return a.clone().addScaledVector(ac, w);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const bc = new THREE.Vector3().subVectors(c, b);
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return b.clone().addScaledVector(bc, w);
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return a.clone()
    .addScaledVector(ab, v)
    .addScaledVector(ac, w);
}

function barycentric(point, a, b, c) {
  const v0 = new THREE.Vector3().subVectors(b, a);
  const v1 = new THREE.Vector3().subVectors(c, a);
  const v2 = new THREE.Vector3().subVectors(point, a);

  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) {
    return { w0: 1, w1: 0, w2: 0 };
  }

  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;

  return { w0: u, w1: v, w2: w };
}

function interpolateUV(uv0, uv1, uv2, bc) {
  return new THREE.Vector2()
    .addScaledVector(uv0, bc.w0)
    .addScaledVector(uv1, bc.w1)
    .addScaledVector(uv2, bc.w2);
}

function remapTargetPointToSourceSpace(pointWorld, sourceMesh) {
  return sourceMesh.worldToLocal(pointWorld.clone());
}

function targetPointToWorld(pointLocal, targetMesh) {
  return targetMesh.localToWorld(pointLocal.clone());
}

/* -------------------------------------------------------------------------- */
/* Core UV transfer                                                           */
/* -------------------------------------------------------------------------- */

export function transferUVsFromSourceMesh({
  sourceMesh,
  targetMesh,
  debug = false
}) {
  if (!sourceMesh.geometry.getAttribute('uv')) {
    throw new Error('Source mesh has no UVs. The original textured mesh must already contain UVs.');
  }

  const sourceGeometry = toNonIndexedGeometry(sourceMesh.geometry);
  const targetGeometry = toNonIndexedGeometry(targetMesh.geometry);

  sourceGeometry.computeVertexNormals();
  targetGeometry.computeVertexNormals();

  const srcPos = sourceGeometry.getAttribute('position');
  const srcUV = sourceGeometry.getAttribute('uv');

  const tgtPos = targetGeometry.getAttribute('position');
  const tgtNormal = targetGeometry.getAttribute('normal');

  const triangleCount = srcPos.count / 3;

  const newPositions = new Float32Array(tgtPos.array.length);
  newPositions.set(tgtPos.array);

  const newNormals = tgtNormal
    ? new Float32Array(tgtNormal.array.length)
    : null;

  if (newNormals) {
    newNormals.set(tgtNormal.array);
  }

  const newUVs = new Float32Array((tgtPos.count) * 2);

  const tmpTargetPoint = new THREE.Vector3();

  let maxDistance = 0;

  for (let i = 0; i < tgtPos.count; i++) {
    tmpTargetPoint.fromBufferAttribute(tgtPos, i);

    // Convert target point to world space, then into source local space
    const pointWorld = targetPointToWorld(tmpTargetPoint, targetMesh);
    const pointInSourceSpace = remapTargetPointToSourceSpace(pointWorld, sourceMesh);

    let bestTri = -1;
    let bestPoint = null;
    let bestDistSq = Infinity;

    // Brute-force closest triangle search
    // For production, replace this with BVH acceleration.
    for (let tri = 0; tri < triangleCount; tri++) {
      const a = getTriangleVertex(srcPos, tri, 0);
      const b = getTriangleVertex(srcPos, tri, 1);
      const c = getTriangleVertex(srcPos, tri, 2);

      const closest = closestPointOnTriangle(pointInSourceSpace, a, b, c);
      const distSq = closest.distanceToSquared(pointInSourceSpace);

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestTri = tri;
        bestPoint = closest;
      }
    }

    if (bestTri === -1 || !bestPoint) {
      newUVs[i * 2 + 0] = 0;
      newUVs[i * 2 + 1] = 0;
      continue;
    }

    maxDistance = Math.max(maxDistance, Math.sqrt(bestDistSq));

    const a = getTriangleVertex(srcPos, bestTri, 0);
    const b = getTriangleVertex(srcPos, bestTri, 1);
    const c = getTriangleVertex(srcPos, bestTri, 2);

    const uv0 = getTriangleUV(srcUV, bestTri, 0);
    const uv1 = getTriangleUV(srcUV, bestTri, 1);
    const uv2 = getTriangleUV(srcUV, bestTri, 2);

    const bc = barycentric(bestPoint, a, b, c);
    const uv = interpolateUV(uv0, uv1, uv2, bc);

    newUVs[i * 2 + 0] = uv.x;
    newUVs[i * 2 + 1] = uv.y;
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));

  if (newNormals) {
    result.setAttribute('normal', new THREE.BufferAttribute(newNormals, 3));
  } else {
    result.computeVertexNormals();
  }

  result.setAttribute('uv', new THREE.BufferAttribute(newUVs, 2));

  if (debug) {
    console.log('UV transfer complete');
    console.log('Target vertices:', tgtPos.count);
    console.log('Source triangles:', triangleCount);
    console.log('Max closest-point distance:', maxDistance);
  }

  return result;
}