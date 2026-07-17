# Deliverista — methodology

A browser game that simulates an evening shift as an ebike food-delivery worker in Brownstone Brooklyn. This document explains what in the game is real, what is simulated and how the simulation works.

## What is real

All geographic data comes from OpenStreetMap, fetched from the Overpass API on July 17, 2026, for the bounding box 40.671–40.690 N, 74.001–73.972 W. That area covers Carroll Gardens, Cobble Hill, Boerum Hill, Gowanus and the western half of Park Slope.

- **Street network**: every drivable street (primary, secondary, tertiary, residential, living street and unclassified in OSM's classification) — about 2,800 intersections and 3,100 street segments. Geometry is projected to local meters with an equirectangular projection centered on the bounding box.
- **One-way directions**: taken from OSM `oneway` tags. Simulated cars respect them; the route hint for the player also respects them.
- **Traffic signals**: intersections with OSM `highway=traffic_signals` or `crossing=traffic_signals` nodes. Signal nodes within 30 meters are clustered into one controller per intersection.
- **Street names**: from OSM `name` tags, shown as the bottom-of-screen street label and used to build delivery addresses.
- **Restaurants**: all 526 named places tagged `restaurant`, `fast_food` or `cafe` in the area, with their real names, cuisine tags and locations.
- **Bike lanes**: streets with OSM `cycleway` tags are drawn with a green lane; primary streets are drawn with one by default, which overstates coverage slightly.

The raw Overpass responses and the processing script are in `data/`.

## What is simulated or invented

- **Traffic behavior**: cars spawn near the player, follow the street graph, prefer continuing straight, obey signals and yield to obstacles with a simple car-following rule. Volumes, speeds (roughly 15 mph on side streets, 25 mph on main streets) and signal timing (26-second cycles) are plausible but not calibrated to any measured data.
- **Signal phases**: each intersection alternates a north-south and an east-west green phase with a fixed offset. Real NYC signal timing is not modeled.
- **Parked cars, pedestrians, car doors**: procedurally generated. Door-opening hazards are random.
- **Delivery addresses**: the street name is real; the house number is invented (a hash of the intersection ID). No real address or household is depicted.
- **The economy**: base fee ($3 plus a per-distance component) and tips (a base drawn at random, scaled by delivery speed against the quote and food condition, with a rain bonus) are loosely modeled on published reporting about NYC app-delivery pay, but every number is invented. Nothing in the game reflects any real restaurant's order volume, wait times or customers.
- **Kitchen waits, battery drain, crash physics, tickets**: all invented for gameplay.
- **The clock**: one real second equals one game minute; a shift runs 6:00 PM to 2:00 AM in eight real minutes.

## Known simplifications

- Signal clustering can merge two closely spaced real intersections into one controller.
- Cars pick turns randomly (weighted toward continuing straight); they have no destinations.
- Pedestrian crossing behavior ignores signal state.
- Buildings are rendered as texture, not real footprints; the playable area is bounded by the data bounding box, so streets at the edge dead-end.

## License and attribution

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL). Everything else in this repository is by Josh Greenman, built with AI assistance (Claude).
