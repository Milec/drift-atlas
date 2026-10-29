// SWN exports describe territorial presence with homeworld/homeworldEntity and
// assets[*].location/locationEntity (the generator's own faction overlay uses
// these references). Asset presence claims only that location, not its siblings.
const excluded = new Set(['note', 'factions', 'faction', 'routes', 'layers']);
const palette = ['#79dbcf', '#e47b62', '#a892df', '#e3bf74', '#75ade4', '#db8abd', '#a3c86b', '#e69e59'];
const own = (obj, key) => Object.hasOwn(obj, key);
const entries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];

export function locationOwners(edit, catalog) {
  const ids = edit?.factionId ? [edit.factionId] : Array.isArray(edit?.factionIds) ? edit.factionIds : [];
  return [...new Set(ids.filter(id => typeof id === 'string' && (!catalog || own(catalog, id))))].sort();
}

export function setLocationOwners(edit, ids) {
  delete edit.factionId;
  delete edit.factionIds;
  ids = [...new Set(ids)].sort();
  if (ids.length === 1) edit.factionId = ids[0];
  else if (ids.length > 1) edit.factionIds = ids;
}

function colorFor(value, id) {
  if (typeof value === 'string') {
    const color = value.trim();
    if (/^#[\da-f]{6}$/i.test(color)) return color;
    if (/^#[\da-f]{3}$/i.test(color)) return '#' + [...color.slice(1)].map(c => c + c).join('');
    if (/^#[\da-f]{8}$/i.test(color)) return color.slice(0, 7);
  }
  let hash = 2166136261;
  for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return palette[(hash >>> 0) % palette.length];
}

// Mutates a validated sector once. Keeping a marker in each member document
// prevents deleted factions, cleared claims, or later conquests being restored
// from the untouched generator records on reload, export/import, or cluster edits.
export function importGeneratorFactions(data) {
  if (data._driftAtlasCluster || data._driftAtlas?.swnFactionsImported === 1) return data;
  const meta = data._driftAtlas ||= {};
  const catalog = meta.factions ||= {};
  const saved = meta.systems ||= {};
  const locations = new Map();
  for (const [type, group] of entries(data)) {
    if (type.startsWith('_') || excluded.has(type)) continue;
    for (const [id, node] of entries(group)) if (node && typeof node === 'object' && node.name) locations.set(id, {...node, id, type});
  }
  const lineage = node => {
    const chain = [], seen = new Set();
    while (node && !seen.has(node.id)) {
      seen.add(node.id); chain.push(node.id);
      const parent = locations.get(node.parent);
      node = parent?.type === node.parentEntity ? parent : null;
    }
    return chain;
  };
  const chains = new Map([...locations].map(([id, node]) => [id, lineage(node)]));
  const claims = new Map();
  function claim(id, type, factionId) {
    if (typeof id !== 'string') return;
    const node = locations.get(id);
    if (!node || (type && node.type !== type)) return;
    if (!chains.get(id).some(key => ['system', 'blackHole'].includes(locations.get(key).type)) && node.type !== 'sector') return;
    const targets = ['sector', 'system', 'blackHole'].includes(node.type)
      ? [...locations.values()].filter(n => n.type !== 'sector' && chains.get(n.id).includes(id)).map(n => n.id)
      : [id];
    for (const target of targets) {
      if (!claims.has(target)) claims.set(target, new Set());
      claims.get(target).add(factionId);
    }
  }
  for (const [sourceId, faction] of entries(data.factions)) {
    if (!faction || typeof faction.name !== 'string' || !faction.name.trim()) continue;
    const id = 'swn:' + sourceId;
    if (!own(catalog, id)) catalog[id] = {name: faction.name.trim(), color: colorFor(faction.color, sourceId)};
    claim(faction.homeworld, faction.homeworldEntity || 'planet', id);
    for (const [, asset] of entries(faction.assets)) {
      if (asset && typeof asset === 'object') claim(asset.location, asset.locationEntity || 'planet', id);
    }
  }
  for (const [id, owners] of claims) {
    // Existing orbital edits may represent an intentional clear. For stars,
    // ignore only visual edits added by older versions of the cluster loader.
    const edit = saved[id];
    const star = ['system', 'blackHole'].includes(locations.get(id).type);
    if (own(saved, id) && (!star || Object.keys(edit || {}).some(k => !['z', 'stellarClass'].includes(k)))) continue;
    saved[id] ||= {};
    setLocationOwners(saved[id], [...owners]);
  }
  meta.swnFactionsImported = 1;
  return data;
}
