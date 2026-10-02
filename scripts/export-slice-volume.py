#!/usr/bin/env python3
"""Prepare a subject-matched, brain-extracted T1 for orthogonal browser slices.

Offline only; requires numpy, scipy, nibabel and matplotlib. Pass private paths
and the previously reviewed rigid registration/normalization in --config. The
public output contains display intensities and normalized coordinates only.
The source brain is sampled onto an axis-aligned native-diffusion RAS grid at
1 mm, preserving the acquisition's nominal resolution. This does not increase
the diffusion acquisition's resolution or correct its residual EPI distortion.

Usage: export-slice-volume.py --config PRIVATE.json --output public/assets
       --audit PRIVATE.json --qa PRIVATE.png
"""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from nibabel.affines import apply_affine
from scipy.ndimage import affine_transform, map_coordinates


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_positions(path):
    raw = path.read_bytes()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 3)


def surface_contours(points, faces, axis, level, plane_axes):
    triangles = points[faces]
    distances = triangles[:, :, axis] - level
    crosses = (distances.min(axis=1) < 0) & (distances.max(axis=1) > 0)
    triangles, distances = triangles[crosses], distances[crosses]
    hits = np.full((len(triangles), 3, 2), np.nan)
    for edge, (a, b) in enumerate(((0, 1), (1, 2), (2, 0))):
        valid = distances[:, a] * distances[:, b] < 0
        fraction = -distances[valid, a] / (distances[valid, b] - distances[valid, a])
        crossing = triangles[valid, a] + fraction[:, None] * (triangles[valid, b] - triangles[valid, a])
        hits[valid, edge] = crossing[:, plane_axes]
    result = [row[np.isfinite(row).all(axis=1)] for row in hits]
    return [row for row in result if len(row) == 2]


