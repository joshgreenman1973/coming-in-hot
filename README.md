# Deliverista

A night on the streets of Brownstone Brooklyn. An ebike food-delivery sim on the real street grid of Carroll Gardens, Boerum Hill, Gowanus and Park Slope: real one-way streets, real traffic signals, 526 real restaurants. Pick up orders, ride through traffic, park, walk the food to the door and collect the tip before the quote runs out.

**Play it:** https://joshgreenman1973.github.io/deliverista-sim/

## Controls

- W / up arrow — throttle
- S / down arrow — brake, then reverse
- A / D or left / right arrows — steer
- E — park the bike, remount, interact
- Enter — accept an order; Esc — decline
- M — sound on/off

Touch controls appear on phones.

## The rules of the street

- Cars honk and brake, but they will hit you. Crashes shake the food, and shaken food shrinks the tip.
- Parked cars open doors. The door zone is real.
- Riding the sidewalk is slow, wobbly and hard on pedestrians.
- Running a red works until it doesn't.
- Rain nights: better tips, worse brakes.
- The battery fades over the shift. A dead battery means pedaling.

## Files

- `index.html`, `style.css`, `world.js`, `actors.js`, `game.js` — the game (no build step, no dependencies)
- `map.json` — compact street network + restaurants, built from OpenStreetMap
- `data/` — raw Overpass API responses and the processing script
- `METHODOLOGY.md` — what's real, what's simulated

Map data © OpenStreetMap contributors (ODbL).
