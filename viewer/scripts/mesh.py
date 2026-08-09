"""Cartoon-ribbon and ball-and-stick mesh generation from backbone/atom coordinates."""
import numpy as np

# ---------------------------------------------------------------- primitives


def _norm(v, axis=-1):
    n = np.linalg.norm(v, axis=axis, keepdims=True)
    return v / np.where(n < 1e-9, 1.0, n)


def catmull_rom(points, subdiv):
    """Uniform Catmull-Rom through `points`; returns subdiv samples per segment
    plus the final point."""
    p = np.asarray(points, dtype=np.float64)
    if len(p) < 2:
        return p.copy()
    ext = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    ts = np.linspace(0.0, 1.0, subdiv, endpoint=False)
    t = ts[:, None]
    t2, t3 = t * t, t * t * t
    out = []
    for i in range(len(p) - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        out.append(0.5 * ((2 * p1)
                          + (-p0 + p2) * t
                          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(p[-1][None, :])
    return np.vstack(out)


def _lerp_scalar(vals, subdiv):
    """Piecewise-linear resample matching catmull_rom's sample count."""
    v = np.asarray(vals, dtype=np.float64)
    if len(v) < 2:
        return v.copy()
    ts = np.linspace(0.0, 1.0, subdiv, endpoint=False)
    out = [v[i] + (v[i + 1] - v[i]) * ts for i in range(len(v) - 1)]
    out.append(v[-1:])
    return np.concatenate(out)


def superellipse(n_pts, expo):
    """Unit cross-section ring. expo=2 -> circle, expo=4 -> rounded rectangle."""
    t = np.linspace(0.0, 2 * np.pi, n_pts, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    k = 2.0 / expo
    return np.stack([np.sign(c) * np.abs(c) ** k, np.sign(s) * np.abs(s) ** k], axis=1)


# ---------------------------------------------------------------- ribbon core

# per-residue ribbon profile: (half-width, half-thickness, cross-section exponent)
PROFILE = {
    'H': (1.15, 0.22, 4.0),   # helix   - broad flat ribbon
    'S': (1.05, 0.22, 4.0),   # strand  - broad flat ribbon (arrowhead added later)
    'C': (0.26, 0.26, 2.0),   # coil    - round tube
}


def _reference_frames(ca, ox):
    """Carson-Bugg style side vectors: perpendicular to the peptide plane,
    de-flipped so the ribbon never twists 180 degrees between residues."""
    n = len(ca)
    side = np.zeros((n, 3))
    for i in range(n):
        a = ca[min(i + 1, n - 1)] - ca[max(i - 1, 0)]
        b = ox[i] - ca[i]
        s = np.cross(a, b)
        if np.linalg.norm(s) < 1e-6:
            s = np.cross(a, [0.0, 0.0, 1.0])
        side[i] = s
    side = _norm(side)
    for i in range(1, n):
        if np.dot(side[i], side[i - 1]) < 0:
            side[i] = -side[i]
    return side


def _smooth(points, mask, passes=1):
    """Laplacian smoothing applied only where `mask` is set (flattens beta pleat)."""
    p = points.copy()
    for _ in range(passes):
        q = p.copy()
        for i in range(1, len(p) - 1):
            if mask[i]:
                q[i] = 0.25 * p[i - 1] + 0.5 * p[i] + 0.25 * p[i + 1]
        p = q
    return p


def _strand_arrows(ss):
    """Per-residue width multiplier + taper implementing beta-strand arrowheads."""
    n = len(ss)
    w = np.ones(n)
    i = 0
    while i < n:
        if ss[i] != 'S':
            i += 1
            continue
        j = i
        while j + 1 < n and ss[j + 1] == 'S':
            j += 1
        length = j - i + 1
        if length >= 3:
            w[j - 1] = 1.85          # flare
            w[j] = 0.30              # tip
        i = j + 1
    return w


def ribbon_mesh(segments, ring_pts=10, subdiv=6, scale=1.0):
    """segments: list of dicts with ca (N,3), ox (N,3), ss (N,) chars.

    `scale` converts the Angstrom-valued PROFILE widths into whatever units the
    control points are already in. The control points get scaled upstream to fit
    a unit-ish box, so the cross-section has to follow or the ribbon comes out
    as wide as the whole molecule.

    Returns (positions, normals, indices)."""
    P, N, I = [], [], []
    base = 0
    for seg in segments:
        ca, ox, ss = seg['ca'], seg['ox'], seg['ss']
        if len(ca) < 2:
            continue
        smooth_mask = np.array([c == 'S' for c in ss])
        ctrl = _smooth(ca, smooth_mask, passes=2)

        widths = np.array([PROFILE[c][0] for c in ss]) * _strand_arrows(ss) * scale
        thicks = np.array([PROFILE[c][1] for c in ss]) * scale
        expos = np.array([PROFILE[c][2] for c in ss])

        side = _reference_frames(ca, ox)

        pts = catmull_rom(ctrl, subdiv)
        sides = catmull_rom(side, subdiv)
        w = _lerp_scalar(widths, subdiv)
        th = _lerp_scalar(thicks, subdiv)
        ex = _lerp_scalar(expos, subdiv)

        # tangents by central difference
        tan = np.zeros_like(pts)
        tan[1:-1] = pts[2:] - pts[:-2]
        tan[0] = pts[1] - pts[0]
        tan[-1] = pts[-1] - pts[-2]
        tan = _norm(tan)

        # orthonormalise the interpolated side vector against the tangent
        s = sides - tan * np.sum(sides * tan, axis=1, keepdims=True)
        s = _norm(s)
        up = _norm(np.cross(tan, s))

        m = len(pts)
        verts = np.zeros((m, ring_pts, 3))
        norms = np.zeros((m, ring_pts, 3))
        for k in range(m):
            ring = superellipse(ring_pts, ex[k])
            off = ring[:, 0:1] * w[k] * s[k] + ring[:, 1:2] * th[k] * up[k]
            verts[k] = pts[k] + off
            # analytic-ish normal: gradient of the scaled cross-section
            gx = ring[:, 0:1] / max(w[k], 1e-4)
            gy = ring[:, 1:2] / max(th[k], 1e-4)
            nk = gx * s[k] + gy * up[k]
            norms[k] = _norm(nk)

        P.append(verts.reshape(-1, 3))
        N.append(norms.reshape(-1, 3))

        idx = []
        for k in range(m - 1):
            a0 = base + k * ring_pts
            b0 = base + (k + 1) * ring_pts
            for r in range(ring_pts):
                r2 = (r + 1) % ring_pts
                idx += [a0 + r, b0 + r, b0 + r2, a0 + r, b0 + r2, a0 + r2]
        # flat end caps
        for cap, flip in ((0, True), (m - 1, False)):
            c0 = base + cap * ring_pts
            for r in range(1, ring_pts - 1):
                tri = [c0, c0 + r, c0 + r + 1]
                idx += tri[::-1] if flip else tri
        I.append(np.array(idx, dtype=np.uint32))
        base += m * ring_pts

    if not P:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0,), dtype=np.uint32)
    return np.vstack(P), np.vstack(N), np.concatenate(I)


# ------------------------------------------------------- ball-and-stick core


def icosphere(subdiv):
    t = (1.0 + 5.0 ** 0.5) / 2.0
    v = np.array([
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ], dtype=np.float64)
    f = np.array([
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ], dtype=np.int64)
    v = _norm(v)
    for _ in range(subdiv):
        cache, nv, nf = {}, list(v), []

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                cache[key] = len(nv)
                nv.append(_norm((nv[a] + nv[b])[None, :])[0])
            return cache[key]

        for a, b, c in f:
            ab, bc, ca_ = mid(a, b), mid(b, c), mid(c, a)
            nf += [[a, ab, ca_], [b, bc, ab], [c, ca_, bc], [ab, bc, ca_]]
        v, f = np.array(nv), np.array(nf, dtype=np.int64)
    return v, f


_UNIT_SPHERE = {}


def spheres_mesh(centers, radii, subdiv=2):
    key = subdiv
    if key not in _UNIT_SPHERE:
        _UNIT_SPHERE[key] = icosphere(subdiv)
    uv, uf = _UNIT_SPHERE[key]
    n = len(centers)
    if n == 0:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0,), dtype=np.uint32)
    P = (uv[None, :, :] * np.asarray(radii)[:, None, None]) + np.asarray(centers)[:, None, :]
    N = np.repeat(uv[None, :, :], n, axis=0)
    off = (np.arange(n) * len(uv))[:, None, None]
    I = (uf[None, :, :] + off).reshape(-1)
    return P.reshape(-1, 3), N.reshape(-1, 3), I.astype(np.uint32)


