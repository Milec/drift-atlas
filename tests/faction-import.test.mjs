import test from 'node:test';
import assert from 'node:assert/strict';
import {importGeneratorFactions, locationOwners, setLocationOwners} from '../dist/faction-import.js';
import {factionCatalog, factionModel, laneTerritories} from '../dist/factions.js';
import {prepareSector, createCluster, composeCluster, syncCluster, extractSector, mapId} from '../dist/clusters.js';
import {buildWorld, freshSimulation, syncParticipants} from '../dist/simulation.js';

// Shape verified against SWN's public source map: factionLayerHexes uses
// homeworld/homeworldEntity and assets[*].location/locationEntity. JSON export
// can translate an asset's type into {name, description}; references stay IDs.
function fixture() {
  return {
    sector: {sector: {name: 'Import test', columns: 8, rows: 10}},
    system: {
      alpha: {name: 'Alpha', x: 1, y: 1, parent: 'sector', parentEntity: 'sector'},
      beta: {name: 'Beta', x: 3, y: 3, parent: 'sector', parentEntity: 'sector'},
    },
    planet: {
      capital: {name: 'Capital', parent: 'alpha', parentEntity: 'system'},
      neutral: {name: 'Neutral', parent: 'alpha', parentEntity: 'system'},
      outpost: {name: 'Outpost', parent: 'beta', parentEntity: 'system'},
    },
    spaceStation: {station: {name: 'Station', parent: 'neutral', parentEntity: 'planet'}},
    moon: {moon: {name: 'Moon', parent: 'capital', parentEntity: 'planet'}},
    factions: {
      senate: {name: 'Senate', color: '#b13', homeworld: 'capital', assets: {
        fleet: {type: {name: 'Capital Fleet', description: 'Exported description'}, location: 'station', locationEntity: 'spaceStation'},
        base: {type: 'baseOfInfluence', location: 'outpost'},
        missing: {type: 'strikeFleet', location: 'deleted-location'},
      }},
      league: {name: 'League', color: '#74bdff', homeworld: 'station', homeworldEntity: 'spaceStation', assets: {}},
    },
  };
}
function model(data) {
  const all = Object.entries(data).filter(([type]) => !type.startsWith('_')).flatMap(([type, group]) => Object.entries(group).map(([id, n]) => ({...n, id, type})));
  const nodes = all.filter(n => n.type === 'system');
  return factionModel(all, nodes, data._driftAtlas.systems, factionCatalog(data));
}

test('generator factions claim exact homeworlds and asset locations, including shared stations', () => {
  const raw = fixture(), original = structuredClone(raw), data = prepareSector(raw), meta = data._driftAtlas;
  assert.deepEqual(raw, original, 'preparing a sector must not rewrite its generator records');
  assert.deepEqual(data.factions, original.factions);
  assert.equal(meta.factions['swn:senate'].name, 'Senate');
  assert.equal(meta.factions['swn:senate'].color, '#bb1133');
  assert.equal(meta.factions['swn:league'].color, '#74bdff');
  assert.equal(meta.systems.capital.factionId, 'swn:senate');
  assert.equal(meta.systems.outpost.factionId, 'swn:senate');
  assert.deepEqual(locationOwners(meta.systems.station), ['swn:league', 'swn:senate']);
  for (const id of ['neutral', 'moon', 'deleted-location']) assert.equal(meta.systems[id], undefined);
  const political = model(data);
  assert.deepEqual(political.owners.get('alpha'), ['swn:league', 'swn:senate']);
  assert.deepEqual(political.owners.get('beta'), ['swn:senate']);
  assert.equal(political.complete.has('alpha'), false);
  assert.equal(political.complete.get('beta'), 'swn:senate');
  const lanes = laneTerritories([{id: 'alpha', x: 1, y: 1}, {id: 'beta', x: 3, y: 3}], political.owners, [['alpha', 'beta']]);
  assert.deepEqual(lanes[0].owners, ['swn:senate']);
});

test('reloads preserve cleared ownership, changed colors, and deleted factions', () => {
  const data = importGeneratorFactions(fixture());
  data._driftAtlas.factions['swn:senate'].color = '#123456';
  delete data._driftAtlas.factions['swn:league'];
  setLocationOwners(data._driftAtlas.systems.capital, []);
  setLocationOwners(data._driftAtlas.systems.station, ['swn:senate']);
  const expected = structuredClone(data);
  importGeneratorFactions(data);
  assert.deepEqual(data, expected);
  const reloaded = prepareSector(JSON.parse(JSON.stringify(data)));
  assert.equal(reloaded._driftAtlas.factions['swn:senate'].color, '#123456');
  assert.equal(reloaded._driftAtlas.factions['swn:league'], undefined);
  assert.deepEqual(reloaded._driftAtlas.systems.capital, {});
});

