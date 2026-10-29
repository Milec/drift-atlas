# Faction simulation

Open **Menu → World simulation**. Start from the map's campaign factions, or generate four starting factions if none exist. Set **Turns** to a whole number from 1–100, then press **Advance**. The simulator resolves that many turns sequentially. Automatic decisions are the default, with global manual mode, per-faction manual control, and individual queued orders. A campaign turn advances 30 days by default; this can be changed independently of Starfinder navigation.

## Rules and sources

The core is based on **Stars Without Number Revised**, Kevin Crawford / Sine Nomine Publishing, and [DonGiovanni's faction spreadsheet](https://d0ngiovanni.github.io/swn-faction-spreadsheet/) ([spreadsheet](https://docs.google.com/spreadsheets/d/1fpee1O4d-pSfq5Y9qqfOsVUBichT6hF6AVc3Lx56D0M/edit)). Numerical asset stats and the rating HP/XP tables were checked against that spreadsheet. All simulator code, interface text, and brief asset effect summaries are original.

Implemented core:

- Force/Cunning/Wealth ratings 1–8; faction HP = 4 + HP-table entries for the three ratings.
- SWN base income = ceil(Wealth/2) + floor((Force+Cunning)/4), plus asset income, minus one credit for each asset above its category's rating, then upkeep. The default campaign model also adds the territorial income described below. Bases do not count toward category limits.
- Unpaid upkeep disables an asset on its first missed payment; another missed payment removes it. Credits never become negative. Planning and execution share the same income/upkeep preparation: paying arrears restores availability before the action. Queued orders recognize bases and supporting assets ready on the upcoming turn; asset income starts only on its ready turn. Earlier factions can still change the situation before an order resolves.
- One action type per faction turn. Initiative picks a random starting faction, then cycles through the roster. Attack orders use every eligible attacker at one chosen location. Other orders target a selected asset/location.
- Opposed d10 + faction attribute combat. Ties normally apply both attack and counterattack damage. The defender selects its strongest eligible visible defender; a faction can instead absorb damage with its local base. Damage to bases reduces faction HP, limited to actual HP lost. Defeated factions release their map ownership.
- Asset purchase/refit prerequisites, technology, government permission, credit costs, and activation on the next turn.
- Expansion requires an existing active asset and buys base HP for credits. Rival Cunning contests can trigger retaliation. Influence does not automatically grant government ownership.
- Seizure defeats visible resistance, then maintains a visible asset for three turns before changing the selected orbital's owner. Ongoing seizures commit the faction to that action.
- Repair, selling at half cost, home relocation, supported transport abilities and economic actions, selected faction tags, tracked goals, and XP advancement.

### Explicit campaign adaptations and limits

Locations are individual generator orbitals (planets, moons, stations, facilities, belts), rather than the coarser SWN strategic location scale. A system without orbitals is one location. This preserves split ownership and contested systems. Map travel uses shortest drift-lane jumps in place of SWN hex range; travel between orbitals in one system uses zero jumps but still takes an action. Missing tech data defaults to TL4. Faction turns do not roll Starfinder travel time.

The catalog has 72 asset templates. Templates marked **GM ability** have their numerical stats tracked but require GM adjudication of their special effects. The interface explicitly marks these, and combat reports flag special-effect adjudication. Medical Center resurrection, multi-cargo transports, optional reroll timing, other faction tags, and narrative government-permission exceptions also need GM handling. Use asset/faction adjustments and notes. Movement orders currently select one cargo; attacks choose defenders automatically.

Starting packages and rule-based faction decision styles are campaign defaults. They are not a complete implementation of faction creation rules. Existing ownership is preserved on setup. Factions without an owned location are assigned an available home for their assets without claiming its government. Goal thresholds and rewards are GM-editable. Default objectives are expansion or four peaceful turns for 1 XP. Government permission is represented by ownership and allied relationships. This is a local GM simulator, not an external AI service.

## Advancing multiple turns

The Turns field defaults to 1 and sits beside the Advance button. Each turn resolves through the same engine with normal income, upkeep, combat, asset readiness, and ownership updates. A progress indicator reports completed turns; **Stop after current turn** (or Escape while running) stops at a turn boundary. Other campaign controls are disabled during the run to prevent overlapping changes.

Queued orders are consumed on the first turn. Later turns use each faction's automatic/manual control settings; manual factions hold unless completing an ongoing occupation. Every completed turn receives its own chronicle entry. Days advance by the selected count times the campaign's days per turn.

The live campaign is updated and saved when the run finishes or is stopped. Stopping before the first turn leaves it unchanged. **Undo last N turns** reverses the entire latest run, including dice state, credits, assets, history, and its ownership changes. This undo snapshot survives refresh and cluster saves. As with single-turn undo, unrelated manual map edits remain intact. A run that cannot save remains in memory with an export reminder.

## Territorial income

The default **SWN income + controlled territory** model adds one explicit campaign adaptation to support the map's finer orbital scale. Standard SWN rating income, asset prices, category limits, upkeep, and economic action rolls are unchanged. **Overview → Turn settings → Faction income → Standard SWN income only** disables the territorial term.

Each controlled location contributes faction credits once per turn:

| Holding | Contribution |
| --- | --- |
| Populated planet or moon | 1 below 100,000 inhabitants; 2 below 100 million; 3 below 1 billion; 4 at 1 billion or more |
| World technology | Cap population income at 1 for TL0–1, 2 for TL2, 3 for TL3, 4 for TL4; TL5 adds 1 to productive worlds |
| Operating facility | 2 credits; production/trade facilities, stations and research bases yield 3 at TL4+; other facilities yield 3 at TL5 |
| Productive owned capital | +1 to that location, once per faction |
| Uninhabited world, abandoned facility, ruin, empty belt, system/star | 0 |

Unrecorded planet population uses a modest 1 before technology adjustments; unrecorded moon population uses 0. Facilities use their own recorded population/occupation, so a working station can produce income above an uninhabited world. Missing technology keeps the existing world-lookup assumption (nearest recorded parent TL, otherwise TL4). Facility production/trade classification uses its generator type and recorded occupation, not its name. Credits are abstract faction credits, not personal credits.

The sum is separate from asset income: adding Bases of Influence or units does not create territorial revenue. The per-location breakdown appears in the faction sheet, and actual territory income is recorded in the turn chronicle. Mixed-control systems pay each orbital's owner independently, with no duplicate system payment. Income is calculated from ownership at the beginning of the turn; a seizure pays its new owner on the following turn. Live manual ownership changes update the next-turn projection immediately.

Existing saves without an `incomeModel` use the territorial model automatically; no reset or repopulation is required. It changes future income, not past balances or history. Explicit model choices persist through refresh, sector/cluster exports and imports, and undo. Income is computed from current map locations and ownership, rather than a cached territory total, so removed cluster members stop contributing.

Large developed holdings can support their initial local infrastructure, but sparse/unproductive territory, extra forces, and upkeep-heavy fleets can still produce a deficit. There is no automatic reimbursement of expenses or guaranteed positive net income.

## Assets throughout controlled territory

New factions initialize all their controlled planets, moons, stations, and other orbitals. Each location receives a small Base of Influence and one to three distinct local assets. Population controls the size of the package: sparse or empty worlds get a small outpost; developed worlds get more units. Technology and the facility type/occupation determine the templates: research bases receive researchers or laboratories, mines receive extraction/industry, trade and refueling stations receive shipping/trade assets, and military or intelligence sites receive corresponding units. Templates respect local TL and faction ratings. Unrecorded population uses a modest default; unrecorded technology retains the existing TL4 assumption.

The capital is chosen from owned planets first, preferring the most populated. It receives a full-strength base and up to four distinct assets. New factions start from 3/2/1 ratings, raised to support their templates and category counts (maximum 8), with eight credits plus three turns of any projected deficit. Factions without territory still receive a home package without claiming government ownership.

For an existing campaign, **World simulation → Overview → Populate controlled locations** previews additions at every uninitialized owned location and the projected economy. It preserves existing assets (including damage, readiness, owner, and location), orders, ownership, clock, and dice state. By default it preserves faction ratings and finances too. An optional checkbox scales ratings and reserves; this preserves faction damage relative to maximum HP. Setup is a GM adjustment with no purchase cost or turn consumed, recorded in the chronicle; it clears last-turn undo.

SWN upkeep and overextension remain in force. Holdings now contribute ongoing territorial income under the default model; the setup preview includes it in the net calculation. Startup reserves are still temporary. Review any projected deficit before advancing.

Initialization is remembered by location for the campaign, independently of its current owner. Repeated synchronization, refresh, imports, and setup clicks do not replenish moved, sold, or destroyed units after initialization. Existing campaigns created before this feature have no initialization record and require this one-time setup. Later captures do not automatically generate free assets. The GM can initialize newly assigned, previously uninitialized locations using the same preview. Location dossiers list local assets; system dossiers aggregate the assets across their orbitals.

## Persistence

`_driftAtlas.simulation` is schema version 1. It stores a seeded PRNG state, turn/day counters, settings (including `incomeModel`), faction sheets, assets, orders, history, and one undo snapshot. A resolved turn is computed from a clone and committed through the existing IndexedDB save queue. Failures to save are reported; the in-memory state remains exportable. Undo restores the state and random seed before the most recent advance operation (one turn or a batch); ownership deltas are reversed only if the current owner still matches the turn's result, preserving subsequent manual edits and unrelated notes/heights. GM adjustments invalidate undo.

`_driftAtlasCluster.simulation` preserves the combined campaign through composition. Cluster snapshots synchronize it alongside member documents. New member simulations are merged once, with map references remapped and colliding asset IDs namespaced. Existing destination faction finances and campaign clocks are authoritative. Extracting a sector includes its local assets and shared faction finances, filters local orders, and clears cross-map undo. Moving sectors preserves state. Initialization markers are remapped/merged with cluster members and filtered when extracting a sector. Missing locations remain visible in the roster as unavailable so a GM can relocate their assets rather than silently lose them. Deleted map factions are archived from turn processing on synchronization. Simulation metadata is validated on import.

## Files and validation

- `dist/sim-batch.js`: sequential turn batches, progress/cancellation boundaries, and whole-run undo.
- `dist/simulation.js`: pure turn engine, world lookup, rule-based decisions, initialization, validation.
- `dist/sim-income.js`: population/technology/facility income and per-orbital ownership accounting.
- `dist/sim-holdings.js`: population/technology/facility-based starting packages.
- `dist/sim-catalog.js`: numerical templates and rating tables.
- `dist/sim-storage.js`: cluster composition/extraction mapping.
- `dist/simulation-ui.js`: setup, orders, sheets, asset management, chronicle, and rules.
- `tests/simulation.test.mjs`: economy, deterministic resolution, constraints, movement, combat/ties, upkeep, occupation, repairs, 50-turn stability, persistence, order mapping, archive handling, import validation.

Run `node --test tests/simulation.test.mjs`. Browser QA additionally covers desktop/mobile controls, initialization, GM adjustments, queued orders, undo/replay, refresh, sector and cluster exports/imports, and orbital conquest across three turns.
