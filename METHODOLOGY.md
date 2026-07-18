# Coming In Hot — methodology

A browser game that simulates an evening shift as an ebike food-delivery worker in Brownstone Brooklyn. This document explains what in the game is real, what is simulated and how the simulation works.

## What is real

All geographic data comes from OpenStreetMap, fetched from the Overpass API on July 17, 2026, for the bounding box 40.671–40.690 N, 74.001–73.972 W. That area covers Carroll Gardens, Cobble Hill, Boerum Hill, Gowanus and most of Park Slope, including the 5th Avenue corridor. (Bounding box expanded July 17, 2026: 40.662–40.690 N, 74.001–73.968 W.)

- **Street network**: every drivable street (primary, secondary, tertiary, residential, living street and unclassified in OSM's classification) — about 2,800 intersections and 3,100 street segments. Geometry is projected to local meters with an equirectangular projection centered on the bounding box.
- **One-way directions**: taken from OSM `oneway` tags. Simulated cars respect them; the route hint for the player also respects them.
- **Traffic signals**: intersections with OSM `highway=traffic_signals` or `crossing=traffic_signals` nodes. Signal nodes within 30 meters are clustered into one controller per intersection.
- **Street names**: from OSM `name` tags, shown as the bottom-of-screen street label and used to build delivery addresses.
- **Restaurants**: all 746 named places tagged `restaurant`, `fast_food` or `cafe` in the area, at their real locations with their real cuisine tags. Their names are replaced with invented punny names in the game; no real restaurant name appears. Pickup points snap to the nearest street, since some OSM points sit mid-block.
- **Street names**: real, drawn along the streets and used in navigation and addresses.
- **Bus routes**: 14 local MTA lines (B25, B26, B37, B38, B41, B45, B52, B57, B61, B63, B65, B67, B69, B103) stitched from OSM `route=bus` relations, both directions where mapped. Express (X/SIM) routes that only pass through on the expressway are excluded. Bus stop spacing, dwell times, speeds and headways are invented.
- **Bike lanes**: streets with OSM `cycleway` tags are drawn with a green lane; primary streets are drawn with one by default, which overstates coverage slightly.

The raw Overpass responses and the processing script are in `data/`.

## What is simulated or invented

- **Traffic behavior**: cars spawn near the player, follow the street graph, prefer continuing straight, obey signals and yield to obstacles with a simple car-following rule. Volumes, speeds (roughly 15 mph on side streets, 25 mph on main streets) and signal timing (26-second cycles) are plausible but not calibrated to any measured data.
- **Signal phases**: each intersection alternates a north-south and an east-west green phase with a fixed offset. Real NYC signal timing is not modeled.
- **Parked cars, pedestrians, car doors**: procedurally generated. Door-opening hazards are random. Pedestrians cross at corners and jaywalk; some push strollers in the early evening. Sidewalk riding draws warnings, then $3 fines.
- **Buildings**: procedural brownstone-style lots drawn parallel to each street's frontage. They are not real building footprints.
- **Menu prices**: invented, banded by item type (drinks, sides, desserts, mains) to plausible NYC levels.
- **Delivery addresses**: the street name is real; the house number is invented (a hash of the intersection ID). No real address or household is depicted.
- **Order items and prices**: generated from small per-cuisine menus written for the game. They are not real menus.
- **Order types**: standard, rush, big and fragile orders vary the payout, deadline and food-damage multipliers. The mix is invented.
- **The economy**: base fee ($3 plus a per-distance component) and tips (a base drawn at random, scaled by order subtotal, delivery speed against the quote and food condition, with a rain bonus) are loosely modeled on published reporting about NYC app-delivery pay, but every number is invented. Nothing in the game reflects any real restaurant's order volume, wait times or customers.
- **Navigation**: the turn-by-turn GPS runs A* over the real street graph, respecting one-way directions. Distances and ETAs derive from that graph, not from any routing service.
- **Kitchen waits, crash physics, tickets, driving assists**: all invented for gameplay. A gentle lane-assist nudges the bike along the street when the player isn't steering.
- **The clock**: one real second equals one game minute; a shift runs 6:00 PM to 2:00 AM in eight real minutes.

## Known simplifications

- Signal clustering can merge two closely spaced real intersections into one controller.
- Cars pick turns randomly (weighted toward continuing straight); they have no destinations.
- Pedestrian crossing behavior ignores signal state.
- Buildings are rendered as texture, not real footprints; the playable area is bounded by the data bounding box, so streets at the edge dead-end.

## License and attribution

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL). Everything else in this repository is by Josh Greenman, built with AI assistance (Claude).
