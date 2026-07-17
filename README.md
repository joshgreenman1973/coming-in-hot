# Coming In Hot

A night as an ebike deliverista on the real streets of Brownstone Brooklyn: real one-way streets, real traffic signals, 14 real MTA bus lines, 526 real restaurants across Carroll Gardens, Boerum Hill, Gowanus and Park Slope. Take orders, follow the turn-by-turn GPS through traffic, park, walk the food to the door and collect the tip before the quote runs out.

**Play it:** https://joshgreenman1973.github.io/coming-in-hot/

Works on phones (touch controls appear automatically) and desktops.

## Controls

- W / up arrow — throttle; S / down — brake, then reverse
- A / D or left / right arrows — steer
- E — park the bike, remount, interact
- Enter / tap ACCEPT — take an order; Esc / PASS — decline
- V — flip between ride cam (driver's-eye, heading-up) and bird's eye (north-up)
- M — sound on/off

## The rules of the street

- Orders come in flavors: standard, 🔥 hot rush (short clock, fat tip), 🎉 big order (heavy, pays more) and 🥤 soup + drinks (fragile — every bump costs you).
- The GPS gives Google Maps-style turn-by-turn. Straying reroutes you.
- Cars brake and honk, but they will hit you. Buses are bigger than you.
- Parked cars open doors. The door zone is real.
- Riding the sidewalk is slow, wobbly and hard on pedestrians.
- Running a red works until it doesn't.
- Rain nights: better tips, worse brakes.

## Files

- `index.html`, `style.css`, `world.js`, `actors.js`, `game.js` — the game (no build step, no dependencies)
- `map.json` — compact street network, bus routes + restaurants, built from OpenStreetMap
- `data/` — raw Overpass API responses and the processing script
- `METHODOLOGY.md` — what's real, what's simulated

Map data © OpenStreetMap contributors (ODbL).