def write_qa(path, data, origin, spacing, surfaces, original, offsets, bundles):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection

    native_surfaces = [(apply_affine(np.linalg.inv(origin), points), faces) for points, faces in surfaces]
    native_tracks = apply_affine(np.linalg.inv(origin), original)
    fig, axes = plt.subplots(3, 3, figsize=(13, 12), facecolor='#0c1014')
    levels = ((0, 'Sagittal', (-34, -2, 32)), (1, 'Coronal', (0, 35, 70)), (2, 'Axial', (0, 35, 65)))
    for row, (axis, name, positions_mm) in enumerate(levels):
        plane_axes = tuple(i for i in range(3) if i != axis)
        for col, position_mm in enumerate(positions_mm):
            level = int(round((position_mm - origin[axis, 3]) / spacing))
            ax = axes[row, col]
            ax.imshow(np.take(data, level, axis=axis).T, origin='lower', cmap='gray', vmin=0, vmax=255)
            for points, faces in native_surfaces:
                contours = surface_contours(points, faces, axis, level, plane_axes)
                if contours:
                    ax.add_collection(LineCollection(contours, colors='#63e5df', linewidths=.35, alpha=.65))
            for bundle in bundles:
                segment_list = []
                start = bundle['offsetOffset']
                for streamline in range(start, start + bundle['streamlineCount']):
                    points = native_tracks[offsets[streamline]:offsets[streamline + 1]]
                    a, b = points[:-1], points[1:]
                    delta = b[:, axis] - a[:, axis]
                    lo, hi = level - .5, level + .5
                    t0 = np.zeros(len(a)); t1 = np.ones(len(a))
                    changing = np.abs(delta) > 1e-12
                    entering = (lo - a[changing, axis]) / delta[changing]
                    leaving = (hi - a[changing, axis]) / delta[changing]
                    t0[changing] = np.maximum(0, np.minimum(entering, leaving))
                    t1[changing] = np.minimum(1, np.maximum(entering, leaving))
                    valid = (t0 <= t1) & (changing | ((a[:, axis] >= lo) & (a[:, axis] <= hi)))
                    if np.any(valid):
                        clipped_a = a[valid] + t0[valid, None] * (b[valid] - a[valid])
                        clipped_b = a[valid] + t1[valid, None] * (b[valid] - a[valid])
                        segment_list.extend(np.stack((clipped_a[:, plane_axes], clipped_b[:, plane_axes]), axis=1))
                if segment_list:
                    ax.add_collection(LineCollection(segment_list, colors=bundle['color'], linewidths=.5, alpha=.6))
            ax.set_xlim(0, data.shape[plane_axes[0]] - 1)
            ax.set_ylim(0, data.shape[plane_axes[1]] - 1)
            ax.set_title(f'{name} · {position_mm} mm', color='white', fontsize=10)
            ax.axis('off')
    fig.suptitle('Matched T1 on 1-mm native RAS grid\nPublished pial boundaries: cyan · Original pathways: bundle colors · 1-mm slab', color='white', fontsize=14)
    fig.tight_layout(rect=(0, 0, 1, .94))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=155, facecolor=fig.get_facecolor())
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ('config', 'output', 'audit', 'qa'):
        parser.add_argument('--' + argument, required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    if config.get('alignmentReviewed') is not True:
        raise ValueError('A previously reviewed subject-matched registration is required.')
    source = nib.load(config['source'])
    source_data = source.get_fdata(dtype=np.float32)
    if source_data.ndim != 3 or not np.isfinite(source_data).all():
        raise ValueError('Expected a finite 3-D brain-extracted T1.')
    spacing = float(config.get('spacingMm', 1))
    if spacing != 1 or not np.allclose(source.header.get_zooms()[:3], 1, atol=1e-4):
        raise ValueError('This export requires a 1-mm source and output grid.')
    matrix = np.asarray(config['sourceToNativeRAS'], dtype=np.float64)
    if not np.allclose(matrix[:3, :3].T @ matrix[:3, :3], np.eye(3), atol=1e-5) or np.linalg.det(matrix[:3, :3]) < 0:
        raise ValueError('Expected a proper rigid T1-to-native RAS transform.')
    center = np.asarray(config['normalizationCenter'], dtype=np.float64)
    scale = float(config['normalizationScale'])
    if center.shape != (3,) or not np.isfinite(center).all() or not np.isfinite(scale) or scale <= 0:
        raise ValueError('Invalid shared viewer normalization.')
    registration = json.loads(Path(config['registrationValidation']).read_text())
    if not np.allclose(registration['T1ToDiffusionRAS'], matrix, atol=1e-10):
        raise ValueError('Transform differs from the independently validated registration.')
    reconstruction = json.loads(Path(config['reconstructionAudit']).read_text())
    if not reconstruction['registration'].get('rootApprovedForExport'):
        raise ValueError('Existing visual registration review is not approved.')

    source_to_native = matrix @ source.affine
    support = np.argwhere(source_data > 0)
    native_support = apply_affine(source_to_native, support)
    minimum = np.minimum(native_support.min(axis=0), config.get('coverageMinimum', native_support.min(axis=0)))
    maximum = np.maximum(native_support.max(axis=0), config.get('coverageMaximum', native_support.max(axis=0)))
    padding = float(config.get('paddingMm', 4))
    lower = np.floor((minimum - padding) / spacing) * spacing
    upper = np.ceil((maximum + padding) / spacing) * spacing
    dimensions = np.rint((upper - lower) / spacing).astype(int) + 1
    target_affine = np.diag([spacing, spacing, spacing, 1.])
    target_affine[:3, 3] = lower
    target_to_source = np.linalg.inv(source_to_native) @ target_affine
    resampled = affine_transform(source_data, target_to_source[:3, :3], target_to_source[:3, 3],
                                 output_shape=tuple(dimensions), order=1, mode='constant', cval=0, prefilter=False)
    window = np.asarray(config.get('window', [0, 125]), dtype=float)
    if window.shape != (2,) or not window[1] > window[0]:
        raise ValueError('Invalid display intensity window.')
    display = np.rint(255 * np.clip((resampled - window[0]) / (window[1] - window[0]), 0, 1)).astype(np.uint8)
    # Browser indexing: x + nx * (y + ny * z), so x is the fastest dimension.
    raw = display.tobytes(order='F')
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    if gzip.decompress(compressed) != raw or len(compressed) >= 25 * 1024 * 1024:
        raise ValueError('Invalid or excessively large browser asset.')

    public_assets = Path(config['publicAssets'])
    atlas = json.loads((public_assets / 'pathway-atlas.json').read_text())
    surfaces, surface_errors = [], []
    for entry in config.get('surfaceValidation', []):
        if not np.allclose(entry['sourceToNativeRAS'], matrix, atol=1e-10):
            raise ValueError('T1 registration differs from the published cortical registration.')
        points_tkr, faces = nib.freesurfer.read_geometry(entry['path'])
        orig = nib.load(entry['orig'])
        tkr_to_scanner = orig.header.get_vox2ras() @ np.linalg.inv(orig.header.get_vox2ras_tkr())
        expected = apply_affine(matrix @ tkr_to_scanner, points_tkr)
        meta = next(item for item in atlas['surfaces'] if item['id'] == entry['id'])
        published = read_positions(public_assets / meta['positions']).astype(float) * scale + center
        error = float(np.max(np.abs(published - expected)))
        if error > 2e-5:
            raise ValueError('Normalized T1 grid disagrees with the published cortex.')
        surface_errors.append({'id': entry['id'], 'maxNativeCoordinateErrorMm': error})
        surfaces.append((published, faces))

    glass = json.loads((public_assets / 'glass-viewer.json').read_text())
    original = read_positions(public_assets / glass['tracts']['positions']).astype(float) * scale + center
    offsets = np.frombuffer((public_assets / glass['tracts']['offsets']).read_bytes(), dtype='<u4')
    original_voxels = apply_affine(np.linalg.inv(target_affine), original)
    in_grid = np.all((original_voxels >= 0) & (original_voxels <= dimensions - 1), axis=1)
    if not in_grid.all():
        raise ValueError('Target grid crops original pathway vertices.')
    source_at_tracks = apply_affine(np.linalg.inv(source_to_native), original)
    track_intensities = map_coordinates(source_data, source_at_tracks.T, order=1, mode='constant', cval=0)
    # Check several nontrivial voxels and the actual serialized indexing contract.
    sample_voxels = np.array([[5, 9, 11], dimensions // 2, dimensions - 6], dtype=int)
    samples = map_coordinates(source_data, apply_affine(target_to_source, sample_voxels).T, order=1, mode='constant', cval=0)
    interpolation_error = float(np.max(np.abs(samples - resampled[tuple(sample_voxels.T)])))
    if interpolation_error > 1e-4:
        raise ValueError('Output intensity samples do not reproduce source interpolation.')
    reconstructed = np.frombuffer(gzip.decompress(compressed), dtype=np.uint8).reshape(tuple(dimensions), order='F')
    if not np.array_equal(reconstructed, display):
        raise ValueError('Volume storage order is inconsistent.')

    initial_native = center.copy()
    initial_native[0] = 0  # Midline of the native subject coordinate system.
    initial = np.clip(np.rint((initial_native - lower) / spacing).astype(int), 0, dimensions - 1)
    manifest = {
        'schemaVersion': 1,
        'title': 'Matched T1 anatomy',
        'data': 'slice-t1.bin.gz',
        'dataType': 'uint8',
        'compression': 'gzip',
        'storageOrder': 'x-fastest',
        'dimensions': dimensions.tolist(),
        'spacingMm': [spacing] * 3,
        'displayOrigin': ((lower - center) / scale).tolist(),
        'displaySpacing': [spacing / scale] * 3,
        'initialVoxel': initial.tolist(),
        'coordinateSystem': 'Shared normalized native RAS+: x right, y anterior, z superior.',
        'registrationVerified': True,
        'sameSubject': True,
        'brainExtracted': True,
        'sourceResolutionMm': [1, 1, 1],
        'interpolation': 'Trilinear',
        'intensityWindow': {'sourceMinimum': float(window[0]), 'sourceMaximum': float(window[1]), 'outputMinimum': 0, 'outputMaximum': 255},
        'description': 'Brain-extracted T1 anatomy from the same subject, rigidly aligned to the pathways and cortical surfaces and sampled on a 1-mm RAS grid. Grayscale display intensities are windowed to 8 bits. The diffusion scan has 2.5-mm voxels; this T1 grid does not increase pathway resolution.',
        'uncompressedBytes': len(raw),
        'compressedBytes': len(compressed),
        'sha256': hashlib.sha256(compressed).hexdigest(),
    }
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / manifest['data']).write_bytes(compressed)
    (output / 'slice-volume.json').write_text(json.dumps(manifest, indent=2) + '\n')
    write_qa(args.qa, display, target_affine, spacing, surfaces, original, offsets, glass['bundles'])
    audit = {
        'source': config['source'], 'sourceSha256': sha256(config['source']),
        'sourceAffine': source.affine.tolist(), 'sourceToNativeRAS': matrix.tolist(),
        'sourceToNativeVoxelAffine': source_to_native.tolist(), 'outputVoxelToNativeRAS': target_affine.tolist(),
        'outputVoxelToSourceVoxel': target_to_source.tolist(),
        'normalizationCenter': center.tolist(), 'normalizationScale': scale,
        'registrationValidation': registration, 'existingRegistrationVisualReview': reconstruction['registration']['visualReview'],
        'surfaceRegistrationChecks': surface_errors,
        'originalPathwayPointsInGridPercent': float(100 * in_grid.mean()),
        'originalPathwayPointsInT1SupportPercent': float(100 * (track_intensities > 0).mean()),
        'intensityInterpolationMaxError': interpolation_error,
        'losslessCompressionRoundTrip': True, 'xFastestStorageVerified': True,
        'sourceNonzeroRange': [float(source_data[source_data > 0].min()), float(source_data.max())],
        'displayWindowClippedSourceNonzeroPercent': float(100 * (source_data[source_data > 0] > window[1]).mean()),
        'dimensions': dimensions.tolist(), 'manifest': manifest,
        'qaImage': str(Path(args.qa)), 'qaSha256': sha256(args.qa), 'visualReview': 'Pending image inspection',
    }
    Path(args.audit).parent.mkdir(parents=True, exist_ok=True)
    Path(args.audit).write_text(json.dumps(audit, indent=2) + '\n')
    print(json.dumps({'dimensions': dimensions.tolist(), 'compressedBytes': len(compressed), 'displayOrigin': manifest['displayOrigin'],
                      'displaySpacing': manifest['displaySpacing'], 'surfaceRegistrationChecks': surface_errors,
                      'originalPathwayPointsInT1SupportPercent': audit['originalPathwayPointsInT1SupportPercent'], 'qa': args.qa}, indent=2))


if __name__ == '__main__':
    main()
