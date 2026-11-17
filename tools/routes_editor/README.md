# Local BRT route editor

The route editor runs on your computer and saves routes directly into this project.
It reads stop locations from the project GeoJSON files, reads route refs from the
standalone shapefile DBFs, and requests road routes from the public OSRM demo
service, so an internet connection is required while routing.

## Run

From the project root, start the local server:

```powershell
py tools/routes_editor/server.py
```

Open <http://127.0.0.1:8765/tools/routes_editor/> in a browser. Keep the server
running while you use the editor; press `Ctrl+C` in its terminal when finished.

## Create or edit a route

1. Enter a route name, or load a previously saved route from the dropdown.
2. Click bus stops on the map in travel order. Each new stop is connected to the
   previous one using the OSRM driving profile and OpenStreetMap road data.
   The stop buffer defaults to 12 meters: OSRM lists drivable road candidates
   within the buffer. Choose the intended carriageway on the map, especially
   where a median separates opposing lanes. The route ends at that chosen road
   point instead of snapping to the nearest road automatically. If the intended
   carriageway is not listed, cancel the pending stop, increase the buffer,
   and click the stop again.
   The buffer is saved per stop.
3. Use **Undo last stop** to remove the route tail, or **Clear route** to start over.
4. Give the route a name containing its BRT number, such as `BRT 19: Cibiru – Dago`.
   The number becomes the route `ref`; saving writes a GeoJSON file and a KML
   containing that `ref` into `dataset/BRT-Route/Created-Routes/`.
5. Saving also adds the route ref to a `ref` attribute on each selected stop in
   the standalone On-Corridor, Off-Corridor, and End-Stations SHP datasets.
   If a stop is used by multiple routes, refs are stored as a semicolon-separated
   list. Existing route refs are retained when a route is edited; stops removed
   from that route have its old ref removed.

The stop SHP geometries are not changed. The matching `.dbf` sidecars are updated
directly so QGIS sees the new `ref` values. ZIP archives are deliberately not
updated; create a fresh archive from the standalone shapefile components if you
need to distribute the changed dataset as a ZIP.

The GeoJSON can be opened and edited in QGIS. A route with at least two stops is
required to save. OSRM's public demo service and OpenStreetMap tiles require
internet access and are subject to their own availability and usage policies.
