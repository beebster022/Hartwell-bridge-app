# Bridge Data Notes

Bridge records live in `data/bridges.json`.

The current app dataset was loaded from `Hartwell_Bridge_Master_Database_v2.xlsx`, sheet `Bridge Master Database`.

Map provider settings live in `data/settings.json`. To use Google Maps, add a restricted browser key to `googleMapsApiKey`. Keep this blank until the key is restricted to the live Netlify domain, because browser map keys are visible to visitors. If the key is blank or Google Maps fails to load, the app automatically uses the backup map provider so clearance checks, GPS sorting, bridge cards, and markers still work.

Each record keeps the original app fields (`name`, `road`, `waterway`, `lat`, `lon`) so older app logic and cached data continue to work. Newer, clearer fields sit beside them:

- `bridgeName`: display name for the physical bridge record.
- `roadName`: road, route, or local bridge name.
- `lakeArm`: lake arm, creek, river, or area.
- `lat` / `lon`: WGS84 decimal degrees for the marker location. These should point to the center of the bridge span over Lake Hartwell, not the road approach or nearby shoreline.
- `elev`: bridge elevation used in clearance calculations.
- `full`: clearance at full pool, based on 660 ft MSL.
- `coordinateSource`: source note used for the current coordinate.
- `coordinateNotes`: source or verification note from the master database.
- `clearanceNotes`: optional future note for clearance-specific details. The current dataset does not use this field.

To update a marker later:

1. Update the master spreadsheet first when possible.
2. Copy the bridge row into `data/bridges.json`.
3. Keep `lat` and `lon` as WGS84 decimal degrees for the center of the actual bridge span over navigable water.
4. Update `coordinateSource` and `coordinateNotes` so the next person knows where the number came from.
5. Run the local sanity checks before publishing so GPS sorting, map pins, and clearance calculations still work.
