import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const triple = (v, test = Number.isFinite) => Array.isArray(v) && v.length === 3 && v.every(test);
const close = (a, b, tolerance = 1e-10) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
const privatePath = /(?:\/Users\/|\/private\/|\/nfs\d*\/|\/home\/|\/valiant\d*\/|[\w.-]+@[\w.-]+:\/|\bsub-[A-Za-z0-9]+\b|\bBMSHC\d+(?:-\d+)?\b)/;
const privateKeys = new Set(['subject', 'subjectId', 'subjectID', 'source', 'sourceFiles', 'localSourceFile', 'sourceIndex', 'normalization', 'normalizationCenter', 'normalizationScale', 'sourceAffine', 'sourceToNativeRAS']);

// Public CI verifies the browser contract. A local --audit also compares the
// published mapping with the independently reviewed private export provenance.
export function checkSliceAssets(assetDirectory, { auditFile } = {}) {
  const errors = [];
  const insist = (condition, message) => { if (!condition) throw new Error(`T1 slices: ${message}`); };
  const privacy = value => {
    if (typeof value === 'string') insist(!privatePath.test(value), 'private source path or subject identifier leaked');
    if (Array.isArray(value)) value.forEach(privacy);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      insist(!privateKeys.has(key), `unnecessary private provenance (${key})`);
      privacy(child);
    }
  };
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'slice-volume.json'), 'utf8'));
    privacy(meta);
    insist(meta.schemaVersion === 1 && meta.registrationVerified === true && meta.sameSubject === true && meta.brainExtracted === true, 'a verified, subject-matched, brain-extracted volume is required');
    insist(meta.dataType === 'uint8' && meta.compression === 'gzip' && meta.storageOrder === 'x-fastest', 'unsupported browser volume encoding');
    insist(triple(meta.dimensions, n => Number.isSafeInteger(n) && n > 1 && n <= 2048), 'invalid dimensions');
    insist(triple(meta.spacingMm, n => n === 1) && triple(meta.sourceResolutionMm, n => n === 1), 'the displayed 1-mm resolution must match the source and output grids');
    insist(triple(meta.displayOrigin) && triple(meta.displaySpacing, n => n > 0 && Number.isFinite(n)), 'invalid normalized RAS mapping');
    insist(meta.displaySpacing.every(n => close(n, meta.displaySpacing[0])), 'isotropic source grid has inconsistent normalized spacing');
    insist(typeof meta.coordinateSystem === 'string' && meta.coordinateSystem.includes('RAS'), 'missing shared RAS coordinate convention');
    insist(triple(meta.initialVoxel, (n, i) => Number.isInteger(n) && n >= 0 && n < meta.dimensions[i]), 'initial crosshair is outside the volume');
    const window = meta.intensityWindow;
    insist(window && Number.isFinite(window.sourceMinimum) && Number.isFinite(window.sourceMaximum) && window.sourceMaximum > window.sourceMinimum && window.outputMinimum === 0 && window.outputMaximum === 255, 'invalid 8-bit display window');
    insist(typeof meta.data === 'string' && /^[\w-]+\.bin\.gz$/.test(meta.data), 'volume must use a relative local binary filename');
    const count = meta.dimensions.reduce((a, b) => a * b, 1);
    insist(Number.isSafeInteger(count) && count <= 128 * 1024 * 1024 && meta.uncompressedBytes === count, 'dimensions do not match the declared volume size');
    const compressed = fs.readFileSync(path.join(assetDirectory, meta.data));
    insist(compressed.length === meta.compressedBytes && compressed.length <= 25 * 1024 * 1024, 'compressed size mismatch or oversized asset');
    insist(compressed[0] === 31 && compressed[1] === 139, 'missing gzip signature');
    insist(typeof meta.sha256 === 'string' && /^[a-f0-9]{64}$/.test(meta.sha256) && createHash('sha256').update(compressed).digest('hex') === meta.sha256, 'compressed volume SHA-256 mismatch');
    const values = gunzipSync(compressed, { maxOutputLength: count });
    insist(values.length === count, 'decoded volume length does not match its dimensions');
    const intensities = new Set(values);
    insist(intensities.has(0) && intensities.has(255) && intensities.size > 128, 'volume lacks the expected grayscale anatomy and empty background');

    const inside = point => triple(point) && point.every((p, i) => {
      const voxel = (p - meta.displayOrigin[i]) / meta.displaySpacing[i];
      return voxel >= -.001 && voxel <= meta.dimensions[i] - 1 + .001;
    });
    const glass = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'glass-viewer.json'), 'utf8'));
    const originalFile = fs.readFileSync(path.join(assetDirectory, glass.tracts.positions));
    const original = originalFile[0] === 31 && originalFile[1] === 139 ? gunzipSync(originalFile) : originalFile;
    insist(original.length === glass.pointCount * 12, 'original pathway coordinate count mismatch');
    for (let offset = 0; offset < original.length; offset += 12) {
      insist(inside([0, 4, 8].map(i => original.readFloatLE(offset + i))), 'volume grid crops an original pathway coordinate');
    }
    const atlas = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'pathway-atlas.json'), 'utf8'));
    for (const bundle of atlas.bundles) insist(bundle.centroid.every(inside), `volume grid crops the ${bundle.id} centroid`);

    if (auditFile) {
      const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
      insist(isDeepStrictEqual(audit.manifest, meta), 'public metadata differs from the reviewed export');
      insist(triple(audit.normalizationCenter) && Number.isFinite(audit.normalizationScale) && audit.normalizationScale > 0, 'invalid private normalization');
      const affine = audit.outputVoxelToNativeRAS;
      insist(Array.isArray(affine) && affine.length === 4 && affine.every(row => Array.isArray(row) && row.length === 4 && row.every(Number.isFinite)), 'invalid output affine');
      for (let axis = 0; axis < 3; axis++) {
        insist(close(meta.displayOrigin[axis], (affine[axis][3] - audit.normalizationCenter[axis]) / audit.normalizationScale), 'display origin disagrees with the shared native registration');
        insist(close(meta.displaySpacing[axis], affine[axis][axis] / audit.normalizationScale), 'display spacing disagrees with the shared native registration');
        for (let other = 0; other < 3; other++) insist(close(affine[axis][other], axis === other ? meta.spacingMm[axis] : 0), 'output voxel grid is not axis-aligned RAS');
      }
      insist(audit.losslessCompressionRoundTrip === true && audit.xFastestStorageVerified === true && audit.intensityInterpolationMaxError <= 1e-4, 'export interpolation/storage verification is incomplete');
      insist(audit.originalPathwayPointsInGridPercent === 100 && audit.surfaceRegistrationChecks?.length === 2 && audit.surfaceRegistrationChecks.every(s => s.maxNativeCoordinateErrorMm < 2e-5), 'export does not match the published pathways and cortex');
      insist(typeof audit.visualReview === 'string' && audit.visualReview.length > 30 && !/pending/i.test(audit.visualReview), 'export visual review is incomplete');
    }
  } catch (error) { errors.push(error.message); }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), auditIndex = args.indexOf('--audit');
  const assetDirectory = args[0] && !args[0].startsWith('--') ? args[0] : 'public/assets';
  const errors = checkSliceAssets(assetDirectory, { auditFile: auditIndex >= 0 ? args[auditIndex + 1] : undefined });
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Verified matched T1 encoding, hash, coordinate coverage, and public metadata in ${assetDirectory}.`);
}
