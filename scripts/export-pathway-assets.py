#!/usr/bin/env python3
"""Export reviewed subject-matched geometry without thinning or spatial resampling.

This is an offline asset-preparation utility, not part of the web build. Its JSON
config and raw imaging stay private. The config supplies the known shared RAS
normalization and explicit, reviewed source-to-native RAS matrices. Bundle
coordinates are converted once; FreeSurfer vertices first pass from tkregister
RAS to scanner RAS using the subject's orig.mgz header. Gzip is lossless.

Requires numpy and nibabel. Run with --config PRIVATE.json --output DIR
--audit PRIVATE.json. The output must be reviewed before publication.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re

import nibabel as nib
import numpy as np
from nibabel.affines import apply_affine


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_array(root, name, values, dtype):
    data = np.ascontiguousarray(values, dtype=np.dtype(dtype)).tobytes()
    compressed = gzip.compress(data, compresslevel=9, mtime=0)
    (root / name).write_bytes(compressed)
    if gzip.decompress(compressed) != data:
        raise ValueError('Lossless compression round trip failed: ' + name)
    if len(compressed) >= 25 * 1024 * 1024:
        raise ValueError('Split asset before publishing; browser upload too large: ' + name)
    return len(compressed), hashlib.sha256(compressed).hexdigest()


def mean_trajectory(streamlines, samples=80):
    """A summary only: source trajectories are never resampled for rendering."""
    sampled = []
    for points in streamlines:
        distance = np.r_[0., np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
        good = np.r_[True, np.diff(distance) > 0]
        if distance[-1] <= 0:
            continue
        d = np.linspace(0, distance[-1], samples)
        sampled.append(np.column_stack([np.interp(d, distance[good], points[good, axis]) for axis in range(3)]))
    if not sampled:
        raise ValueError('No nondegenerate trajectories for centroid')
    sampled = np.asarray(sampled)
    ref = sampled[0]
    forward = np.linalg.norm(sampled[:, 0] - ref[0], axis=1) + np.linalg.norm(sampled[:, -1] - ref[-1], axis=1)
    reverse = np.linalg.norm(sampled[:, 0] - ref[-1], axis=1) + np.linalg.norm(sampled[:, -1] - ref[0], axis=1)
    sampled[reverse < forward] = sampled[reverse < forward, ::-1]
    return sampled.mean(axis=0).tolist()


def vertex_normals(points, faces):
    normals = np.zeros_like(points, dtype=np.float64)
    tri = points[faces]
    face_normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for corner in range(3):
        np.add.at(normals, faces[:, corner], face_normals)
    lengths = np.linalg.norm(normals, axis=1)
    if np.any(lengths == 0):
        raise ValueError('Surface has undefined vertex normals')
    return normals / lengths[:, None]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--audit', required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    if config.get('alignmentReviewed') is not True:
        raise ValueError('Review anatomical registration before exporting a publishable atlas')
    center = np.asarray(config['normalizationCenter'], dtype=np.float64)
    scale = float(config['normalizationScale'])
    if center.shape != (3,) or not np.isfinite(center).all() or scale <= 0:
        raise ValueError('Invalid shared normalization')
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'schemaVersion': 1, 'byteOrder': 'little-endian',
                'coordinateSystem': 'Shared normalized native RAS+: x right, y anterior, z superior.',
                'registrationVerified': True, 'positionsType': 'float32', 'offsetsType': 'uint32',
                'atlasName': 'White matter pathways and cortical anatomy',
                'atlasDescription': 'Additional reconstructions from the same anatomy, loaded only when selected.',
                'bundles': [], 'surfaces': []}
    audit = {'normalizationCenter': center.tolist(), 'normalizationScale': scale,
             'alignmentEvidence': config.get('alignmentEvidence', {}), 'bundles': [], 'surfaces': [], 'emptyBundles': []}
    ids = {'af', 'cst', 'cc'}
    for entry in config.get('bundles', []):
        key = entry['id']
        if not re.fullmatch('[a-z0-9-]+', key) or key in ids:
            raise ValueError('Unsafe or duplicate geometry id: ' + key)
        ids.add(key)
        path = Path(entry['path'])
        tracks = nib.streamlines.load(str(path)).tractogram
        tracks.to_world()
        matrix = np.asarray(entry.get('sourceToNativeRAS', np.eye(4).tolist()), dtype=np.float64)
        source_count = len(tracks.streamlines)
        if not source_count:
            audit['emptyBundles'].append({'source': str(path), 'sourceName': entry['sourceName'], 'sha256': digest(path)})
            continue
        transformed = [apply_affine(matrix, s) for s in tracks.streamlines]
        if any(len(s) < 2 for s in transformed):
            raise ValueError('Degenerate source trajectory: ' + key)
        lengths = np.asarray([len(s) for s in transformed], dtype=np.uint64)
        if lengths.sum() >= 2 ** 32:
            raise ValueError('Too many vertices for uint32 offsets')
        native = np.concatenate(transformed)
        if not np.isfinite(native).all():
            raise ValueError('Nonfinite trajectory: ' + key)
        positions = ((native - center) / scale).astype('<f4')
        if np.max(np.abs(positions)) > 2.5:
            raise ValueError('Trajectory outside expected subject coordinates: ' + key)
        offsets = np.r_[0, lengths.cumsum()].astype('<u4')
        position_name, offset_name = key + '-positions.bin.gz', key + '-offsets.bin.gz'
        pbytes, phash = write_array(output, position_name, positions, '<f4')
        obytes, ohash = write_array(output, offset_name, offsets, '<u4')
        normalized = [(s - center) / scale for s in transformed]
        meta = {k: entry[k] for k in ('id', 'name', 'color', 'group', 'sourceName', 'generator')}
        meta.update(positions=position_name, offsets=offset_name, positionsType='float32', offsetsType='uint32',
                    streamlineCount=source_count, pointCount=int(lengths.sum()),
                    sourceStreamlineCount=source_count, sourcePointCount=int(lengths.sum()),
                    allStreamlines=True, allOriginalVertices=True, centroid=mean_trajectory(normalized),
                    compressedBytes=pbytes + obytes, sha256={'positions': phash, 'offsets': ohash})
        manifest['bundles'].append(meta)
        audit['bundles'].append({'id': key, 'source': str(path), 'sourceSha256': digest(path),
                                 'sourceToNativeRAS': matrix.tolist(), 'count': source_count,
                                 'pointCount': int(lengths.sum()), 'nativeMinimum': native.min(axis=0).tolist(),
                                 'nativeMaximum': native.max(axis=0).tolist()})
    for entry in config.get('surfaces', []):
        key = entry['id']
        if not re.fullmatch('[a-z0-9-]+', key) or key in ids:
            raise ValueError('Unsafe or duplicate surface id: ' + key)
        ids.add(key)
        points_tkr, faces = nib.freesurfer.read_geometry(entry['path'])
        orig = nib.load(entry['orig'])
        tkr_to_scanner = orig.header.get_vox2ras() @ np.linalg.inv(orig.header.get_vox2ras_tkr())
        scanner_to_native = np.asarray(entry['sourceToNativeRAS'], dtype=np.float64)
        transform = scanner_to_native @ tkr_to_scanner
        if not np.allclose(transform[:3, :3].T @ transform[:3, :3], np.eye(3), atol=1e-3):
            raise ValueError('Cortical export expects reviewed rigid alignment, not mesh rescaling')
        if np.linalg.det(transform[:3, :3]) < 0:
            faces = faces[:, [0, 2, 1]]  # Preserve outward winding after a handedness change.
        native = apply_affine(transform, points_tkr)
        points = (native - center) / scale
        if not np.isfinite(points).all() or np.max(np.abs(points)) > 2.5:
            raise ValueError('Surface outside expected subject coordinates: ' + key)
        labels, ctab, names = nib.freesurfer.read_annot(entry['annotation'], orig_ids=False)
        if len(labels) != len(points):
            raise ValueError('Annotation vertex count differs from surface')
        # FreeSurfer uses -1 for unknown vertices. Reserve label 0 for unknown,
        # and shift every stored annotation-table index by one consistently.
        labels = (labels + 1).astype('<u2')
        regions = [{'id': 0, 'name': 'Unassigned', 'color': '#98a1a4'}]
        regions.extend({'id': i + 1, 'name': name.decode('utf-8').replace('-', ' '),
                        'color': '#' + ''.join('{:02x}'.format(int(v)) for v in ctab[i, :3])}
                       for i, name in enumerate(names))
        meta = {k: entry[k] for k in ('id', 'name', 'hemisphere')}
        meta.update(kind='cortex', vertexCount=len(points), triangleCount=len(faces),
                    sourceVertexCount=len(points), sourceTriangleCount=len(faces),
                    allOriginalVertices=True, positionsType='float32', normalsType='float32',
                    indicesType='uint32', labelsType='uint16', regions=regions,
                    surfaceDescription='Full-resolution FreeSurfer pial surface; vertex coordinates rigidly aligned to the diffusion scan.', sha256={})
        total = 0
        for field, values, dtype in [('positions', points, '<f4'), ('normals', vertex_normals(points, faces), '<f4'),
                                     ('indices', faces, '<u4'), ('labels', labels, '<u2')]:
            name = key + '-' + field + '.bin.gz'
            size, sha = write_array(output, name, values, dtype)
            meta[field] = name
            meta['sha256'][field] = sha
            total += size
        meta['compressedBytes'] = total
        manifest['surfaces'].append(meta)
        audit['surfaces'].append({'id': key, 'source': entry['path'], 'sourceSha256': digest(entry['path']),
                                  'annotation': entry['annotation'], 'annotationSha256': digest(entry['annotation']),
                                  'orig': entry['orig'], 'origSha256': digest(entry['orig']),
                                  'tkregisterToScannerRAS': tkr_to_scanner.tolist(),
                                  'scannerToNativeRAS': scanner_to_native.tolist(),
                                  'vertexCount': len(points), 'triangleCount': len(faces)})
    (output / 'pathway-atlas.json').write_text(json.dumps(manifest, indent=2) + '\n')
    Path(args.audit).write_text(json.dumps(audit, indent=2) + '\n')
    print(json.dumps({'bundles': len(manifest['bundles']), 'surfaces': len(manifest['surfaces']),
                      'streamlines': sum(b['streamlineCount'] for b in manifest['bundles']),
                      'compressedBytes': sum(x['compressedBytes'] for x in manifest['bundles'] + manifest['surfaces']),
                      'emptyBundles': len(audit['emptyBundles'])}))


if __name__ == '__main__':
    main()
