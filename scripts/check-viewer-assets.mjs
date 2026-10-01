import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const types = {
  uint8: { bytes: 1, read: (b, i) => b.readUInt8(i) },
  float32: { bytes: 4, read: (b, i) => b.readFloatLE(i) },
  uint16: { bytes: 2, read: (b, i) => b.readUInt16LE(i) },
  uint32: { bytes: 4, read: (b, i) => b.readUInt32LE(i) },
};
const privatePath = /(?:\/Users\/|\/private\/|\/nfs\d*\/|\/home\/|\/valiant\d*\/|[\w.-]+@[\w.-]+:\/|\bsub-[A-Za-z0-9]+\b)/;
const privateKeys = new Set(['subject', 'subjectId', 'subjectID', 'sourceFiles', 'localSourceFile', 'sourceIndex', 'normalization']);
const integer = n => Number.isSafeInteger(n) && n >= 0;

// The same checks can run against source assets before a build or the deployed copy.
export function checkViewerAssets(assetDirectory, { atlas = 'pathway-atlas.json', includeOriginals = true, requireAtlas = false } = {}) {
  const errors = [];
  const fail = (name, message) => { errors.push(`${name}: ${message}`); };
  const insist = (condition, name, message) => { if (!condition) throw new Error(`${name}: ${message}`); };
  const capture = fn => { try { fn(); } catch (error) { errors.push(error.message); } };
  const scanPrivate = (value, name) => {
    if (typeof value === 'string' && privatePath.test(value)) fail(name, 'private source path or subject identifier leaked');
    if (Array.isArray(value)) value.forEach(v => scanPrivate(v, name));
    else if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) {
      if (privateKeys.has(key)) fail(name, `unnecessary private provenance (${key})`);
      scanPrivate(v, name);
    }
  };
  const localPath = name => {
    insist(typeof name === 'string' && name.length > 0 && !path.isAbsolute(name) && !name.includes('\\') && !name.split('/').includes('..') && !/[?#:]/.test(name), 'Viewer asset', 'must use a relative local filename');
    return path.join(assetDirectory, name);
  };
  const json = name => {
    const value = JSON.parse(fs.readFileSync(localPath(name), 'utf8'));
    scanPrivate(value, name);
    return value;
  };
  const buffer = (name, expectedHash) => {
    const bytes = fs.readFileSync(localPath(name));
    if (expectedHash !== undefined) {
      insist(/^[a-f0-9]{64}$/i.test(expectedHash), name, 'invalid SHA-256 metadata');
      insist(createHash('sha256').update(bytes).digest('hex') === expectedHash.toLowerCase(), name, 'SHA-256 mismatch');
    }
    // These are explicit .gz assets, not an HTTP Content-Encoding assumption.
    return name.endsWith('.gz') ? gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }) : bytes;
  };
  const typed = (name, type, count, expectedHash) => {
    insist(integer(count), name, 'invalid element count');
    const spec = types[type];
    insist(spec, name, `unsupported numeric type ${type}`);
    const bytes = buffer(name, expectedHash);
    insist(bytes.length === count * spec.bytes, name, `decoded size ${bytes.length} does not match ${count} ${type} values`);
    return { count, get: i => spec.read(bytes, i * spec.bytes) };
  };
  const floatTriples = (name, count, expectedHash, normals = false) => {
    const values = typed(name, 'float32', count * 3, expectedHash);
    for (let i = 0; i < values.count; i += 3) {
      const xyz = [values.get(i), values.get(i + 1), values.get(i + 2)];
      insist(xyz.every(Number.isFinite), name, 'non-finite geometry');
      if (!normals) insist(xyz.every(v => Math.abs(v) <= 2.5), name, 'position is outside normalized brain coordinates');
      if (normals) insist(Math.abs(Math.hypot(...xyz) - 1) < .025, name, 'normal is not unit length');
    }
    return values;
  };
  const centroid = (points, name, pointCount, coordinateLimit = 2.5) => {
    insist(Array.isArray(points) && points.length >= 2, name, 'centroid needs at least two points');
    if (pointCount !== undefined) insist(pointCount === points.length, name, 'centroid count mismatch');
    insist(points.every(p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(v) && Math.abs(v) <= coordinateLimit)), name, 'invalid normalized centroid geometry');
  };
  const offsets = (values, name, start, count, pointStart, pointCount) => {
    insist([start, count, pointStart, pointCount].every(integer) && count >= 2 && start + count <= values.count, name, 'invalid offset span');
    insist(values.get(start) === pointStart && values.get(start + count - 1) === pointStart + pointCount, name, 'invalid streamline boundaries');
    for (let i = start + 1; i < start + count; i++) insist(values.get(i) - values.get(i - 1) >= 2, name, 'non-monotonic offsets or streamline with fewer than two points');
  };
  const surface = (mesh, name) => {
    insist(integer(mesh.vertexCount) && mesh.vertexCount > 0 && integer(mesh.triangleCount) && mesh.triangleCount > 0, name, 'invalid surface counts');
    insist((mesh.positionsType ?? 'float32') === 'float32' && (mesh.normalsType ?? 'float32') === 'float32', name, 'surface positions/normals must be float32');
    floatTriples(mesh.positions, mesh.vertexCount, mesh.sha256?.positions);
    floatTriples(mesh.normals, mesh.vertexCount, mesh.sha256?.normals, true);
    insist(['uint16', 'uint32'].includes(mesh.indicesType), name, 'surface indices must be uint16 or uint32');
    const indices = typed(mesh.indices, mesh.indicesType, mesh.triangleCount * 3, mesh.sha256?.indices);
    for (let i = 0; i < indices.count; i++) insist(indices.get(i) < mesh.vertexCount, name, 'surface index out of range');
    if (mesh.sourceVertexCount !== undefined) insist(mesh.sourceVertexCount === mesh.vertexCount, name, 'source surface vertex count was changed');
    if (mesh.sourceTriangleCount !== undefined) insist(mesh.sourceTriangleCount === mesh.triangleCount, name, 'source surface triangle count was changed');
    if (mesh.colors) {
      const colorType = mesh.colorsType ?? 'uint8';
      insist(['uint8', 'float32'].includes(colorType), name, 'unsupported color encoding');
      const colors = typed(mesh.colors, colorType, mesh.vertexCount * 3, mesh.sha256?.colors);
      const max = colorType === 'uint8' ? 255 : 1;
      for (let i = 0; i < colors.count; i++) insist(Number.isFinite(colors.get(i)) && colors.get(i) >= 0 && colors.get(i) <= max, name, 'invalid normalized vertex color');
    }
    if (mesh.labels || mesh.regions) {
      insist(mesh.labels && Array.isArray(mesh.regions) && mesh.regions.length > 0, name, 'parcellation requires labels and regions');
      const labelType = mesh.labelsType ?? 'uint16';
      insist(['uint16', 'uint32'].includes(labelType), name, 'unsupported region label encoding');
      const regionIds = new Set(mesh.regions.map(region => region.id));
      insist(regionIds.size === mesh.regions.length && [...regionIds].every(id => integer(id) && id < 2 ** (types[labelType].bytes * 8)), name, 'invalid or duplicate region IDs');
      for (const region of mesh.regions) insist(typeof region.name === 'string' && region.name.length && /^#[a-f0-9]{6}$/i.test(region.color), name, 'invalid region name/color');
      const labels = typed(mesh.labels, labelType, mesh.vertexCount, mesh.sha256?.labels);
      for (let i = 0; i < labels.count; i++) insist(regionIds.has(labels.get(i)), name, 'surface label has no matching region');
    }
  };

  if (includeOriginals) {
    capture(() => {
      const viewer = json('tract-viewer.json');
      for (const bundle of viewer.bundles) for (const line of bundle.lines) insist(!line.source, 'tract-viewer.json', 'source file provenance leaked');
    });
    capture(() => {
      const glass = json('glass-viewer.json');
      insist(glass.byteOrder === 'little-endian', 'Glass viewer', 'unsupported byte order');
      insist(glass.allStreamlines === true && glass.allOriginalVertices === true && glass.streamlineCount === 10000 && glass.pointCount === 341877, 'Glass viewer', 'must preserve all 10,000 streamlines and 341,877 original points');
      insist(glass.tracts.positionsType === 'float32' && glass.tracts.offsetsType === 'uint32' && glass.tracts.offsetUnits === 'vertices', 'Glass viewer', 'unsupported tract encoding');
      floatTriples(glass.tracts.positions, glass.pointCount);
      const offsetCount = glass.bundles.reduce((n, b) => n + b.offsetCount, 0);
      const values = typed(glass.tracts.offsets, 'uint32', offsetCount);
      let pointTotal = 0, offsetTotal = 0, streamlineTotal = 0;
      for (const bundle of glass.bundles) {
        insist(bundle.pointOffset === pointTotal && bundle.offsetOffset === offsetTotal && bundle.offsetCount === bundle.streamlineCount + 1, bundle.id, 'bundle geometry overlaps or has a gap');
        offsets(values, bundle.id, bundle.offsetOffset, bundle.offsetCount, bundle.pointOffset, bundle.pointCount);
        pointTotal += bundle.pointCount; offsetTotal += bundle.offsetCount; streamlineTotal += bundle.streamlineCount;
      }
      insist(pointTotal === glass.pointCount && streamlineTotal === glass.streamlineCount, 'Glass viewer', 'bundle counts do not match totals');
      surface(glass.brain, 'Glass brain');
    });
    capture(() => {
      const centroids = json('tract-centroids.json');
      insist(centroids.bundles.length === 5, 'Legacy centroids', 'expected one centroid per original reconstruction');
      for (const bundle of centroids.bundles) {
        insist(['af', 'cst', 'cc'].includes(bundle.group), bundle.id, 'invalid original centroid group');
        centroid(bundle.points, bundle.id, bundle.pointCount, 1.1);
      }
    });
  }

  if (requireAtlas && (!atlas || !fs.existsSync(localPath(atlas)))) fail('Pathway atlas', 'required manifest is missing');
  if (atlas && fs.existsSync(localPath(atlas))) capture(() => {
    const manifest = json(atlas);
    insist(manifest.schemaVersion === 1 && manifest.registrationVerified === true, atlas, 'atlas must have a supported schema and verified common-space registration');
    insist(manifest.byteOrder === 'little-endian', atlas, 'atlas byte order must be explicit');
    insist(typeof manifest.coordinateSystem === 'string' && manifest.coordinateSystem.includes('RAS'), atlas, 'atlas must describe its shared RAS coordinates');
    insist(Array.isArray(manifest.bundles) && Array.isArray(manifest.surfaces), atlas, 'atlas must list bundles and surfaces');
    insist(manifest.bundles.length + manifest.surfaces.length > 0, atlas, 'atlas has no geometry');
    const ids = new Set();
    for (const bundle of manifest.bundles) capture(() => {
      insist(typeof bundle.id === 'string' && /^[a-z0-9-]+$/.test(bundle.id) && !ids.has(bundle.id), atlas, 'invalid or duplicate bundle ID'); ids.add(bundle.id);
      insist(integer(bundle.streamlineCount) && bundle.streamlineCount > 0 && integer(bundle.pointCount) && bundle.pointCount >= bundle.streamlineCount * 2, bundle.id, 'invalid tract counts');
      insist(bundle.allStreamlines === true && bundle.allOriginalVertices === true && bundle.sourceStreamlineCount === bundle.streamlineCount && bundle.sourcePointCount === bundle.pointCount, bundle.id, 'all original streamlines and points must be retained');
      insist((bundle.positionsType ?? manifest.positionsType) === 'float32' && (bundle.offsetsType ?? manifest.offsetsType) === 'uint32', bundle.id, 'unsupported tract encoding');
      insist(['TractSeg', 'BrainstemSeg'].includes(bundle.generator) && typeof bundle.sourceName === 'string' && bundle.sourceName.length > 0, bundle.id, 'missing tract selection metadata');
      if (bundle.generator === 'TractSeg') insist(!/^(?:CC(?:\.|$)|T_|ST_)/i.test(bundle.sourceName), bundle.id, 'excluded whole-callosal, thalamic, or striatal TractSeg family');
      floatTriples(bundle.positions, bundle.pointCount, bundle.sha256?.positions);
      const values = typed(bundle.offsets, 'uint32', bundle.streamlineCount + 1, bundle.sha256?.offsets);
      offsets(values, bundle.id, 0, bundle.streamlineCount + 1, 0, bundle.pointCount);
      centroid(bundle.centroid, bundle.id);
    });
    const surfaceIds = new Set();
    for (const mesh of manifest.surfaces) capture(() => {
      insist(typeof mesh.id === 'string' && !surfaceIds.has(mesh.id), atlas, 'invalid or duplicate surface ID'); surfaceIds.add(mesh.id);
      insist(mesh.kind === 'cortex' && ['left', 'right'].includes(mesh.hemisphere), mesh.id, 'invalid cortical surface hemisphere');
      insist(mesh.allOriginalVertices === true && mesh.sourceVertexCount === mesh.vertexCount && mesh.sourceTriangleCount === mesh.triangleCount, mesh.id, 'cortical mesh must retain its original resolution');
      surface(mesh, mesh.id);
    });
  });
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.find(arg => !arg.startsWith('--')) || 'public/assets';
  const atlasOnly = args.includes('--atlas-only');
  const errors = checkViewerAssets(root, { includeOriginals: !atlasOnly, requireAtlas: atlasOnly });
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Verified viewer geometry, original streamline preservation, and public metadata in ${root}.`);
}