test('older saves gain source factions without replacing existing orbital edits or claims', () => {
  const data = fixture();
  data._driftAtlas = {systems: {capital: {factionId: 'custom', notes: 'Keep'}, station: {}}, factions: {custom: {name: 'Custom', color: '#123456'}}};
  importGeneratorFactions(data);
  assert.equal(data._driftAtlas.systems.capital.factionId, 'custom');
  assert.equal(data._driftAtlas.systems.capital.notes, 'Keep');
  assert.deepEqual(data._driftAtlas.systems.station, {});
  assert.equal(data._driftAtlas.systems.outpost.factionId, 'swn:senate');
  assert.equal(Object.keys(data._driftAtlas.factions).length, 3);
});

test('claims survive multiple sector placements, cluster reloads, and extraction', () => {
  const cluster = createCluster(fixture()), meta = cluster._driftAtlasCluster;
  meta.members.push({id: 'second', x: 12, y: 0, sector: fixture()});
  let combined = composeCluster(meta);
  assert.equal(Object.keys(combined._driftAtlas.factions).length, 2);
  for (const member of combined._driftAtlasCluster.members) {
    assert.equal(combined._driftAtlas.systems[mapId(member.id, 'outpost')].factionId, 'swn:senate');
    assert.deepEqual(locationOwners(combined._driftAtlas.systems[mapId(member.id, 'station')]), ['swn:league', 'swn:senate']);
  }
  setLocationOwners(combined._driftAtlas.systems[mapId('second', 'station')], []);
  syncCluster(combined);
  combined = composeCluster(JSON.parse(JSON.stringify(combined._driftAtlasCluster)));
  const extracted = prepareSector(extractSector(combined, 'second'));
  assert.deepEqual(extracted._driftAtlas.systems.station, {});
  assert.equal(extracted._driftAtlas.systems.capital.factionId, 'swn:senate');
});

test('unlocated factions and malformed references do not invent territorial ownership', () => {
  const raw = fixture();
  raw.factions = {unknown: {name: 'Unknown', color: 'url(evil)', homeworld: 'alpha', homeworldEntity: 'planet', assets: {bad: {location: 'capital', locationEntity: 'spaceStation'}}}, empty: null};
  const data = importGeneratorFactions(raw);
  assert.deepEqual(data._driftAtlas.systems, {});
  assert.match(data._driftAtlas.factions['swn:unknown'].color, /^#[a-f0-9]{6}$/i);
  assert.equal(data._driftAtlas.factions['swn:empty'], undefined);
  assert.deepEqual(data._driftAtlas, importGeneratorFactions(structuredClone(raw))._driftAtlas);
});

test('explicit system references claim orbitals, and exclusive reassignment resolves shared claims', () => {
  const data = fixture();
  data.factions = {senate: {name: 'Senate', homeworld: 'alpha', homeworldEntity: 'system'}};
  importGeneratorFactions(data);
  for (const id of ['alpha', 'capital', 'neutral', 'moon', 'station']) assert.equal(data._driftAtlas.systems[id].factionId, 'swn:senate');
  assert.equal(data._driftAtlas.systems.outpost, undefined);
  const edit = {factionIds: ['a', 'b']};
  edit.factionId = 'c'; // Simulation conquest overrides imported claims; undo can restore them.
  assert.deepEqual(locationOwners(edit), ['c']);
  setLocationOwners(edit, []);
  assert.deepEqual(locationOwners(edit), []);
});

test('imported exclusive holdings are available to normal simulation initialization', () => {
  const data = prepareSector(fixture()), sim = freshSimulation(123), saved = data._driftAtlas.systems;
  syncParticipants(sim, data, saved);
  assert.ok(sim.factions['swn:senate']);
  const locations = new Set(sim.assets.filter(a => a.factionId === 'swn:senate').map(a => a.locationId));
  assert.ok(locations.has('capital'));
  assert.ok(locations.has('outpost'));
  assert.ok(buildWorld(data).byId.has('station'));
});
