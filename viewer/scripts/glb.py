"""Minimal glTF 2.0 / GLB writer for indexed triangle meshes with PBR materials."""
import json
import struct

import numpy as np

FLOAT, USHORT, UINT = 5126, 5123, 5125
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963


class GLBBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.buffer_views = []
        self.accessors = []
        self.materials = []
        self.meshes = []
        self.nodes = []

    # -- low level ---------------------------------------------------------
    def _pad(self):
        while len(self.bin) % 4:
            self.bin.append(0)

    def _view(self, data: bytes, target=None):
        self._pad()
        off = len(self.bin)
        self.bin.extend(data)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        self.buffer_views.append(bv)
        return len(self.buffer_views) - 1

    def _accessor(self, view, comp, count, typ, mn=None, mx=None):
        a = {'bufferView': view, 'componentType': comp, 'count': count, 'type': typ}
        if mn is not None:
            a['min'], a['max'] = mn, mx
        self.accessors.append(a)
        return len(self.accessors) - 1

    def add_vec3(self, arr, target=ARRAY_BUFFER):
        a = np.ascontiguousarray(arr, dtype=np.float32)
        v = self._view(a.tobytes(), target)
        return self._accessor(v, FLOAT, len(a), 'VEC3',
                              a.min(axis=0).tolist(), a.max(axis=0).tolist())

    def add_indices(self, idx):
        idx = np.asarray(idx)
        if idx.max(initial=0) < 65535:
            a = np.ascontiguousarray(idx, dtype=np.uint16)
            comp = USHORT
        else:
            a = np.ascontiguousarray(idx, dtype=np.uint32)
            comp = UINT
        v = self._view(a.tobytes(), ELEMENT_ARRAY_BUFFER)
        return self._accessor(v, comp, len(a), 'SCALAR')

    # -- high level --------------------------------------------------------
    def material(self, name, color, roughness=0.45, metallic=0.0, emissive=None):
        m = {
            'name': name,
            'pbrMetallicRoughness': {
                'baseColorFactor': list(color) + ([1.0] if len(color) == 3 else []),
                'metallicFactor': metallic,
                'roughnessFactor': roughness,
            },
            'doubleSided': False,
        }
        if emissive:
            m['emissiveFactor'] = list(emissive)
        self.materials.append(m)
        return len(self.materials) - 1

    def add_node(self, name, primitives):
        """primitives: list of (positions, normals, indices, material_index)."""
        prims = []
        for pos, nrm, idx, mat in primitives:
            if len(pos) == 0:
                continue
            prims.append({
                'attributes': {'POSITION': self.add_vec3(pos),
                               'NORMAL': self.add_vec3(nrm)},
                'indices': self.add_indices(idx),
                'material': mat,
                'mode': 4,
            })
        self.meshes.append({'name': name + '_mesh', 'primitives': prims})
        self.nodes.append({'name': name, 'mesh': len(self.meshes) - 1})
        return len(self.nodes) - 1

    def write(self, path, extras=None):
        self._pad()
        gltf = {
            'asset': {'version': '2.0', 'generator': 'pmhc-cartoon-builder'},
            'scene': 0,
            'scenes': [{'name': 'pMHC', 'nodes': list(range(len(self.nodes)))}],
            'nodes': self.nodes,
            'meshes': self.meshes,
            'materials': self.materials,
            'accessors': self.accessors,
            'bufferViews': self.buffer_views,
            'buffers': [{'byteLength': len(self.bin)}],
        }
        if extras:
            gltf['extras'] = extras
        js = json.dumps(gltf, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942))
            f.write(self.bin)
        return total
