#!/usr/bin/env python3
"""Build compact game map from raw OSM Overpass dumps.

Projection: local equirectangular, meters, origin at bbox center, +x east, +y SOUTH
(screen coords). Output: map.json consumed by the game.
"""
import json, math

CENTER_LAT = (40.671 + 40.690) / 2
CENTER_LON = (-74.001 + -73.972) / 2
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

out = {
    'center': [CENTER_LAT, CENTER_LON],
    'nodes': out_nodes,
    'signals': sorted(signals),
    'ways': out_ways,
    'restaurants': out_rest,
}
json.dump(out, open('../map.json', 'w'), separators=(',', ':'))
import os
print('nodes', len(out_nodes), 'ways', len(out_ways), 'signals', len(signals),
      'restaurants', len(out_rest), 'bytes', os.path.getsize('../map.json'))
