"""Minimal mmCIF reader: enough of the format to pull atom_site + secondary structure."""
import re


def _tokenize(line):
    """Split a CIF data line into tokens, honouring single/double quotes."""
    out, i, n = [], 0, len(line)
    while i < n:
        c = line[i]
        if c in ' \t':
            i += 1
            continue
        if c in "'\"":
            q = c
            i += 1
            start = i
            # A quote only closes when followed by whitespace or EOL.
            while i < n:
                if line[i] == q and (i + 1 >= n or line[i + 1] in ' \t'):
                    break
                i += 1
            out.append(line[start:i])
            i += 1
        else:
            start = i
            while i < n and line[i] not in ' \t':
                i += 1
            out.append(line[start:i])
    return out


def read_cif(path):
    """Return {category: {'names': [...], 'rows': [[...]]}} for every loop_ block,
    plus single key/value items collapsed into a one-row table."""
    with open(path) as fh:
        raw = fh.read().splitlines()

    # Fold semicolon-delimited multi-line text fields into single tokens.
    lines, i = [], 0
    while i < len(raw):
        line = raw[i]
        if line.startswith(';'):
            buf = [line[1:]]
            i += 1
            while i < len(raw) and not raw[i].startswith(';'):
                buf.append(raw[i])
                i += 1
            i += 1
            lines.append(('TEXT', '\n'.join(buf)))
        else:
            lines.append(('LINE', line))
            i += 1

    tables, i = {}, 0
    while i < len(lines):
        kind, line = lines[i]
        if kind == 'TEXT':
            i += 1
            continue
        s = line.strip()
        if s == 'loop_':
            i += 1
            names = []
            while i < len(lines) and lines[i][0] == 'LINE' and lines[i][1].strip().startswith('_'):
                names.append(lines[i][1].strip())
                i += 1
            cat = names[0].split('.')[0]
            cols = [n.split('.', 1)[1] for n in names]
            rows, pending = [], []
            while i < len(lines):
                k, ln = lines[i]
                if k == 'TEXT':
                    pending.append(ln)
                    i += 1
                else:
                    st = ln.strip()
                    if st.startswith('_') or st == 'loop_' or st.startswith('data_'):
                        break
                    if st == '#':
                        i += 1
                        break
                    pending.extend(_tokenize(st))
                    i += 1
                while len(pending) >= len(cols):
                    rows.append(pending[:len(cols)])
                    pending = pending[len(cols):]
            tables[cat] = {'names': cols, 'rows': rows}
        elif s.startswith('_'):
            m = re.match(r'^(_\S+?)\.(\S+)\s*(.*)$', s)
            if m:
                cat, col, val = m.group(1), m.group(2), m.group(3).strip()
                if not val and i + 1 < len(lines):
                    i += 1
                    val = lines[i][1] if lines[i][0] == 'TEXT' else lines[i][1].strip()
                else:
                    tok = _tokenize(val)
                    val = tok[0] if tok else ''
                t = tables.setdefault(cat, {'names': [], 'rows': [[]]})
                t['names'].append(col)
                t['rows'][0].append(val)
            i += 1
        else:
            i += 1
    return tables


def table_dicts(tables, cat):
    t = tables.get(cat)
    if not t:
        return []
    return [dict(zip(t['names'], r)) for r in t['rows']]
