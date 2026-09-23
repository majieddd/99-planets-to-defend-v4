# 99 Planets To Defend (v4): game blueprint

Status: design approved in brainstorming on 2026-09-23. No code yet. This file is both the approved
spec and the running design document for the whole game. Check it before any build:

```bash
node "<aegis-suite>/tools/blueprint.js" check docs/blueprint.md --gate
```

## How to use this document

- This document is the prompt. It is the first thing any agent receives, before any request. The
  agent's first act is to restate the pillars in its own words and name the first end-to-end
  playable (Build order, item 1). A session that opens with a feature request has skipped it.
- Every number lives in Numbers with a rationale. Change the number here in the same commit that
  changes it in code.
- Decided, Task list and Where we are change in the same session that changes the game. A decision
  that is not in the ledger did not happen.
- House rules carried from WorldHeart v3 and still binding:
  - No em dash anywhere: code, comments, player copy, docs, commit messages. Use " - ".
  - Player copy is mechanics first, flavour second, and the flavour is one concrete sentence.
  - No exclamation marks in shipped copy. Uppercase only for short system markers (WAVE 12,
    PATH BLOCKED), never for sentences.
  - Comments explain why, not what. When fixing something subtle, say what the wrong behaviour was.
  - Commit messages describe the defect, the cause and the measurement, not only the change.

## Reference

