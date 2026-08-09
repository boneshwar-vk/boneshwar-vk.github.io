#!/usr/bin/env python3
"""Build public/models/pmhc.glb from assets/3MRP.cif.

Chain A -> HLA-A*0201 heavy chain   (cartoon)
Chain B -> beta-2-microglobulin     (simplified cartoon)
Chain P -> MART-1 decapeptide       (ball-and-stick)
"""
import json
import sys
from pathlib import Path
from collections import OrderedDict, defaultdict

import numpy as np

from cif import read_cif, table_dicts
from glb import GLBBuilder
from mesh import cylinders_mesh, merge, ribbon_mesh, spheres_mesh, _norm

CIF = str(Path(__file__).resolve().parents[2] / 'assets' / '3MRP.cif')
OUT = str(Path(__file__).resolve().parents[1] / 'build' / 'pmhc_raw.glb')

CHAINS = {'A': 'HLA', 'B': 'B2M', 'P': 'Peptide'}

# Colours are sensible bakes; the viewer overrides them per site theme.
COL = {
    'HLA':      (0.286, 0.478, 0.470),   # muted teal
    'B2M':      (0.494, 0.545, 0.561),   # cool grey
    'PEPTIDE_C': (0.847, 0.588, 0.310),  # caramel
    'N':        (0.290, 0.443, 0.706),
    'O':        (0.784, 0.325, 0.290),
    'S':        (0.847, 0.714, 0.290),
    'BOND':     (0.639, 0.435, 0.220),
}

COVALENT = {'C': 0.76, 'N': 0.71, 'O': 0.66, 'S': 1.05}
BALL_R = {'C': 0.30, 'N': 0.29, 'O': 0.29, 'S': 0.36}


# ------------------------------------------------------------------ parsing
def load():
    t = read_cif(CIF)
    atoms = [a for a in table_dicts(t, '_atom_site')
             if a['group_PDB'] == 'ATOM'
             and a['label_alt_id'] in ('.', 'A')
             and a['type_symbol'] != 'H']

    # secondary structure keyed by (auth chain, auth seq)
    ss = {}
    for h in table_dicts(t, '_struct_conf'):
        if not h['conf_type_id'].startswith('HELX'):
            continue
        ch = h['beg_auth_asym_id']
        for r in range(int(h['beg_auth_seq_id']), int(h['end_auth_seq_id']) + 1):
            ss[(ch, r)] = 'H'
    for s in table_dicts(t, '_struct_sheet_range'):
        ch = s['beg_auth_asym_id']
        for r in range(int(s['beg_auth_seq_id']), int(s['end_auth_seq_id']) + 1):
            ss.setdefault((ch, r), 'S')
    return atoms, ss


def backbone_segments(atoms, chain, ss):
    """Group a chain into continuous CA traces, breaking at gaps > 4.5 A."""
    res = OrderedDict()
    for a in atoms:
        if a['auth_asym_id'] != chain:
            continue
        key = int(a['auth_seq_id'])
        res.setdefault(key, {})[a['label_atom_id']] = (
            float(a['Cartn_x']), float(a['Cartn_y']), float(a['Cartn_z']))

    ca, ox, code, nums = [], [], [], []
    for num in sorted(res):
        r = res[num]
        if 'CA' not in r:
            continue
        ca.append(r['CA'])
        ox.append(r.get('O', r.get('C', r['CA'])))
        code.append(ss.get((chain, num), 'C'))
        nums.append(num)
    ca, ox = np.array(ca), np.array(ox)

    segs, start = [], 0
    for i in range(1, len(ca)):
        if np.linalg.norm(ca[i] - ca[i - 1]) > 4.5:
            segs.append(slice(start, i))
            start = i
    segs.append(slice(start, len(ca)))
    return [{'ca': ca[s], 'ox': ox[s], 'ss': code[s], 'nums': nums[s]}
            for s in segs if (s.stop - s.start) >= 2]


def peptide_atoms(atoms, chain='P'):
    out = []
    for a in atoms:
        if a['auth_asym_id'] != chain:
            continue
        out.append({
            'el': a['type_symbol'],
            'name': a['label_atom_id'],
            'res': int(a['auth_seq_id']),
            'comp': a['label_comp_id'],
            'xyz': np.array([float(a['Cartn_x']), float(a['Cartn_y']), float(a['Cartn_z'])]),
        })
    return out


def find_bonds(pa):
    xyz = np.array([a['xyz'] for a in pa])
    els = [a['el'] for a in pa]
    res = [a['res'] for a in pa]
    names = [a['name'] for a in pa]
    bonds = []
    n = len(pa)
    for i in range(n):
        for j in range(i + 1, n):
            if abs(res[i] - res[j]) > 1:
                continue
            # only the C->N peptide link may cross residues
            if res[i] != res[j]:
                pair = {names[i], names[j]}
                if pair != {'C', 'N'}:
                    continue
            d = np.linalg.norm(xyz[i] - xyz[j])
            lim = COVALENT.get(els[i], 0.8) + COVALENT.get(els[j], 0.8) + 0.35
            if d < lim:
                bonds.append((i, j))
    return bonds