def cylinders_mesh(starts, ends, radius, segs=8):
    starts, ends = np.asarray(starts), np.asarray(ends)
    n = len(starts)
    if n == 0:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0,), dtype=np.uint32)
    axis = ends - starts
    length = np.linalg.norm(axis, axis=1, keepdims=True)
    z = axis / np.where(length < 1e-9, 1.0, length)
    ref = np.tile([0.0, 0.0, 1.0], (n, 1))
    flip = np.abs(z[:, 2]) > 0.9
    ref[flip] = [1.0, 0.0, 0.0]
    x = _norm(np.cross(z, ref))
    y = _norm(np.cross(z, x))

    th = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    c, s = np.cos(th)[None, :, None], np.sin(th)[None, :, None]
    radial = c * x[:, None, :] + s * y[:, None, :]          # (n, segs, 3)
    bottom = starts[:, None, :] + radial * radius
    top = ends[:, None, :] + radial * radius
    P = np.concatenate([bottom, top], axis=1)               # (n, 2*segs, 3)
    N = np.concatenate([radial, radial], axis=1)

    idx = []
    for r in range(segs):
        r2 = (r + 1) % segs
        idx += [r, segs + r, segs + r2, r, segs + r2, r2]
    idx = np.array(idx, dtype=np.int64)
    off = (np.arange(n) * 2 * segs)[:, None]
    I = (idx[None, :] + off).reshape(-1)
    return P.reshape(-1, 3), N.reshape(-1, 3), I.astype(np.uint32)


def merge(parts):
    """parts: list of (P, N, I) -> single (P, N, I)."""
    P, N, I, base = [], [], [], 0
    for p, nn, i in parts:
        if len(p) == 0:
            continue
        P.append(p)
        N.append(nn)
        I.append(i + base)
        base += len(p)
    if not P:
        return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0,), dtype=np.uint32)
    return np.vstack(P), np.vstack(N), np.concatenate(I).astype(np.uint32)