The reference is **WorldHeart v3**, the owner's own shipped browser game
(https://majieddd.github.io/worldheart/v3/, branch `v3` of github.com/majieddd/worldheart). v4
re-creates it from the ground up: new code, every asset rebuilt in Blender, a new painted-ink look,
and the same mechanics, improved where possible. The v3 documents `docs/GAMEPLAY.md`,
`docs/CREATIVE.md` and `docs/99-PLANETS-TO-DEFEND.md` on that branch are the source for every value
marked "(v3)" below.

Borrowed mechanics, one line each. Each is an H3 under Mechanics.

- From WorldHeart v3: freeform placement on a curved planet under one rule (Tower placement); six
  tower families (Towers); the Xeno species (Xeno enemies); nests that feed waves (Nests and waves);
  crystals carried home (Crystals and deposit); the Worldheart ladder (Territory and the
  Worldheart); five commanders (Commander combat); drafts (Drafts); talents (Meta progression);
  mounts (Mounts); walls and forging (Walls and crafting); disasters (Weather and disasters);
  possession (Allies and possession).
- From Dungeon Defenders and Orcs Must Die: a hero who fights beside the defenses they build
  (Commander combat).
- From Borderlands: weapons generated from manufacturers, parts and rarities (Procedural weapons),
  and the bold black ink silhouette (Painted-ink renderer).
- From Dark Souls: committed attacks with readable wind-up and recovery (Xeno enemies, Commander
  combat), and the run back to recover what you dropped (Commander death and recovery).
- From Sifu: speed-painted surfaces, simplified volumes, cinematic colour, and a blend of cel and
  standard lighting on characters (Painted-ink renderer).
- From Kingdom Rush: a branch choice when a tower reaches its third mark (Towers).
- From Slay the Spire: choosing the next node on a branching route (Campaign route).

What v4 does that none of them do: a commander physically fights and carries resources across a
curved, fully generated planet while their defenses protect a base that grows until it covers the
whole world, and claiming the world wakes that world's own generated boss.

## Pillars

1. **The planet is the board.** Curvature is always visible, enemies crest the horizon before they
   arrive, and ranges and canyons shape every route. Nothing is flat and nothing is a map.
2. **Two decisions, one game.** Where your towers stand and where you stand are separate choices,
   each with a cost. Walking out leaves the base to fight alone; staying home leaves crystals, loot
   and nests untouched.
3. **Seal nothing, shape everything.** Build anywhere on your ground, with exactly one restriction:
   no placement may sever the last path from a nest to the Worldheart. The game is about bending a
   march, never walling it out.
4. **Every blow reads.** A wind-up you can see, a strike frame where the hit lands, a stop of time on
   contact, a spark and a number at the wound, a recovery you can punish. Nothing damages anything by
   touching it.
5. **Painted, inked, and honest light.** Every surface is painted in the asset and inked at its
   silhouette. Glow is information: cyan is yours, magenta is Xeno, warm is the heart and its
   economy. Decoration does not emit.

## Core loop

**Moment to moment (seconds).** Every few seconds there is a useful action: read a tell or a route,
then strike, dodge, build, upgrade, order, collect or reposition. Land the hit, see the reward, move.

**Session (one planet, 25 to 35 minutes).**

1. Landfall (0 to 2 min): the drop pod lands on an open site, the Worldheart deploys, the first tower
   goes down and a 12 m ring of territory appears.
2. Hold and venture (2 to about 27 min): timed waves pour from nests beyond the frontier, and calling
   a wave early pays gold. Between and during waves the commander walks or rides past the frontier
   for crystals, caches, weapons and buildings, and breaks nests.
3. Grow: deposit crystals as base credit, add gold, raise the Worldheart. Each of ten levels widens
   the territory, raises the tower mark cap and strengthens the commander. Level ten claims the
   whole planet.
4. Claim and boss (about 27 to 35 min): claiming the planet silences the last nests and wakes the
   planet's generated boss. Beat it, collect salvage, extract.
5. Choose: pick the next planet on the route map.

The planet is lost when the Worldheart falls. Nothing else ends a planet.

**Long term (campaign).** 99 planets along a branching route. Hostility, planet size, weapon eras
and boss complexity rise with the planet index. Coins earned every wave buy permanent talents:
towers, commanders, mounts and standing bonuses. Extracted weapons persist between planets; loot not
yet extracted is lost on defeat. New systems arrive one per planet over the first six planets, so no
planet teaches more than one new thing.

## Architecture

Approved in brainstorming as design section 1.

- **Stack.** TypeScript (strict), Three.js on WebGL2, Vite. Vitest for logic, Playwright for browser
  checks. GitHub Actions builds, checks and deploys to
  `https://majieddd.github.io/99-planets-to-defend-v4/`. WebGPU stays a later option, not a
  dependency.
- **`src/sim/` is the game.** Planet generation, navigation and flow fields, towers, enemies,
  nests and waves, economy, the heart ladder, the commander's authoritative movement and attacks,
  weapon, boss and loot generation, drafts, meta progression and the campaign. It runs at a fixed
  60 ticks per second from seeded RNG streams, imports nothing from `three` or the DOM, never calls
  `Math.random` or `Date`, keeps state plain and serialisable, models players as a list even when
  solo, and reports what happened as events. A lint rule enforces the boundary, because breaking it
  destroys headless testing (v3 invariant 1).
- **`src/render/`** draws whatever the simulation says: painted-ink materials, ink passes, post,
  terrain meshing, scatter, effects, animation playback and cameras. It interpolates between ticks
  and never writes simulation state.
- **`src/game/`** is the glue: input actions (keyboard and mouse, touch), commands into the
  simulation, simulation events out to render, audio and UI.
- **`src/ui/`** is the DOM HUD and menus in the painted-ink interface style, including touch
  controls. **`src/audio/`** is a procedural WebAudio engine. **`src/labs/`** holds the inspection
  pages.
- **`blender/`** holds one Python recipe per asset family plus shared libraries (paint bake, rig,
  animate, export). `npm run assets` runs Blender 5.2.1 headless and writes compressed GLB files,
  turntable preview sheets and `public/assets/manifest.json`. The outputs are committed, so CI and
  Pages never need Blender.
- **Built at runtime, not in Blender:** planets, and weapons and bosses assembled from Blender-made
  parts.
- **Saves** are a versioned envelope over the serialised simulation state, in IndexedDB with a
  localStorage fallback, with export and import.
- **Co-op later.** Nothing is networked now. The pure simulation keeps a co-op or Roblox port
  possible without a rewrite.

Planned repository layout:

```
src/sim/       pure deterministic game logic
src/render/    three.js renderer, materials, ink, post, terrain, effects, animation, cameras
src/game/      input actions, commands, event routing
src/ui/        HUD, menus, touch controls
src/audio/     procedural audio engine
src/labs/      Asset Gallery, Planet Lab, Weapon Forge, Boss Lab, Style Lab
blender/       recipes/ and lib/ (paint, rig, animate, export)
public/assets/ exported GLB, textures, manifest.json
tools/         asset build and checks, bot runner, capture, perf
tests/         vitest suites
docs/          this blueprint, decision records, evidence
```

## Art direction

Approved in brainstorming as design section 2, with approach A (painted in the asset, lit in the
shader, inked in two passes) chosen over a whole-screen painterly filter and over fully procedural
shader paint.

**The name.** Painted-Anime-Inkline 4.0: the painterly 3D of the Sifu flashback, the clarity of
Genshin Impact's anime shading, and the bold black silhouette ink of Borderlands.

**Material language.** The split is absolute, carried from v3's creative direction.

| Side | Surface | Glow |
|---|---|---|
| Player tech | Machined gunmetal and enamel plates, painted wear on edges | Cyan energy channels cut into the metal |
| Xeno swarm | Dark wet chitin | Magenta light bleeding through seams, as pressure rather than a lamp |
| Planet | Painted terrain in a per-theme palette | Only hazards emit (lava, geysers) |
| Worldheart | Warm crystal | The only warm glow on the planet |

**Per-theme palettes.** Each planet theme owns a named palette and a named light: key light colour
and elevation, a complementary shadow tint, fog colour, and a painted sky. A named palette plus a
named light direction is what buys the anime read; naming a style does not (a measured lesson from
the owner's `worldheart-styles` trials). Palettes are in Content.

**The frame, in order.**

1. Depth and normal prepass for the edge pass.
2. Painted lighting: three hard-edged light bands whose terminator breaks up like a brush stroke,
   shadows tinted with the theme's complementary colour, rim light, small stylized highlights.
   Characters blend cel and standard lighting, as Sifu does on its characters only.
3. Ink: an inverted-hull silhouette on characters, towers and props (width from a vertex channel
   authored in Blender), plus a screen-space pass on depth and normal discontinuities for terrain
   creases and object intersections. Lines wobble slightly like real ink and fade with distance.
4. Atmosphere: height fog, aerial perspective and a painted sky dome, all tinted by the theme.
5. Finish: bloom on emissive energy, a per-theme colour grade, light film grain. Depth of field only
   in menus and cutscenes.
6. A second render mode draws story cutscenes as black-and-white ink sketches with one warm accent.

**Ink rules** (measured lessons from `worldheart-styles`, binding): the style lives in the
materials, never as a screen overlay pinned to the glass; ink fades with distance so far terrain
does not become moire; open sunlit ground carries no ink across it; any hatching is computed in
object space and only in deep shadow; ink width scales per object so a 2 m character and a 300 m
planet both read.

**Blender recipes.** Each asset family has a Python recipe:

1. Build the model from primitives, bevels, skin modifiers and subdivision; simplify volumes the way
   Sifu does, so painting carries the detail rather than geometry.
2. Bake the painted colour map: ambient occlusion, curvature, a warm-top cool-bottom gradient, and
   brush-stroke noise that follows the form, combined through the asset family's palette.
3. Rig: one shared humanoid skeleton for commanders and wardens, creature skeletons for the Xeno.
4. Animate by script from pose libraries and timing curves. Every strike frame carries a marker that
   must equal the simulation's active frame (asset check).
5. Export GLB with compressed geometry and textures, plus a turntable contact sheet for review.

Enemy crowds bake their animation into vertex animation textures so hundreds stay cheap on a phone.
Commanders, wardens and bosses use skeletons.

**Style check, the M0 gate.** A golden-hour planet patch with one commander (idle, run, attack),
Bolt Sentinel marks I to III, a Husk, the Worldheart, a nest and the Verdant theme's rocks and
plants, shown in the Style Lab with live dials (ink weight, paint strength, band softness, shadow
hue, grade) beside the reference board. The owner's approved dial values become the locked
Painted-Anime-Inkline 4.0 defaults, and no asset family is mass-produced before that approval.

## Kit: the Blender asset vocabulary

The kit is not bought. It is built by script in Blender 5.2.1 LTS from recipes in
`blender/recipes/`. The asset build finds Blender through the `BLENDER_PATH` environment variable
(on the owner's machine, `C:\Users\Majied LaFleur\tools\blender-5.2.1\blender.exe`). The manifest is
`public/assets/manifest.json`, written by `npm run assets` and counted from the exported files; the
Content tables must equal its counts (`npm run assets:check`). Current count: 0 files, because
nothing is built yet. Every design noun in Mechanics through Content must be in this catalogue before
the milestone that uses it starts.

| Class | Planned count | Recipe | First milestone |
|---|---|---|---|
| Commanders | 5 archetypes on one shared skeleton (Bulwark, Twinfang, Longsight, Kettle, Emberline) | `commanders.py` | M0 (Bulwark), M4 (all five) |
| Allies | 1 (Warden) | `allies.py` | M4 |
| Xeno species | 4 (Mite, Husk, Aegis, Wisp) plus 4 evolution overlays (armour, speed, shield, split) | `xeno.py` | M0 (Husk), M2 (all four) |
| Towers | 6 families x 3 marks = 18 models, plus 12 specialization variants | `towers.py` | M0 (Bolt Sentinel I to III), M2 (all) |
| Worldheart | 1 model with 11 growth stages | `heart.py` | M0 |
| Nests | 1 base model plus a dressing per theme | `nests.py` | M0 |
| Weapon parts | 6 families x 5 slots x 4 manufacturers x 3 eras, about 360 parts | `weapons.py` | M5 |
| Boss parts | 5 archetypes, each with body, limb, head, armour and weak-point sets | `bosses.py` | M6 |
| Mounts | 3 (Ridge Strider, Tideback, Sky Ray) | `mounts.py` | M8 |
| Structures and chests | 4 structure families, 5 chest rarities, 1 wall segment | `structures.py` | M5 (structures, chests), M8 (walls) |
| Pickups and projectiles | crystal, scrap, coin, cargo cache, about 12 projectiles | `pickups.py` | M2 |
| Props | drop pod, heart plinth, beacon, about 6 | `props.py` | M2 |
| Environment kits | per theme: 6 to 10 rocks, 6 to 10 flora, 3 to 5 landmarks, grass cards | `env_<theme>.py` | M0 (Verdant), M2 (6 themes), M8 (12 or more) |
| Brush atlas | brush-stroke detail textures for terrain and paint bakes | `brushes.py` | M0 |
| UI icons | rendered from the models in the painted style: towers, weapons, powers | `icons.py` | M9 |

Kits that are not Blender assets: the painted-ink material and ink passes (`src/render/`), sky and
terrain painting (runtime shaders fed by the brush atlas), and audio (procedural, `src/audio/`).

## Concept and coherence

**Reference board.** Three sources, used for their qualities, never copied:

1. The owner's Sifu clip (youtube.com/watch?v=B-KxB2ip3JY, 80 s), studied frame by frame on
   2026-09-23. From 0:00 to 1:05 it is painterly 3D: simple forms carrying hand-painted,
   brush-stroked albedo on skin, hair strands, cloth folds and wood grain; a hard-edged terminator
   with painted gradients inside each zone; warm amber key light against teal and green coloured
   shadows; saturated accents; rain, neon bloom and bokeh; caricatured faces; thin painted lines only
   on features. From 1:10 to 1:20 it is a raw black-and-white ink-sketch flashback: the ink half of
   the brief, and the model for v4's cutscene mode.
2. v3's four painted prologue panels (Painted-Anime-Inkline 1.3.2, v3 branch), which set the owner's
   earlier calibration: line 1.81, texture 1.5, saturation 1.3, shadow depth 0.35, exposure 0.77.
3. Borderlands' ink silhouette, described in words only: bold, near-black, uniform contour lines on
   outer silhouettes and major creases.

Sifu's technique, from its own team: the art director describes speed-painted textures and
simplified volumes plus cinematic lighting and grading; its lighting artist describes a smooth mix of
cel shading and standard lighting applied to characters only, with art-tunable parameters.

**Frozen nouns.** These words describe the look in every brief, review and commit: painted
brush-stroke albedo, brush-edged shadow, coloured shadow, ink silhouette, gunmetal and enamel, cyan
energy channel, wet chitin, magenta seam light, warm heart crystal, painted sky.

**Coherence sheet.** No image generator is used: the kit is the renderer plus the Blender assets, so
the in-engine render is the concept. The Style Lab (M0) shows the style scene beside the reference
board, with the `art-catalogue` colour audit (does each theme hold the palette it names) and its
mutation proof (the audit must reject a hue-rotated render of the same scene). Status: not yet.

## Mechanics

Every mechanic below has six fields. Values marked "(v3)" come from WorldHeart v3's documents.
Values without a mark are new in v4 and are listed again in Numbers with their rationale.

### Painted-ink renderer

**Purpose:** makes every frame read as a painted, inked illustration while staying readable at every
zoom and fast on every supported device.
**Experience:** up close the world looks hand-painted; at strategic zoom it stays clean; silhouettes
pop against terrain; energy glows where it means something; nothing swims when the camera moves.
**Inputs:** the scene, the planet theme's palette (key light colour and elevation, shadow tint, fog,
grade), the quality tier, the locked render dials, the camera mode (strategic, third person, first
person, cutscene).
**Outputs:** the final frame: painted lighting, hull ink, screen-space edge ink, fog and sky, bloom,
grade and grain; in cutscene mode, the ink-sketch frame.
**Edge cases:** distant terrain ink turning to noise (distance fade and a minimum screen-space line
spacing); sunlit open ground (a lit-flatness mask suppresses ink); thin geometry (hull width clamped
in screen pixels); the first-person weapon (its own pass that clears depth only, never colour, v3
invariant 5); transparent surfaces such as water, range veils and telegraphs (excluded from the edge
pass, drawn after it); very small or very large objects (per-material ink and brush scale).
**Failure:** on a failed capability check or a slow device the renderer steps down one tier at a time
(edge pass off, then shadow resolution, then post), never to a black frame; a lost WebGL context
restores its resources and continues.

### Commander movement

**Purpose:** puts the player physically on the planet, so they can walk past the frontier, carry
crystals, reach fights and escape them.
**Experience:** fast, fluid and weighty: acceleration into a run, a sprint that widens the lens, jumps
that always fire when pressed, turns that ease rather than snap, the horizon curving ahead.
**Inputs:** move vector (WASD or the touch thumb pad), sprint, jump, dodge, look (mouse or right-side
touch drag), the terrain height field, solid props and tower footprints, water depth, cargo load,
mount state.
**Outputs:** position on the sphere with gravity toward the centre, velocity, facing, movement state
(grounded, airborne, swimming, dodging, mounted), footstep and landing events, animation state.
**Edge cases:** poles and the longitude seam (the tangent frame is transported, never Euler angles; a
unit's frame stays orthonormal, v3 invariant 2); a tower placed on the commander (pushed to the
nearest free point); step-ups under 0.45 m are automatic and mantles reach 1.6 m; slopes over 50
degrees slide; a jump pressed just before landing or just after leaving a ledge still fires (buffer
and coyote time); water entry and exit use hysteresis (enter at 0.65 m depth, leave at 0.45 m, v3);
knockback sweeps in steps of at most 0.12 m and stops at illegal edges (v3).
**Failure:** a position inside terrain or a non-finite value snaps back to the last valid grounded
pose; a commander that falls through the world returns to the heart with a notice. Never a soft lock.

### Cameras

**Purpose:** keeps orientation and targeting reliable while the player changes scale and control
mode.
**Experience:** three views joined by smooth 0.35 s blends: Strategic (an orbit over the base, where
dragging pans with the ground locked under the cursor, v3), Third person (a spring arm with
collision) and First person (with a painted viewmodel). The planet feels vast underfoot and round
from above.
**Inputs:** Tab (or the view button on touch) switches between the Strategic view and the commander;
in commander views the mouse wheel moves between first and third person, and in the Strategic view it
zooms; look, pan and zoom input; commander state; frontier state; the reduced-motion setting; terrain
collision.
**Outputs:** the presentation camera pose and lens every frame (never simulation state), the reticle
and aim ray, view-change events for the HUD.
**Edge cases:** the Strategic view is refused while the commander stands outside the frontier (v3
rule, which keeps venturing risky); a camera inside a cliff shortens its arm; a view switch during a
dodge; poles (heading carried with the focus, v3); near-plane precision (near tied to altitude, v3
invariant 6); pointer lock refused (right-drag looks, v3).
**Failure:** if no collision-free pose exists, the camera drops to the head position for that frame;
input ownership is always restored after a menu closes.

### Commander combat

**Purpose:** makes the commander a real force: clearing raids, breaking nests, answering leaks at the
heart and fighting the boss.
**Experience:** Dark Souls weight at Sifu speed: a chain of three light strikes, a charged heavy, the
weapon skill (V) and the commander skill (Z), a dodge-roll whose invulnerable frames reward reading
tells, soft lock-on, hit-stop, camera kick, sparks and numbers. Five archetypes feel different in the
hands: Bulwark's heavy cleave, Twinfang's fast pair, Longsight's hitscan rifle, Kettle's arcing
lobber and Emberline's channelled beam (v3).
**Inputs:** attack, heavy (hold attack), aim (ranged families), skills, lock-on, equipped weapon
stats, archetype, targets in range.
**Outputs:** attack instances with a shape (arc, cone, sphere, ray or projectile) and phase timings
(wind-up, active, recovery); damage packets with element and critical flag; status effects; hit and
miss events for effects, audio and UI.
**Edge cases:** a target that leaves the shape before the active frame is missed; one swing hits each
enemy at most once; a dodge cancels recovery only after the active frame; being staggered cancels a
wind-up and removes its telegraph; first and third person share one resolver, so a hit is the same
hit in both views; weapon swaps settle after recovery and launched projectiles keep their release
stats (v3).
**Failure:** an attack whose owner dies, is stunned or is left by possession is cancelled together
with its telegraph. There is never invisible damage.

### Commander death and recovery

**Purpose:** makes venturing dangerous without ending a 30-minute planet on one mistake.
**Experience:** a Souls-style recovery. You fall; your carried crystals and unextracted pickups drop
as a glowing cargo cache where you died; you watch the base from the Strategic view while the respawn
counts down; you walk back and reclaim the cache. Die again before reaching it and that cache is
gone.
**Inputs:** commander health reaching zero, the death position, cargo, frontier state, any existing
cache.
**Outputs:** a cargo cache entity with a HUD marker; a respawn timer (12 s inside the frontier, 30 s
outside); respawn at the heart at full health; removal of the previous cache if one existed.
**Edge cases:** death in deep water, lava or a pit puts the cache at the last safe ground position;
death during the boss fight still respawns while the boss keeps going; a cache swallowed by expanded
territory stays claimable; death while mounted sends the mount home; the heart falling while the
commander is dead loses the planet.
**Failure:** a cache whose position becomes invalid (after a quake) moves to the nearest walkable
node.

### Territory and the Worldheart

**Purpose:** the base's single upgradable spine: how much of the planet you hold, how strong your
towers may become, and the trigger for the boss.
**Experience:** a painted ring on the ground grows with each level, fog lifts over newly claimed
land, swallowed nests collapse, the heart crystal grows through eleven visible stages, and at level
ten the whole world is yours and the sky turns.
**Inputs:** a purchase (B or the heart panel) paid with base credit first and gold for the rest; the
current level; the planet radius.
**Outputs:** the frontier's angular radius; the tower mark cap (2 + level, v3); commander bonuses per
level (+15% health, +12% power, +2.5% speed, +4.5% reach, v3); the heart's integrity maximum; nests
inside the new frontier silenced with their bounty paid; at level ten, the claim event that starts
the boss awakening.
**Edge cases:** buying during a wave is allowed and enemies already inside keep fighting; a swallowed
nest's queued enemies are cancelled while its living ones remain; the navigation graph is built once
at final size and masked, never rebuilt (v3 invariant 3); buying while the commander is dead is
allowed.
**Failure:** a purchase that cannot validate is refused with its reason, and nothing is spent.

### Tower placement

**Purpose:** turns the planet into the board: freeform building that bends the march without walling
it out.
**Experience:** a ghost follows the cursor (Strategic view) or the crosshair (commander views), green
when legal and red with a plain reason when not; a range veil shows true 3D reach including height;
the tower settles onto the ground's normal.
**Inputs:** the tower card, position, footprint, the navigation graph with current blocks, the
frontier mask, gold, and in commander views the commander's position (build reach 14 m, v3).
**Outputs:** the tower entity; gold and the card spent; the footprint blocked in the navigation
graph; the flow field updated; a placement event.
**Edge cases:** the one rule, which refuses any footprint that severs the last path from any live
nest or certified nest site to the heart (reachability sweep with the candidate blocked, v3); covering
the heart or a nest node; a living enemy on the footprint (refused as occupied) while a dying one
does not block (v3); ground steeper than a 0.62 grade (v3); water; raised ground adds reach; terrain
affinity gives bonuses only (hot stone +15% Mortar damage, cold stone +10% Cryo slow; v3's
restrictions become bonuses).
**Failure:** if the flow field update fails the placement rolls back and refunds. The ghost never
lies: preview and commit call the same validator.

### Towers

**Purpose:** the player's patient, stationary power: six machines with six different verbs.
**Experience:** each tower does one thing clearly, looks like what it does from any distance, and
visibly changes at each authored mark; at mark III the player picks one of two specializations that
changes how it plays.
**Inputs:** type, mark, specialization, modifiers from powers and talents, height bonus, terrain
affinity, the heart's mark cap.
**Outputs:** attacks through the shared damage pipeline, status effects, garrison units (Warden
Barracks), upgrade and sell events.
**Edge cases:** marks past III follow the endless ladder, capped by the heart level (cost x1.5 per
mark, power exponent 1.5, uneven per-stat scaling, v3); an upgrade blocked by the cap shows why;
selling refunds 70%, or 90% with the Salvage power (v3); a specialization is permanent until the
tower is sold; the Mortar keeps a minimum range; Mortar and Warden Barracks cannot hit air (v3).
**Failure:** a tower whose target dies mid-shot releases its projectile harmlessly or retargets; a
tower disabled by a radiation storm shows its ring and resumes when the timer ends (v3).

### Tower targeting

**Purpose:** decides who each tower shoots, predictably.
**Experience:** towers turn to real targets, defend the heart first by default, and let experts set a
priority per tower.
**Inputs:** enemies inside 3D acquisition range, each enemy's flow distance to the heart, the
tower's priority (First, Strongest, Air, Closest), its current target.
**Outputs:** the chosen target and the turret heading.
**Edge cases:** a current target is kept inside 1.1 times squared range (v3); heads turn at 9 rad/s,
the Mortar at 5, and fire only within 0.15 rad of aim (v3); a dying body is untargetable during its
0.42 s collapse (v3); flyers dive to 0.7 m near allies and climb back (v3).
**Failure:** with no valid target the turret eases to its rest pose. It never fires at nothing.

### Xeno enemies

**Purpose:** the pressure: a conversation of species in which each answers the player's last answer.
**Experience:** they crest the horizon, march the routes the player shaped, and every blow is
telegraphed by a red volume and a wind-up that can be read and dodged. Mites are fast and cheap,
Husks soak, Aegis are armoured, Wisps fly over the maze (v3).
**Inputs:** species template, wave scaling, evolution tier, the flow field, nearby targets
(commander, allies, walls), the heart.
**Outputs:** movement; attacks with wind-up, strike frame and recovery; damage to units, walls and the
heart; death, bounty and drop events.
**Edge cases:** chase rules (an enemy may break off toward the commander within 7 m, the heart wins
within 10 m, the chase ends at 11 m or after 9 s, then that enemy ignores the commander for 6 s;
bosses never chase, v3); flyers use their own graph and ceiling; a blow lands only if the victim is
still inside reach plus a small grace at the strike frame (v3); pooled enemies reset every field on
reuse (v3 invariant 4); enemies that reach the heart strike it with telegraphed blows instead of
subtracting lives.
**Failure:** an enemy with no route (impossible under the one rule) walks straight for the heart at
8% speed (v3 emergency travel) and is flagged in the developer log.

### Enemy evolution

**Purpose:** turns the planet's clock into escalating pressure, so expanding slowly costs.
**Experience:** at set waves the whole swarm gains a trait, announced on the HUD.
**Inputs:** the wave number.
**Outputs:** traits applied to newly spawned enemies: armour at wave 4, speed at wave 8, a shield at
wave 12 (soaks three hits and recharges after 3 s untouched, v3), and splitting at wave 16 (mites
split on death at 40% health, v3).
**Edge cases:** enemies already alive keep their tier; split children cannot split again (v3); the
shield breaks only under sustained fire; Deep Freeze holds for 4 s, then that enemy cannot be frozen
for 2.5 s (v3).
**Failure:** an unknown tier id is ignored with a developer warning.

### Nests and waves

**Purpose:** the source of the swarm, placed in the world so the player can go out and break it.
**Experience:** a new nest bursts from the ground beyond the frontier each wave after a three-second
warning; the wave timer counts down; calling early pays gold; breaking a nest cancels what it still
owed and pays a bounty; expanding over a nest silences it.
**Inputs:** the wave number, the nest site catalogue certified at generation, the frontier, the
timer, the call-early input.
**Outputs:** nest entities, spawn queues, wave start and clear events, rewards.
**Edge cases:** nest sites need a 2.4 m dry clearing, 6 m from other nests and 10 m from the heart
(v3); new nests seek an outward target of 12 m plus 7 m per completed wave beyond the frontier (v3);
surviving nests add a pack to later waves (v3); a wave clears when its own enemies are gone, and nest
raiders never hold it open (v3); when no safe site exists the wave is delayed with a visible warning
and selling reopens the search (v3); strategic pause and drafts freeze the clock.
**Failure:** if generation cannot certify enough nest sites, the planet seed advances by 7919 before
play starts (v3).

### Economy

**Purpose:** four currencies with four separate jobs, so every pickup has an obvious use.
**Experience:** gold for the board, crystals for the heart, scrap for crafting, coins for the
campaign.
**Inputs:** kills, wave clears, early calls, nest bounties, caches, crystal deposits, salvage.
**Outputs:** balances and spend events.
**Edge cases:** base credit from crystals only buys heart levels (v3); cost modifiers cannot push a
price below 25% (v3); every receipt is idempotent, so a reload cannot pay twice (v3).
**Failure:** a purchase without the funds is refused and the missing amount is shown.

### Crystals and deposit

**Purpose:** the reason to leave the base.
**Experience:** warm crystals glint in the wild, are picked up by walking over them, slow you a little
when you carry a full load, and deposit themselves with a chime when you walk into the heart's aura.
**Inputs:** crystal sites (two per expansion, 24 at most, 9 m apart, outside the frontier, v3), the
commander's position, cargo capacity (3, or 4 with a talent).
**Outputs:** the cargo count, base credit (+100 per crystal, v3), deposit events.
**Edge cases:** with a full cargo the crystal stays where it is and the HUD says so; death drops the
cargo into the cargo cache; deposit is automatic within 4.5 m of the heart, with no key press (v3
used a key); crystals on land that is claimed later stay collectable.
**Failure:** a crystal generated inside terrain moves to the nearest walkable node.

### Frontier and exploration

**Purpose:** the risk and reward space outside the base.
**Experience:** step over the ring and painted fog closes behind you, the Strategic view goes dark,
the music thins; points of interest pull you on: crystal glints, cache beacons, building silhouettes,
nest pulses; a compass always shows home.
**Inputs:** the frontier mask, the commander's position, points of interest, distance from the
frontier.
**Outputs:** fog density, the danger level (wandering packs spawn out of sight, more often farther
out), compass markers, the Strategic view lock.
**Edge cases:** the frontier can expand while the commander is outside, putting them suddenly inside;
mounts extend the practical range; telegraphs always draw above the fog; wandering packs never spawn
within sight of the commander.
**Failure:** if the compass cannot resolve a route home, it points in a straight line.

### Procedural planets

**Purpose:** every planet is new, and every planet is fair.
**Experience:** from orbit a whole painted world with its own palette and landforms; up close, ranges
and canyons that shape the routes the swarm must take.
**Inputs:** the seed, planet index, theme, terrain pack, size class and hostility.
**Outputs:** an analytic height field (continents, ranges with passes, canyons with ramps, plateaus,
water); biome paint; the navigation graph; a certified heart site; nest and crystal sites; scatter
instances; structures and landmarks; sky and palette.
**Edge cases:** the same seed produces the same planet (hash test); the heart site must be open
ground; every nest site must be reachable; range crests are impassable except at passes (v3); the
height field used for walking excludes fine visual noise so walkability never fractures (v3); water
crossings cost more; generation runs in workers within the time budget in Numbers.
**Failure:** an invalid field advances the seed by 7919 and retries (v3), up to 12 tries, then falls
back to a known-good seed and logs it.

### Pathing

**Purpose:** turns towers and walls into shaped routes.
**Experience:** the swarm visibly bends around what you build.
**Inputs:** the navigation graph (a geodesic grid over the sphere), blocked nodes from tower
footprints, wall costs, the heart node.
**Outputs:** a ground flow field (single-source Dijkstra from the heart, v3), a separate flyer graph
with a ceiling, and route previews for placement.
**Edge cases:** incremental updates on build and sell; walls add a finite cost, so enemies detour or
batter through a sealed lane (v3); swimming costs; a bounded uphill penalty (v3); quakes update
routes in bounded batches (v3).
**Failure:** an update that exceeds its tick budget completes over later ticks while enemies keep the
previous field.

### Procedural weapons

**Purpose:** loot worth walking out for; every drop a small surprise.
**Experience:** a light beam in the rarity's material, a card with the three stats that matter and an
arrow against what you hold; each manufacturer feels different in the hand, and every part visibly
changes behaviour.
**Inputs:** family (Sword, Spear, Twinblade, Carbine, Lobber, Scepter), manufacturer, parts,
rarity, element, era by planet tier, item level (planet index), seed.
**Outputs:** a weapon definition (stats, behaviour flags, parts, name), a model assembled from Blender
parts, and its card.
**Edge cases:** a compatibility table excludes impossible part pairs; stat ranges are clamped per
family; a Relic's unique effect cannot roll twice on one planet; the same seed gives the same weapon.
**Failure:** an invalid combination deterministically rerolls the offending part.

### Inventory and equipment

**Purpose:** holding, comparing and swapping weapons without breaking the flow.
**Experience:** walk over a drop to collect it; press I to pause and compare; swap between the two
equipped slots with X.
**Inputs:** pickups within 2.8 m (v3), the backpack (12 slots, v3), the equipped slots (2, v3).
**Outputs:** inventory state, equip events, salvage (1 scrap each, v3).
**Edge cases:** a full backpack leaves the drop on the ground; a swap during an attack applies after
recovery (v3); extracted weapons persist between planets.
**Failure:** a corrupt saved weapon becomes a basic weapon of its family, with a notice.

### Structures and chests

**Purpose:** landmarks with rewards, so exploring pays.
**Experience:** ruined outposts, crashed landers, ancient shrines and dead Xeno hives stand in the
wild with open entrances; inside, chests in rarity materials.
**Inputs:** structure sites from generation, chest rolls, interaction (E or a tap).
**Outputs:** loot (scrap, weapons, crystals, gold) and one-time claims.
**Edge cases:** structures never block nest routes; interiors have collision the commander can walk
into; claims persist in the planet save (v3).
**Failure:** a chest that cannot spawn its loot pays scrap instead.

### Planet boss

**Purpose:** the planet's final exam, generated from the planet itself.
**Experience:** claiming the world turns the sky; ten seconds later the boss rises from the planet's
most dramatic landform and marches on the heart. It telegraphs everything, carries glowing weak
points the commander can break, and changes phase as they break.
**Inputs:** the planet's theme and element, planet index, seed, and an estimate of player power
(towers, marks, weapon level).
**Outputs:** a boss definition (archetype, parts, element, attack modules, phase thresholds, health),
the boss entity, phase and defeat events.
**Edge cases:** the archetype comes from the theme affinity table in Content; planets 1 to 20 have two
phases and later planets three; attacks reuse the shared telegraph and damage pipeline; towers across
the planet engage it in range; it never chases the commander (v3) but punishes anyone in reach; the
commander can still respawn during the fight.
**Failure:** a boss that gets stuck relocates along its route with a burrow or flight animation.

### Drafts

**Purpose:** run-to-run variety inside a planet through light decisions.
**Experience:** every cleared wave pays a reward: odd waves offer a choice of two tower cards, even
waves a choice of three powers. The draft pauses the game until you pick.
**Inputs:** the wave number, unlocked towers, the power pool (weights 100 common, 45 uncommon, 14
rare, v3), the hand (3 cards, or 4 with a talent, v3).
**Outputs:** a card added to the hand (spent when its tower is placed), or a power written to the
modifier object.
**Edge cases:** into a full hand, the player replaces a card or discards the new one (v3 lost it
silently); rare powers are unique and change a rule (v3); multipliers add into a base of 1, so three
+12% powers make 1.36 (v3 guard against runaway stacking); every power has a test proving a consumer
reads what it writes (v3 shipped four that did nothing).
**Failure:** an empty pool offers gold instead.

### Meta progression

**Purpose:** long-term goals and unlocks across the campaign.
**Experience:** coins from every wave, spent in a four-tier talent tree between planets on new
towers, commanders, mounts and standing bonuses.
**Inputs:** coins earned (banked whether the planet is won or lost, v3), the talent tree.
**Outputs:** the account profile (unlocked towers, commanders and mounts, bonuses) and the stash of
extracted weapons.
**Edge cases:** talents apply at the next planet start; every talent has a test proving it works (v3
shipped two that did nothing); coins are never lost on defeat.
**Failure:** an older save migrates through versioned steps; a save that cannot migrate is kept as a
downloadable backup and a fresh profile starts.

### Campaign route

**Purpose:** the 99-planet journey, with meaningful choice.
**Experience:** a painted star chart; at each step, choose between two or three planets, each showing
its theme, size, hostility, boss silhouette and reward bias.
**Inputs:** the campaign seed, the current node, the account profile.
**Outputs:** the next planet's definition, route state, and story beats at planets 1, 10, 25, 50, 75
and 99.
**Edge cases:** defeat returns you to the same step (retry, or pick another node) with coins and
extracted weapons kept; hostility rises with the index whatever the route; branches rejoin, so no
choice locks the finale.
**Failure:** a corrupt route regenerates from the campaign seed and the current index.

### Mounts

**Purpose:** faster travel across large territories, and routes over water or through the sky.
**Experience:** call a mount with M: the Ridge Strider is fast on land, the Tideback swims, and the
Sky Ray glides and flies briefly (v3).
**Inputs:** mount unlocked by talent, mount state, terrain.
**Outputs:** speed and weapon damage factors (v3 values in Numbers), flight energy.
**Edge cases:** the Sky Ray flies for 12 s and recharges on landing, and high peaks still block it
(v3); a heavy hit dismounts; mounts cannot enter structures; commander speed bonuses multiply mount
speed (v3).
**Failure:** a mount stuck in terrain despawns and can be called again.

### Walls and crafting

**Purpose:** cheap tactical shaping, and a use for scrap.
**Experience:** lay short wall segments to add path cost, and enemies detour or batter through; forge
a random tower card at the heart; merge three identical weapons into the next rarity.
**Inputs:** scrap; wall placement (1 scrap for 5 segments of 180 HP each, v3); forge price (3, 5, 7
scrap and so on, v3); weapon merge (three identical weapons, capped at Rare, v3).
**Outputs:** wall entities with a path cost and health, forged cards, merged weapons.
**Edge cases:** walls add finite cost, so they never break the one rule; flyers pass over walls; a
forge needs a free hand slot and only a successful forge raises its price (v3); walls keep their
health in saves (v3).
**Failure:** a wall that cannot be placed returns its scrap.

### Weather and disasters

**Purpose:** planets that fight back, and moments that change a plan.
**Experience:** an eight-second warning showing the exact affected area, then a tornado, quake,
storm or wave that hits both armies (v3).
**Inputs:** theme compatibility; hostility (0.15 to 0.60 on planet 1, 0.80 to 1.60 on planet 99,
v3); a seeded schedule (calm interval 150 / (0.65 + hostility) seconds, never under 38 s, v3).
**Outputs:** disaster events with area, effect and duration; terrain changes for quakes.
**Edge cases:** tsunamis need a coastline and eruptions need a volcano (v3); a radiation storm stops a
struck tower for 8 s (v3); bosses resist displacement (v3); at most eight quake faults per planet
(v3); quakes preserve heart access, nest routes and tower footprints (v3).
**Failure:** a disaster that cannot find a valid area is skipped.

### Allies and possession

**Purpose:** extra hands on the ground, and a way to be anywhere.
**Experience:** Warden Barracks raise spear wardens who hold ground; click any friendly unit to take
control of it in first or third person; rally nearby wardens into a party with G and dismiss them
with H (v3).
**Inputs:** the barracks mark (2, 3 or 5 wardens, summoned every 7, 6 or 5 s, v3), the possession
target, rally input.
**Outputs:** ally units, possession state, party orders.
**Edge cases:** the pin budget (a unit may hold one enemy for 3 s, then must release it for 4 s, v3);
a possessed warden that dies returns control to the commander; only the commander can rally (v3).
**Failure:** control always returns to the commander when the possessed unit is removed.

### Story cutscenes

**Purpose:** gives the 99-planet journey a spine without slowing play.
**Experience:** short ink-sketch sequences, black and white with one warm accent in the manner of the
Sifu flashback, at arrival, the first boss, and planets 10, 25, 50, 75 and 99; always skippable. The
core fiction is kept from v3: a Worldheart is the crystal that keeps a living world alight, the Xeno
swarm devours worlds, and you carry the heart from world to world across 99 planets.
**Inputs:** the campaign beat and its cutscene script (shots, poses, captions).
**Outputs:** a sequence rendered in-engine from the game's own assets in the ink-sketch mode.
**Edge cases:** skipping mid-sequence; reduced motion holds frames instead of moving the camera; every
aspect ratio from phone portrait to ultrawide.
**Failure:** a cutscene that fails to load is skipped and its captions are shown as a card.

### Saves

**Purpose:** progress is never lost.
**Experience:** autosave at every wave clear, heart upgrade and planet end; resume mid-planet from
the last checkpoint.
**Inputs:** simulation state (serialisable by design), campaign state, settings.
**Outputs:** a versioned save envelope in IndexedDB with a localStorage fallback; export and import.
**Edge cases:** private browsing refuses storage (warn once and continue); version migrations;
idempotent receipts, so a reload never pays twice (v3).
**Failure:** a failed save offers retry and export, and travel to the next planet waits for a
successful save (v3).

### Onboarding and difficulty

**Purpose:** teaches one system at a time and lets players choose the challenge.
**Experience:** planet 1 guides towers, crystals and the heart; each later planet introduces at most
one system: drafts on planet 2, weapons in depth on 3, disasters on 4, mounts on 5, walls and
crafting on 6. Three difficulties: Story, Standard and Veteran.
**Inputs:** planet index, difficulty, tutorial flags.
**Outputs:** system gates, contextual prompts, difficulty multipliers.
**Edge cases:** skipping the tutorial releases every gate at once; difficulty changes only between
planets; the first-planet guide holds the first wave until the first heart upgrade (v3).
**Failure:** a tutorial step that cannot complete times out and releases its hold (v3).

### Audio

**Purpose:** sound that confirms every action and carries the mood.
**Experience:** your tech is tuned, mechanical and short with a metallic transient; the Xeno is
detuned and breathy with no pitch centre; the heart is warm and sustained, the only long tail (v3);
music thins outside the frontier and swells for the boss.
**Inputs:** simulation and UI events, frontier state, wave state, settings.
**Outputs:** procedural WebAudio effects (layered synthesis, pre-rendered to buffers where cheaper),
adaptive music stems generated by code, spatial panning.
**Edge cases:** the frequency gate (a sound that happens a hundred times a match is quiet and dry,
v3); voice limits per family; mobile audio unlock on first touch; mute on N.
**Failure:** an audio context that cannot start leaves the game silent with a settings hint.

## Numbers and tuning

Initial values. The competent bot at M2 and M3 tunes them against the targets in the first table;
the owner's playtests overrule the bot.

### Session and planet

| Value | Number | Rationale |
|---|---|---|
| Planet duration target | 25 to 35 min | Owner decision |
| Planet radius, standard | 160 m | Half the circumference is 503 m, about 72 s at run speed: the far side is a real trip but not a slog |
| Planet radius, small and large | 130 m and 190 m | Size classes on the route map shift a planet's length by about 4 min either way |
| Worldheart levels | 10 | v3; level 10 claims the whole planet |
| Starting frontier | 12 m arc radius | v3 |
| Frontier angle at level L | a0 + (PI - a0) x (L / 10)^2.35, with a0 = 12 m / radius | v3 curve: early levels stay tight to defend, late levels claim large regions |
| Waves per planet, typical | 18 to 24 | Follows from the wave interval over about 25 min of play |
| Planet generation budget | 4 s on the RTX 4080 laptop, 8 s on Iris Xe | v3 was measured at 10 s and more; long loads break a 30-minute session |

### Worldheart ladder

| Level | Cost (credit first, then gold) | Tower mark cap | Rationale |
|---|---|---|---|
| 0 | 0 | II | v3 |
| 1 | 180 | III | v3 |
| 2 | 280 | IV | v3 |
| 3 | 420 | V | v3 |
| 4 | 620 | VI | v3 |
| 5 | 880 | VII | v3 |
| 6 | 1,200 | VIII | v3 |
| 7 | 1,600 | IX | v3 |
| 8 | 2,100 | X | v3 |
| 9 | 2,700 | XI | v3 |
| 10 | 3,400 | XII | v3; the full ladder costs 13,380, most of a planet's income, so claiming the world is the planet's main purchase |

| Value | Number | Rationale |
|---|---|---|
| Heart integrity, level 0 | 2,000 | Five unattended Mites (7 attack x 2.8 campaign multiplier, one blow per second) take about 20 s to break it: a leak is an emergency, not an instant loss |
| Heart integrity per level | +300 | Keeps pace with rising wave damage |
| Heart regeneration | 0 per second | Integrity is a resource you spend by leaking; powers can add regeneration |

### Commander

| Value | Number | Rationale |
|---|---|---|
| Walk speed | 3.2 m/s | Careful movement and aiming |
| Run speed | 7.0 m/s | 2.7 times v3's 2.6 m/s, which playtests found sluggish; crossing the starting ring takes under 2 s |
| Sprint speed | 10.0 m/s | Travel beyond the frontier without a mount |
| Time to full run speed | 0.18 s | Responsive without snapping |
| Time to stop | 0.12 s | Stops feel planted |
| Gravity | 24 m/s squared | Snappier jump arcs than real gravity at this scale |
| Jump height | 1.6 m | Clears rocks and low walls, never towers |
| Jump buffer | 150 ms | A press just before landing still jumps |
| Coyote time | 120 ms | A press just after leaving a ledge still jumps |
| Dodge distance and duration | 4.5 m over 0.45 s | Clears a Husk's reach in one roll |
| Dodge invulnerability | 0.06 s to 0.34 s | Rewards timing against a 0.25 s to 0.6 s wind-up |
| Dodge cooldown | 0.6 s | Stops chain-dodging through every telegraph without a stamina bar |
| Respawn inside and outside the frontier | 12 s and 30 s | Dying far out costs a wave's worth of attention |
| Cargo capacity | 3 crystals (4 with a talent) | v3 |
| Speed penalty at full cargo | 10% | v3 |
| Build reach in commander views | 14 m | v3 |

| Archetype | Health | Power | Movement | Rationale |
|---|---|---|---|---|
| Bulwark | 1,400 | 1.15 | 0.92 | v3: heavy cleave, the sturdy starter |
| Twinfang | 1,050 | 0.90 | 1.22 | v3: fast pair of blades |
| Longsight | 900 | 1.00 | 1.08 | v3: hitscan rifle, range over health |
| Kettle | 1,150 | 1.25 | 0.88 | v3: arcing lobber, splash |
| Emberline | 1,000 | 1.08 | 1.00 | v3: channelled beam |

### Combat feel

| Value | Number | Rationale |
|---|---|---|
| Hit-stop, light and heavy | 55 ms and 90 ms | Readable contact without stalling the flow |
| Strike frame, cleave, twin strike, lob | 0.40, 0.34, 0.42 of the swing | v3 timings |
| Commander skill cooldowns | Bulwark ward 24 s, Twinfang dash 16 s, Longsight focus 22 s, Kettle blast 28 s, Emberline field 30 s | v3 |
| Weapon skill cooldowns | sword cleave 12 s, spear lunge 13 s, twinblade cadence 18 s, carbine railshot 14 s, lobber siege shell 18 s, scepter heat vent 20 s | v3 |
| Enemy attack multiplier in the campaign | 2.8 | v3 |
| Largest share of health one player strike can remove | 85% | v3: no blow deletes a healthy body |

### Towers

| Tower | Cost | Hits air | MK I | MK II | MK III | Rationale |
|---|---|---|---|---|---|---|
| Bolt Sentinel | 150 | yes | 9 dmg, 4.6/s, 10.9 m | 15 dmg, 5.2/s, 11.3 m, 15% crit | 24 dmg, 6.0/s, 11.7 m, 25% crit | v3 |
| Cryo Bloom | 200 | yes | 38% slow, 7.1 m | 48%, 7.5 m | 55%, 8.0 m, brittle | v3 |
| Mortar Bastion | 250 | no | 34 dmg, 0.48/s, 13.4 m, 2.3 m splash | 56, 0.52/s, 13.8 m, 2.7 m | 88, 0.56/s, 14.3 m, 3.1 m, two shells | v3 |
| Arc Spire | 300 | yes | 30 dmg, 1.5 s charge, 3 chains | 46, 1.35 s, 4 | 68, 1.2 s, 6 | v3 |
| Helios Lance | 500 | yes | 26 dps, ramps to 3x over 2.0 s | 42, 1.7 s, 3x | 64, 1.4 s, 3.5x | v3 |
| Warden Barracks | 220 | no | 2 wardens, 7 s | 3, 6 s | 5, 5 s | v3 |

| Value | Number | Rationale |
|---|---|---|
| Critical multiplier | 2.2 | v3 |
| Ladder past MK III | cost x1.5 per mark, power exponent 1.5 | v3: each step costs more and buys proportionally less |
| Sell refund | 70% (90% with Salvage) | v3 |
| Height reach bonus | 1 + min(0.6, height x 0.02) | v3 |
| Specialization cost | equal to the MK III upgrade cost | The choice replaces a numeric upgrade rather than adding a new currency |
| Terrain affinity | hot stone +15% Mortar damage, cold stone +10% Cryo slow | v3 values, now bonuses rather than restrictions |
| Applied slow cap in the campaign | 70% | v3 |

### Enemies

| Species | Health | Speed | Armour | Bounty | Attack | Blow to blow | Wind-up | Reach | Rationale |
|---|---|---|---|---|---|---|---|---|---|
| Mite | 26 | 3.1 m/s | 0 | 6 | 7 | 1.00 s | 0.25 s | 1.2 m | v3 |
| Husk | 85 | 1.85 m/s | 0 | 12 | 11 | 1.40 s | 0.40 s | 1.3 m | v3 |
| Aegis | 340 | 1.1 m/s | 6 | 32 | 16 | 1.60 s | 0.45 s | 1.4 m | v3 |
| Wisp (flies at 2.6 m) | 52 | 2.5 m/s | 0 | 14 | 6 | 1.10 s | 0.30 s | 1.6 m | v3 |

### Waves and nests

| Value | Number | Rationale |
|---|---|---|
| Time between wave starts | 55 s + 1 s per wave, at most 80 s | About 21 waves in 25 min; late waves get room for longer marches |
| Early call bonus | 0.6 gold per second remaining x (1 + 0.05 x wave) | Calling wave 1 with 40 s left pays 25 gold, a sixth of a Bolt Sentinel |
| Enemy health growth | x1.08 per wave, steeper past wave 20 | v3 |
| Enemy melee growth | 35% of the health curve, at most 4x | v3 |
| Wave reward | 70 + 9 x wave gold | v3 |
| Evolution waves | 4, 8, 12, 16 | v3 used 3, 6, 9, 12 across 15 waves; respaced for about 21 |
| New nests per wave | 1, or 2 on waves 5, 10 and 15 | v3 |
| Nest warning | 3 s | v3 |
| Nest bounty | 180 gold | v3 |
| Wandering packs outside the frontier | at most 2 alive, spawned at least 40 m beyond it | Exploration carries danger without flooding the wild |

### Economy and loot

| Value | Number | Rationale |
|---|---|---|
| Starting gold | 450 | v3 |
| Crystal credit | 100 per crystal | v3 |
| Crystal sites | 2 per expansion, 24 at most, 9 m apart | v3 |
| Weapon drop chance | 2% ordinary, 10% Aegis, 100% boss | v3 |
| Rarity weights | Common 68%, Uncommon 22%, Rare 7.5%, Epic 2%, Relic 0.5% | v3 |
| Backpack and equipped slots | 12 and 2 | v3 |
| Auto-pickup radius | 2.8 m | v3 |
| Scrap per salvaged weapon | 1 | v3 |
| Coins per cleared wave | 3 + floor(wave / 4) | 113 coins from a 21-wave planet (63 base plus 50 from the step), about one tier-1 talent per planet early on |
| Coins per planet won | 40 + 2 x planet index | 42 on planet 1, about a third of the wave coins, so winning matters but losing still progresses |

### Drafts and meta

| Value | Number | Rationale |
|---|---|---|
| Hand size | 3 (4 with a talent) | v3 |
| Tower card offer | choose 1 of 2 | Adds a decision to v3's random draw at no extra complexity |
| Power offer | choose 1 of 3 | v3 |
| Power weights | 100 common, 45 uncommon, 14 rare | v3 |
| Stacking | additive into a base of 1 | v3 guard |
| Minimum price after modifiers | 25% | v3 |
| Talent tiers | 4 | v3 |

### Planet boss

| Value | Number | Rationale |
|---|---|---|
| Awakening warning | 10 s | Enough to return to the heart from mid-territory at sprint speed |
| Phases | 2 on planets 1 to 20, 3 from planet 21 | Complexity rises with the campaign |
| Health | 5,000 x (1 + 0.15 x (planet index - 1))^1.1 | About a 3 to 5 minute fight on planet 1 against a competent build |
| Heart damage from a boss blow | 25% of maximum integrity | v3 removed half on contact; a telegraphed blow at a quarter leaves room to answer |

### Mounts

| Mount | Land speed | Water speed | Weapon damage | Rationale |
|---|---|---|---|---|
| Ridge Strider | 1.65x | 0.7x | 80% | v3 |
| Tideback | 1.2x | 2.4x | 90% | v3 |
| Sky Ray | 1.35x, 12 s of flight | glides | 65% | v3 |

### Walls, crafting and disasters

| Value | Number | Rationale |
|---|---|---|
| Wall cost | 1 scrap for 5 segments | v3 |
| Wall segment health | 180 | v3 |
| Forge price | 3, 5, 7 scrap and so on | v3 |
| Merge | 3 identical weapons to the next rarity, capped at Rare | v3 |
| Disaster warning | 8 s | v3 |
| Hostility range | 0.15 to 0.60 on planet 1, 0.80 to 1.60 on planet 99 | v3 |
| Calm interval | 150 / (0.65 + hostility) s, at least 38 s | v3 |
| Radiation storm tower stop | 8 s | v3 |

### Performance budgets

| Value | High (RTX 4080 laptop, 1440p) | Medium (Iris Xe, 1080p) | Low (mid-range phone) | Rationale |
|---|---|---|---|---|
| Target frame rate | 60 fps | 60 fps | 30 fps or better | Approved in design section 1 |
| Draw calls | under 400 | under 250 | under 150 | Instancing and batching keep crowds cheap |
| Triangles on screen | under 2.5 M | under 1.0 M | under 400 k | Silhouettes carry the look, not density |
| Texture memory | under 600 MB | under 300 MB | under 160 MB | Compressed textures and per-theme loading |
| Live enemies | 400 | 250 | 120 | Vertex animation textures for crowds |
| First load | under 25 MB | under 25 MB | under 25 MB | Themes and later families stream in |

### Render defaults

Starting values, replaced by the dial values the owner locks at the style check.

| Dial | Start | Rationale |
|---|---|---|
| Light bands | 3 | Enough to model form; fewer reads flat, more reads smooth |
| Band edge softness | 0.06 | A crisp edge that still anti-aliases |
| Brush noise on the terminator | 0.12 | Breaks the shadow edge into strokes without speckle |
| Paint texture strength | 0.85 | v3's 1.3.2 recipe ran texture at 1.5 on flatter assets; baked paint needs less |
| Saturation | 1.3 | v3 1.3.2 |
| Shadow depth | 0.35 | v3 1.3.2 |
| Exposure | 0.77 | v3 1.3.2 |
| Hull ink width | 2.2 px at 1080p, clamped 1.2 to 4 px | Borderlands-bold at gameplay distance without swallowing small enemies |
| Edge pass fade | 60 m to 180 m | Terrain creases read near, vanish before they become moire |
| Rim light | 0.35 | Separates characters from terrain in coloured shadow |
| Bloom threshold and intensity | 1.0 and 0.6 | Only energy and hazards bloom |
| Film grain | 0.04 | Painterly texture without noise |

## Content: planets and families

Every family has an inspection view that shows all of it at once and can open any one member,
reachable by URL. Counts in these tables must equal `public/assets/manifest.json`.

### Planet themes

| Theme | Ground palette | Key light | Shadow tint | Signature landform | Boss affinity | Milestone |
|---|---|---|---|---|---|---|
| Verdant Highlands | jade meadow, moss, warm grey stone | amber, 35 degrees | teal | ranges with passes, rivers | Colossus | M0 style scene, M2 |
| Dune Sea | ochre and cream sand, rust rock | white-gold, 60 degrees | lilac | dune fields, buttes, dry canyons | Wyrm | M2 |
| Glacier Reach | blue-white ice, slate | rose-gold, 12 degrees | ultramarine | glaciers, ice bridges, crevasses | Titan | M2 |
| Ember Rift | basalt charcoal, ash, orange magma veins | red-gold, 25 degrees | violet | calderas, lava channels, fissures | Colossus or Titan | M2 |
| Tidal Archipelago | turquoise shallows, pale sand, green islands | noon white, 70 degrees | deep ultramarine | islands, atolls, sea stacks | Leviathan | M2 |
| Amber Steppe | golden grass, rust maples, cream rock | late-afternoon orange, 20 degrees | cool blue | rolling hills, escarpments | Matriarch | M2 |

Planned for M8, bringing the count to 12 or more: Ashen Moon (airless, black sky), Storm Plateau,
Mire Hollows, Karst Jungle, Aurora Tundra, and Shattered Reach (floating rock platforms, v3's space
battlefield as a planet type). v3's ten terrain packs (Mixed Landscapes, Giant Peaks, Deep Canyons,
Ocean World, Badlands, Karst Labyrinth, Geothermal Fields, Glacial Frontiers, Windlands, Sky Reaches)
combine with themes. Inspection view: **Planet Lab** (`/labs/planets.html?theme=&pack=&seed=`), with
Play this seed.

### Towers and specializations

| Tower | Verb | Specialization A | Specialization B |
|---|---|---|---|
| Bolt Sentinel | rapid single-target rails, hits air | Rail Lance: rails pierce in a line | Flak Crown: bursts shred flyers and groups |
| Cryo Bloom | slowing aura, ground and air | Stasis Bloom: periodic full freeze pulses | Brittle Bloom: frosted enemies take more damage |
| Mortar Bastion | lobbed splash, ground only | Siege Battery: a three-shell barrage | Cinder Pit: craters burn |
| Arc Spire | charged chain lightning with a stun | Storm Crown: more chains | Thunder Maul: one heavy bolt, long stun |
| Helios Lance | beam that ramps on one target | Prism Array: the beam splits to three | Sun Needle: ramps to 5x on one target |
| Warden Barracks | summons wardens who hold ground | Phalanx Hall: more, tougher wardens | Vanguard Lodge: fewer elite hunters |

Inspection view: **Asset Gallery** (`/labs/gallery.html?family=towers`), every mark and
specialization side by side at first-person, third-person and strategic distance.

### Xeno species and evolutions

Mite, Husk, Aegis and Wisp (v3), each with four evolution overlays (armour, speed, shield, split).
Inspection view: Asset Gallery (`?family=xeno`), with every animation playable.

### Commanders and allies

Bulwark, Twinfang, Longsight, Kettle and Emberline (v3), all visored, on one shared skeleton; the
Warden. Inspection view: Asset Gallery (`?family=commanders`) and the M1 test course
(`/labs/course.html`).

### Weapons

| Axis | Members | Rationale |
|---|---|---|
| Families | Sword, Spear, Twinblade, Carbine, Lobber, Scepter | v3's six; three melee, three ranged or channelled |
| Manufacturers | Anvil (forged steel, slow and brutal, knockback), Filament (precise tech, crits and reach, cyan filaments), Hollow (Xeno salvage in bone-white chitin rewired in cyan, life steal), Kiln (ancient fired stone and bronze, echo strikes and ricochets) | Four identities you can read from silhouette alone, as Borderlands does |
| Part slots | head or barrel, core, grip, guard or stock, charm or sight | Five slots give variety without a parts inventory |
| Rarity materials | Common wood, Uncommon iron, Rare gold, Epic diamond, Relic onyx | v3 mapping; material instead of a colour avoids clashing with cyan, gold and magenta |
| Elements | Ember (burns 3 s), Frost (slows 2 s), Arc (chains and stuns), Shatter (breaks armour) | v3 burn and frost timings; magenta stays reserved for the Xeno |
| Eras | Ancient on planets 1 to 33, Tech on 34 to 66, Empowered on 67 to 99 | v3 |

Naming grammar: an adjective from the defining part or element plus the family noun (Searing
Carbine), with the manufacturer shown as a badge; each Relic has its own two-word name. Inspection
view: **Weapon Forge** (`/labs/forge.html?family=&maker=&rarity=&seed=`).

### Planet bosses

| Archetype | Body plan | Signature attacks | Theme affinity |
|---|---|---|---|
| Colossus | a giant walker | stomp shockwaves, sweeping arm, thrown boulders | Verdant Highlands, Ember Rift |
| Wyrm | a burrowing serpent | erupting lunge, tail sweep, sand or lava spray | Dune Sea |
| Leviathan | a sky or sea giant | diving pass, barrage from above, tidal slam | Tidal Archipelago |
| Matriarch | a hive mother | summons broods, acid pools, spawning nests | Amber Steppe |
| Titan | a crystal or stone golem | ground beams, shield phases, crystal spikes | Glacier Reach, Ember Rift |

Each boss is an archetype, the planet's element, four to six attack modules from its archetype's
library, and two or three phases. Naming grammar: a theme word plus the archetype (Rime Titan,
Cinder Wyrm). Inspection view: **Boss Lab** (`/labs/bosses.html?theme=&archetype=&seed=`).

### Structures, mounts and disasters

Structures: Outpost Ruin, Crashed Lander, Ancient Shrine, Dead Hive (v3 had four families). Mounts:
Ridge Strider, Tideback, Sky Ray (v3). Disasters: Tornado, Quake, Lightning Storm, Tsunami,
Eruption, Radiation Storm (v3), plus Blizzard and Sandstorm as theme weather. Inspection views: Asset
Gallery for structures and mounts; Planet Lab's disaster trigger for disasters.

### Style

Inspection view: **Style Lab** (`/labs/style.html`), the style scene with live dials, the reference
board, and the colour audit.

## Interface and HUD

**Visual language.** Painted-ink panels: dark painted ink washes with brush-edged borders drawn as
9-slice frames, text on solid backplates so it always reads. Tokens: ink `#14161d`, paper
`#efe6d2`, cyan `#59f2ff` (the one interface accent, for player energy, selection and focus), gold
`#ffc857` (economy only), danger `#ff5470` (damage and loss only). Magenta belongs to the Xeno in the
scene and never appears in interface chrome. No pure black or white. Fonts: Barlow Condensed for
display and numerals, Inter for body text. HUD motion stays under 300 ms and animates only transform
and opacity. Anything that happens a hundred times a match (shots, kills, coin ticks) changes
instantly with no animation (v3 frequency gate). Reduced motion is honoured in CSS and JS.

**Screens.**

1. **Title.** A live painted planet turning in the game's own renderer; Continue, New campaign,
   Planet Lab, Settings.
2. **Hangar**, between planets. The commander on a turntable; loadout (starting tower card, two
   weapons from the stash); the talent tree; the route map.
3. **Route map.** A painted star chart; planet cards show a theme swatch, size, hostility, boss
   silhouette and reward bias.
4. **Planet, Strategic view.**
   - Top centre: the wave pill (WAVE 7, countdown, live nests) and Call wave with its bonus.
   - Top left: the Worldheart panel (integrity bar, level, next cost with credit applied, B).
   - Left: gold, base credit, scrap, and crystals carried (0/3).
   - Bottom centre: the hand (tower cards on 1 to 4) and walls (J).
   - Bottom right: a small globe minimap (territory, nests, crystals, commander, cargo cache).
   - A tower panel anchored to the selected tower: mark, upgrade cost, sell value, priority, and the
     specialization choice at mark III.
5. **Planet, commander views.** Health and skill cooldowns (Z, V) bottom left; weapon slots bottom
   right; the crosshair; a compass strip across the top (home, cargo cache, nests, crystals); the
   hand stays usable within build reach.
6. **Draft overlay.** Two tower cards or three powers, mechanics first, one line of flavour.
7. **Inventory (I).** Two equipped slots, twelve backpack slots, weapon cards with comparison arrows.
8. **Pause and settings.** Graphics tier and the advanced render dials; camera feel sliders (lens,
   pitch, pan and zoom sensitivity, as in v3); audio; controls; accessibility (reduced motion,
   telegraph patterns that do not rely on red alone, text size).
9. **Victory, defeat and extraction** summaries.
10. **Cutscene player** with skip.

**Keyboard and mouse.** Carried from v3 where v3 had a binding; new actions take free keys.

| Input | Strategic view | Commander views |
|---|---|---|
| WASD or arrows | pan | move |
| Mouse | select, drag to pan | look |
| Wheel | zoom | first and third person |
| Tab | take the commander | return to the Strategic view (refused outside the frontier) |
| Left click | build, select, possess | attack (hold for heavy) |
| Right click | order the selection, cancel | aim (ranged families) |
| Shift | | sprint |
| Space | pause | jump |
| Ctrl | | dodge |
| Q | rotate view left | lock-on |
| E | rotate view right | interact (chests, structures) |
| Z and V | | commander skill and weapon skill |
| X | sell the selected tower | swap weapon slots |
| U | upgrade the selected tower | |
| 1 to 4 | pick a tower card | pick a tower card (build within 14 m) |
| J | walls | walls |
| B | raise the Worldheart | raise the Worldheart |
| T | forge a tower card at the heart | forge a tower card at the heart |
| I | inventory | inventory |
| G and H | | rally and dismiss wardens |
| M | | call or dismiss the mount |
| N | mute | mute |
| P | | pause |
| Esc | cancel, deselect | drop the build ghost, then open the menu |

**Touch.** A floating 136 px thumb pad under the landing finger; attack 80 px, jump 84 px, abilities
80 x 72 px, aim 64 px (v3); building, inventory and orders in drawers; safe-area insets; a mirrored
layout option (v3). Menus use 48 px targets.

## Build order

The renderer and asset work (Track A) and the game logic (Track B) run in parallel from M0 and meet
at the first rendered playable in M3. Every milestone ends with tests, bot runs, captured frames and a
live Pages link.

| Milestone | Track A: look and feel | Track B: game logic, headless | Gate |
|---|---|---|---|
| M0 | Repo, CI and Pages; Blender pipeline; renderer v1; style scene assets; Style Lab | Simulation kernel: fixed tick, seeded RNG streams, event log, save envelope, bot harness | Owner approves the look |
| M1 | Commander controller on a test planet; three cameras; animation state machine; basic combat and hit feedback | Planet generator v1, navigation graph, flow field, placement rule | Owner approves the feel |
| M2 | Planet rendering (terrain meshing, painting, scatter, sky) for 6 themes; Planet Lab; all tower and Xeno models | Towers, Xeno, nests and waves, economy, crystals, heart ladder, placeholder boss | The bot wins and loses a planet headless |
| M3 | Integration: the first rendered playable loop, HUD v1 | Balance pass from bot telemetry | Owner plays a full planet |
| M4 | Five commanders, skills, Wardens, possession, evolution visuals | Commander and ally logic, evolutions | |
| M5 | Weapon parts and Weapon Forge; structures and chests | Weapon generator, inventory, loot | |
| M6 | Boss parts and Boss Lab | Boss generator and attack library | |
| M7 | Route map, talent tree, hangar | Drafts, meta progression, campaign, saves | |
| M8 | Mounts, walls, disaster effects, themes to 12 or more | Mount, wall and disaster logic | |
| M9 | Full HUD and menus, touch controls, audio and music, ink cutscenes, onboarding | Onboarding gates, difficulty | |
| M10 | Balance, performance, accessibility, release | | |

The order of construction:

1. The first end-to-end playable: a complete planet played headless by the bot, from landfall
   through waves, crystals and all ten heart levels to the claim and a placeholder boss, ending in a
   win, plus a forced loss when the heart falls, each printing a result line. Track B builds it from
   M0 and it lands in M2, before any polish request.
2. The style check approved (M0 gate).
3. The feel approved (M1 gate).
4. A full planet played rendered by the owner (M3 gate).
5. Commanders and allies (M4).
6. Weapons and loot (M5).
7. Bosses (M6).
8. The campaign (M7).
9. World features (M8).
10. Presentation (M9).
11. Release (M10).

## Verification

"Done" means a frame or a result line that shows the behaviour, never code that reads right.

| Instrument | Command | Proves | When |
|---|---|---|---|
| Static checks | `npm run check` | types, lint, the simulation boundary, no em dash in any form | every commit, in CI |
| Unit tests | `npm test` | each mechanic's rules; every power and talent has a consumer | every commit |
| Determinism | `npm run test:determinism` | the same seed and inputs give the same state hash after 20,000 ticks | every commit |
| Bot runs | `npm run bot -- --planets 20` | three policies (competent, idle, reckless) win and lose planets; the competent bot finishes in 25 to 35 simulated minutes | milestone and nightly |
| Browser smoke | `npm run e2e` | every page boots without console errors; scripted input places a tower and runs a wave; frames saved | every pull request |
| Captures | `npm run capture` | every inspection page captured for review | milestone |
| Asset checks | `npm run assets:check` | triangle, bone and texture budgets; strike markers equal simulation timings; manifest counts equal Content | every asset change |
| Performance | `npm run perf` | frame time along a fixed camera path per tier on the development laptop | milestone |
| Blueprint gate | `blueprint.js check docs/blueprint.md --gate` | this document is complete | every commit |
| Agent play | the built-in browser | the agent plays the change and attaches frames | every change |
| Owner gates | the live Pages link | the look (M0), the feel (M1), a full planet (M3), each later milestone | milestone |

## Decided

| Decision | Status | Evidence |
|---|---|---|
| Browser game: TypeScript, Three.js on WebGL2, Vite, GitHub Pages | not yet | owner choice, 2026-09-23 |
| Repository majieddd/99-planets-to-defend-v4, public | partial | repository created holding this blueprint, 2026-09-23 |
| Approach A: painted assets, shader lighting, two-pass ink | not yet | owner choice, 2026-09-23 |
| Every asset built by script in Blender 5.2.1 | not yet | owner requirement, 2026-09-23 |
| Stylized, visored commanders | not yet | owner choice, 2026-09-23 |
| Every v3 system returns, staged by milestone for quality | not yet | owner choice, 2026-09-23 |
| A planet takes 25 to 35 minutes | not yet | owner choice, 2026-09-23 |
| The boss wakes when the whole planet is claimed | not yet | owner brief, 2026-09-23 |
| Death outside the frontier drops a cargo cache and respawns; only the heart falling ends a planet | not yet | owner choice, 2026-09-23 |
| Keyboard and mouse plus touch are first-class inputs | not yet | owner choice, 2026-09-23 |
| Core fiction kept, told through ink-sketch cutscenes | not yet | owner choice, 2026-09-23 |
| Commander run speed 7 m/s with dodge, buffers, lock-on and hit-stop | not yet | approved improvement, 2026-09-23 |
| Tower specialization at mark III | not yet | approved improvement, 2026-09-23 |
| Borderlands-style weapons: family, manufacturer, parts, rarity, element | not yet | approved improvement, 2026-09-23 |
| Themed bosses from archetype, element and attack modules | not yet | approved improvement, 2026-09-23 |
| Route choice between two or three planets | not yet | approved improvement, 2026-09-23 |
| One new system per planet over the first six planets | not yet | approved improvement, 2026-09-23 |
| Every power and talent has a test proving its effect | not yet | approved improvement, 2026-09-23 |
| Crystals deposit automatically in the heart's aura | not yet | added while writing this spec; awaits owner review |
| Enemies strike the heart with telegraphed blows instead of subtracting lives | not yet | added while writing this spec; awaits owner review |
| Terrain affinity gives bonuses instead of restrictions | not yet | added while writing this spec; awaits owner review |
| Tower card draft offers a choice of two | not yet | added while writing this spec; awaits owner review |
| A second death before reclaiming the cargo cache loses it | not yet | added while writing this spec; awaits owner review |
| Per-tower target priority | not yet | added while writing this spec; awaits owner review |
| Story, Standard and Veteran difficulties | not yet | added while writing this spec; awaits owner review |
| Wandering packs outside the frontier | not yet | added while writing this spec; awaits owner review |
| Gamepad as a first-class input | dropped | owner selected keyboard and mouse plus touch, 2026-09-23 |
| Whole-screen painterly post filter (approach B) | dropped | owner chose approach A, 2026-09-23 |
| v3's Apophis and Earth-first prologue told verbatim | dropped | owner chose a new telling of the core fiction, 2026-09-23 |
| v3's run-ending death outside the frontier | dropped | owner chose the cargo cache rule, 2026-09-23 |
| v3 classic maps (Pocket World, Giant World, Titan's Brow) | not yet | candidates for Planet Lab sandbox play after M10 |
| Co-op or multiplayer | not yet | the pure simulation keeps it possible |

## Task list

- [ ] Owner reviews this blueprint, including the eight details marked "awaits owner review"
- [ ] Write the M0 implementation plan (writing-plans), then dispatch through the Chief Orchestrator
- [ ] Toolchain: Vite, strict TypeScript, Three.js, Vitest, Playwright, ESLint with the simulation
      boundary rule, an em dash check covering all four forms
- [ ] CI workflow and the GitHub Pages deploy
- [ ] Blender pipeline: headless runner, shared libraries (paint bake, rig, animate, export),
      manifest, turntable sheets, asset checks
- [ ] Renderer v1: painted lighting material, hull ink, screen-space edge ink, fog and sky, bloom and
      grade, quality tiers
- [ ] Style scene assets: Bulwark (idle, run, attack), Bolt Sentinel marks I to III, Husk (walk,
      attack), Worldheart, nest, Verdant kit (rocks, flora, grass cards), brush atlas
- [ ] Style Lab with live dials, the reference board and the colour audit
- [ ] Simulation kernel: fixed tick, seeded RNG streams, event log, save envelope, bot harness
- [ ] Owner style gate; lock the Painted-Anime-Inkline 4.0 defaults
- [ ] Owner: choose a license (none yet, so all rights are reserved by default)

## Where we are

2026-09-23. The design was approved in brainstorming: the platform, approach A, design sections 1 to
4, and the cargo cache death rule. The repository holds this blueprint and a README, and no code yet.
Blender 5.2.1 LTS portable is installed at `C:\Users\Majied LaFleur\tools\blender-5.2.1` (checksum
verified against blender.org, 915 MB); portable 4.5.1 and 4.3.2 installs were already present in the
same folder. The local OpenViking knowledge base
was not running. Next: the owner reviews this blueprint, then the M0 implementation plan is written
and dispatched.