# -------------------------------------------------------------- orientation
def canonical_transform(atoms, pa):
    """Stand the complex up: groove above beta2M, peptide long axis along X."""
    allxyz = np.array([[float(a['Cartn_x']), float(a['Cartn_y']), float(a['Cartn_z'])]
                       for a in atoms])
    b2m = np.array([[float(a['Cartn_x']), float(a['Cartn_y']), float(a['Cartn_z'])]
                    for a in atoms if a['auth_asym_id'] == 'B'])
    pep = np.array([a['xyz'] for a in pa])

    up = _norm((pep.mean(axis=0) - b2m.mean(axis=0))[None, :])[0]

    centred = pep - pep.mean(axis=0)
    long_axis = np.linalg.svd(centred, full_matrices=False)[2][0]
    x = long_axis - up * np.dot(long_axis, up)
    x = _norm(x[None, :])[0]
    z = np.cross(x, up)

    R = np.stack([x, up, z])            # world = R @ (p - centre)
    centre = allxyz.mean(axis=0)
    rotated = (allxyz - centre) @ R.T
    extent = rotated.max(axis=0) - rotated.min(axis=0)
    scale = 2.0 / float(extent.max())
    offset = rotated.mean(axis=0)
    return lambda p: ((np.atleast_2d(p) - centre) @ R.T - offset) * scale, scale


# -------------------------------------------------------------------- build
def main():
    atoms, ss = load()
    pa = peptide_atoms(atoms)
    xform, scale = canonical_transform(atoms, pa)

    b = GLBBuilder()
    mat_hla = b.material('hla', COL['HLA'], roughness=0.52)
    mat_b2m = b.material('b2m', COL['B2M'], roughness=0.62)
    mat_pep_c = b.material('peptide-carbon', COL['PEPTIDE_C'], roughness=0.30)
    mat_n = b.material('peptide-nitrogen', COL['N'], roughness=0.30)
    mat_o = b.material('peptide-oxygen', COL['O'], roughness=0.30)
    mat_s = b.material('peptide-sulfur', COL['S'], roughness=0.30)
    mat_bond = b.material('peptide-bond', COL['BOND'], roughness=0.38)

    stats = {}

    # --- HLA heavy chain: full-detail cartoon
    segs = backbone_segments(atoms, 'A', ss)
    for s in segs:
        s['ca'], s['ox'] = xform(s['ca']), xform(s['ox'])
    P, N, I = ribbon_mesh(segs, ring_pts=10, subdiv=6, scale=scale)
    P, N = P * 1.0, _norm(N)
    b.add_node('HLA', [(P, N, I, mat_hla)])
    stats['HLA'] = {'verts': len(P), 'tris': len(I) // 3,
                    'residues': sum(len(s['ca']) for s in segs)}

    # --- beta2-microglobulin: simplified cartoon (coarser rings, fewer samples)
    segs_b = backbone_segments(atoms, 'B', ss)
    for s in segs_b:
        s['ca'], s['ox'] = xform(s['ca']), xform(s['ox'])
    Pb, Nb, Ib = ribbon_mesh(segs_b, ring_pts=8, subdiv=4, scale=scale)
    b.add_node('B2M', [(Pb, _norm(Nb), Ib, mat_b2m)])
    stats['B2M'] = {'verts': len(Pb), 'tris': len(Ib) // 3,
                    'residues': sum(len(s['ca']) for s in segs_b)}

    # --- peptide: ball-and-stick, split by element so carbons stay themeable
    sub = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    by_el = defaultdict(list)
    for a in pa:
        by_el[a['el'] if a['el'] in BALL_R else 'C'].append(a)

    prims = []
    for el, mat in (('C', mat_pep_c), ('N', mat_n), ('O', mat_o), ('S', mat_s)):
        group = by_el.get(el, [])
        if not group:
            continue
        centres = xform(np.array([a['xyz'] for a in group]))
        radii = np.full(len(group), BALL_R[el] * scale)
        prims.append(spheres_mesh(centres, radii, subdiv=sub) + (mat,))

    bonds = find_bonds(pa)
    allc = xform(np.array([a['xyz'] for a in pa]))
    starts = np.array([allc[i] for i, _ in bonds])
    ends = np.array([allc[j] for _, j in bonds])
    prims.append(cylinders_mesh(starts, ends, 0.135 * scale, segs=8) + (mat_bond,))

    b.add_node('Peptide', prims)
    stats['Peptide'] = {
        'verts': sum(len(p[0]) for p in prims),
        'tris': sum(len(p[2]) for p in prims) // 3,
        'atoms': len(pa), 'bonds': len(bonds), 'sphere_subdiv': sub,
    }

    # centre of the peptide, so the viewer can aim at it without guessing
    pep_centre = allc.mean(axis=0).tolist()
    pep_bounds = [allc.min(axis=0).tolist(), allc.max(axis=0).tolist()]

    size = b.write(OUT, extras={
        'pdb': '3MRP',
        'title': 'HLA-A*0201 / beta-2-microglobulin / MART-1 decapeptide ELAGLGINTV',
        'peptideCenter': pep_centre,
        'peptideBounds': pep_bounds,
        'sourceScale': scale,
    })
    stats['glb_bytes'] = size
    stats['peptideCenter'] = pep_centre
    print(json.dumps(stats, indent=2))


if __name__ == '__main__':
    main()
