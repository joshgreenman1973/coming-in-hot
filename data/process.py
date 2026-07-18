#!/usr/bin/env python3
"""Build compact game map from raw OSM Overpass dumps.

Projection: local equirectangular, meters, origin at bbox center, +x east, +y SOUTH
(screen coords). Output: map.json consumed by the game.
"""
import json, math

CENTER_LAT = (40.662 + 40.690) / 2
CENTER_LON = (-74.001 + -73.968) / 2
M_PER_DEG_LAT = 111132.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(CENTER_LAT))

def proj(lat, lon):
    x = (lon - CENTER_LON) * M_PER_DEG_LON
    y = -(lat - CENTER_LAT) * M_PER_DEG_LAT
    return round(x, 1), round(y, 1)

streets = json.load(open('streets_raw.json'))['elements']
nodes = {e['id']: e for e in streets if e['type'] == 'node'}
ways = [e for e in streets if e['type'] == 'way']

# Count node usage to find intersections
use = {}
for w in ways:
    for nid in w['nodes']:
        use[nid] = use.get(nid, 0) + 1

# Emit nodes that are used; keep signal flag
node_ids = sorted(use.keys())
idx = {nid: i for i, nid in enumerate(node_ids)}
out_nodes = []
signals = set()
for nid in node_ids:
    n = nodes[nid]
    x, y = proj(n['lat'], n['lon'])
    out_nodes.append([x, y])
    t = n.get('tags', {})
    if t.get('highway') == 'traffic_signals' or t.get('crossing') == 'traffic_signals':
        signals.add(idx[nid])

CLASS = {'primary': 3, 'secondary': 2, 'tertiary': 2, 'residential': 1,
         'living_street': 1, 'unclassified': 1}

out_ways = []
for w in ways:
    t = w.get('tags', {})
    hw = t.get('highway')
    cls = CLASS.get(hw, 1)
    oneway = t.get('oneway') in ('yes', 'true', '1')
    rev = t.get('oneway') == '-1'
    seq = list(reversed(w['nodes'])) if rev else w['nodes']
    lanes = int(t.get('lanes', '2' if cls >= 2 else '1').split(';')[0])
    out_ways.append({
        'n': [idx[nid] for nid in seq],
        'c': cls,
        'o': 1 if (oneway or rev) else 0,
        'name': t.get('name', ''),
        'l': lanes,
        'cycle': 1 if ('cycleway' in ' '.join(t.keys()) or t.get('cycleway') not in (None, 'no')) else 0,
    })

# Restaurants: keep named, snap to nearest street node
rest_raw = json.load(open('restaurants_raw.json'))['elements']
out_rest = []
pts = out_nodes
for e in rest_raw:
    t = e.get('tags', {})
    name = t.get('name')
    if not name:
        continue
    lat = e.get('lat') or e.get('center', {}).get('lat')
    lon = e.get('lon') or e.get('center', {}).get('lon')
    if lat is None:
        continue
    x, y = proj(lat, lon)
    cuisine = (t.get('cuisine') or '').split(';')[0].replace('_', ' ')
    out_rest.append({'name': name, 'x': x, 'y': y, 'cuisine': cuisine,
                     'street': t.get('addr:street', '')})

# Bus routes: stitch relation member ways into continuous polylines
out_buses = []
try:
    braw = json.load(open('buses_raw.json'))['elements']
    bnodes = {e['id']: e for e in braw if e['type'] == 'node'}
    bways = {e['id']: e for e in braw if e['type'] == 'way'}
    rels = [e for e in braw if e['type'] == 'relation']
    per_ref = {}
    for rel in rels:
        ref = rel.get('tags', {}).get('ref')
        # local Brooklyn routes only; express X/SIM buses just ride the expressway here
        if not ref or not (ref.startswith('B') and ref[1:].isdigit()):
            continue
        chains = []
        chain = []
        for m in rel.get('members', []):
            if m['type'] != 'way' or m['ref'] not in bways:
                continue
            wnodes = [bnodes[n] for n in bways[m['ref']]['nodes'] if n in bnodes]
            if len(wnodes) < 2:
                continue
            pts = [proj(n['lat'], n['lon']) for n in wnodes]
            if not chain:
                chain = list(pts)
                continue
            tail = chain[-1]
            d_start = math.hypot(pts[0][0] - tail[0], pts[0][1] - tail[1])
            d_end = math.hypot(pts[-1][0] - tail[0], pts[-1][1] - tail[1])
            if min(d_start, d_end) > 80:
                chains.append(chain)
                chain = list(pts)
                continue
            if d_end < d_start:
                pts = list(reversed(pts))
            chain.extend(pts[1:])
        if chain:
            chains.append(chain)
        best = max(chains, key=len, default=None)
        if best and len(best) > 20:
            per_ref.setdefault(ref, []).append(best)
    for ref, chains in per_ref.items():
        chains.sort(key=len, reverse=True)
        for c in chains[:2]:  # keep up to two directions
            out_buses.append({'ref': ref, 'pts': [[round(x, 1), round(y, 1)] for x, y in c]})
except FileNotFoundError:
    pass

out = {
    'center': [CENTER_LAT, CENTER_LON],
    'nodes': out_nodes,
    'signals': sorted(signals),
    'ways': out_ways,
    'restaurants': out_rest,
    'buses': out_buses,
}
json.dump(out, open('../map.json', 'w'), separators=(',', ':'))
import os
print('nodes', len(out_nodes), 'ways', len(out_ways), 'signals', len(signals),
      'restaurants', len(out_rest), 'bus routes', len(out_buses),
      'bytes', os.path.getsize('../map.json'))
for b in out_buses:
    print('  bus', b['ref'], len(b['pts']), 'pts')
