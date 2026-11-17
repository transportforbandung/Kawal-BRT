(() => {
  'use strict';

  const ROUTING_URL = 'https://router.project-osrm.org/route/v1/driving';
  const NEAREST_URL = 'https://router.project-osrm.org/nearest/v1/driving';
  const DEFAULT_STOP_RADIUS_METERS = 12;
  const MAX_ROAD_CANDIDATES = 8;
  const ROUTE_SNAP_RADIUS_METERS = 5;
  const GROUP_COLORS = {
    'On-Corridor': '#e67e22',
    'Off-Corridor': '#1672a5',
    'End-Station': '#76a51d',
  };
  const elements = {
    savedRoutes: document.getElementById('saved-routes'),
    loadRoute: document.getElementById('load-route'),
    routeName: document.getElementById('route-name'),
    routeRef: document.getElementById('route-ref'),
    stopRadius: document.getElementById('stop-radius'),
    roadChoices: document.getElementById('road-choices'),
    roadChoiceStop: document.getElementById('road-choice-stop'),
    roadChoiceList: document.getElementById('road-choice-list'),
    cancelRoadChoice: document.getElementById('cancel-road-choice'),
    fileHint: document.getElementById('file-hint'),
    stopSearch: document.getElementById('stop-search'),
    stopList: document.getElementById('stop-list'),
    stopCount: document.getElementById('stop-count'),
    distance: document.getElementById('route-distance'),
    duration: document.getElementById('route-duration'),
    undo: document.getElementById('undo-stop'),
    clear: document.getElementById('clear-route'),
    save: document.getElementById('save-route'),
    status: document.getElementById('status'),
    mapError: document.getElementById('map-error'),
  };

  const map = L.map('map').setView([-6.91, 107.62], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const stopLayer = L.layerGroup().addTo(map);
  const stopBufferLayer = L.layerGroup().addTo(map);
  const roadCandidateLayer = L.layerGroup().addTo(map);
  const routeLayer = L.geoJSON(null, {
    style: { color: '#b63e32', weight: 5, opacity: 0.88 },
  }).addTo(map);
  let stopsById = new Map();
  let selectedStops = [];
  let selectedStopRadii = [];
  let selectedSnaps = [];
  let routeCoordinates = [];
  let pendingStopId = null;
  let pendingStopRadius = null;
  let pendingCandidates = [];
  let routeDistance = 0;
  let routeDuration = 0;
  let routing = false;
  let currentFile = '';

  function setStatus(message, kind = '') {
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
  }

  async function requestJSON(url, options) {
    const response = await fetch(url, options);
    const body = await response.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      data = null;
    }
    if (!response.ok) {
      const detail = data?.error || data?.message || body.trim().slice(0, 240);
      const code = data?.code ? ` [${data.code}]` : '';
      const error = new Error(`Request failed (${response.status})${code}${detail ? `: ${detail}` : ''}`);
      error.code = data?.code;
      throw error;
    }
    if (!data) {
      throw new Error('The server returned an invalid JSON response.');
    }
    return data;
  }

  function stopName(stop) {
    return stop.properties.Nama || '(Unnamed stop)';
  }

  function getRouteRef(name) {
    const match = name.match(/\bBRT[\s_-]*([0-9]{1,3}[A-Za-z]?)(?=$|[^0-9A-Za-z])/i);
    return match ? match[1] : '';
  }

  function updateRouteRef() {
    elements.routeRef.value = getRouteRef(elements.routeName.value.trim());
  }

  function stopLatLng(stop) {
    return [stop.geometry.coordinates[1], stop.geometry.coordinates[0]];
  }

  function getStopRadius() {
    const radius = Number(elements.stopRadius.value);
    if (!Number.isInteger(radius) || radius < 1 || radius > 100) {
      throw new Error('Stop buffer must be a whole number between 1 and 100 meters.');
    }
    return radius;
  }

  function renderStops() {
    const search = elements.stopSearch.value.trim().toLocaleLowerCase();
    const visibleGroups = new Set(
      [...document.querySelectorAll('[data-group]:checked')].map(input => input.dataset.group),
    );
    stopLayer.clearLayers();
    for (const stop of stopsById.values()) {
      const { _stop_group: group, _stop_id: id } = stop.properties;
      if (!visibleGroups.has(group) || !stopName(stop).toLocaleLowerCase().includes(search)) continue;
      const color = GROUP_COLORS[group];
      const marker = L.circleMarker(stopLatLng(stop), {
        radius: group === 'On-Corridor' ? 6 : 5,
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.88,
        bubblingMouseEvents: false,
      });
      marker.bindTooltip(stopName(stop), { direction: 'top', offset: [0, -5] });
      marker.on('click', () => addStop(id));
      marker.addTo(stopLayer);
    }
  }

  function updateRouteLayer() {
    routeLayer.clearLayers();
    if (routeCoordinates.length >= 2) {
      routeLayer.addData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: routeCoordinates },
      });
    }
  }

  function updateStopBuffers() {
    stopBufferLayer.clearLayers();
    selectedStops.forEach((id, index) => {
      const stop = stopsById.get(id);
      if (!stop) return;
      const radius = selectedStopRadii[index] || DEFAULT_STOP_RADIUS_METERS;
      L.circle(stopLatLng(stop), {
        radius,
        color: '#b63e32',
        weight: 1,
        dashArray: '4 4',
        fillColor: '#d96b57',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(stopBufferLayer);
    });
  }

  async function routeBetween(start, end) {
    const coordinates = `${start.location[0]},${start.location[1]};${end.location[0]},${end.location[1]}`;
    const params = new URLSearchParams({
      overview: 'full',
      geometries: 'geojson',
      steps: 'false',
      radiuses: `${ROUTE_SNAP_RADIUS_METERS};${ROUTE_SNAP_RADIUS_METERS}`,
      hints: `${start.hint || ''};${end.hint || ''}`,
    });
    const url = `${ROUTING_URL}/${coordinates}?${params}`;
    let result;
    try {
      result = await requestJSON(url, { signal: AbortSignal.timeout(30000) });
    } catch (error) {
      if (error.code === 'NoSegment') {
        throw new Error('OSRM could not match the selected road candidate. Choose another candidate or increase the stop buffer.');
      }
      if (error.code === 'NoRoute') {
        throw new Error('No drivable route connects these snapped road points. Try a different stop or routing service.');
      }
      throw new Error(`OSRM routing failed: ${error.message}`);
    }
    if (result.code !== 'Ok' || !result.routes?.length) {
      if (result.code === 'NoSegment') {
        throw new Error('OSRM could not match the selected road candidate. Choose another candidate or increase the stop buffer.');
      }
      throw new Error(result.message || 'The routing service found no route between these stops.');
    }

    const route = result.routes[0];
    const segment = route.geometry?.coordinates;
    const waypoints = result.waypoints;
    if (!Array.isArray(segment) || segment.length < 2 || !Array.isArray(waypoints) || waypoints.length !== 2) {
      throw new Error('The routing service returned an incomplete route segment.');
    }
    if (waypoints[0].distance > ROUTE_SNAP_RADIUS_METERS) {
      throw new Error('OSRM moved the start away from the selected road candidate. Choose another candidate.');
    }
    if (waypoints[1].distance > ROUTE_SNAP_RADIUS_METERS) {
      throw new Error('OSRM moved the destination away from the selected road candidate. Choose another candidate.');
    }
    return {
      route,
      segment,
      start: { location: waypoints[0].location, hint: waypoints[0].hint || start.hint || '' },
      end: { location: waypoints[1].location, hint: waypoints[1].hint || end.hint || '' },
    };
  }

  async function findRoadCandidates(stop, radius) {
    const [longitude, latitude] = stop.geometry.coordinates;
    const params = new URLSearchParams({
      number: String(MAX_ROAD_CANDIDATES),
      radiuses: String(radius),
    });
    const url = `${NEAREST_URL}/${longitude},${latitude}?${params}`;
    let result;
    try {
      result = await requestJSON(url, { signal: AbortSignal.timeout(30000) });
    } catch (error) {
      if (error.code === 'NoSegment') {
        throw new Error(`No drivable road was found within ${radius} m of this stop. Increase the buffer and try again.`);
      }
      throw new Error(`Could not find nearby road candidates: ${error.message}`);
    }

    if (result.code !== 'Ok' || !Array.isArray(result.waypoints)) {
      throw new Error(result.message || 'The routing service returned no road candidates.');
    }

    const candidates = [];
    const seen = new Set();
    result.waypoints.forEach(waypoint => {
      if (!Array.isArray(waypoint.location) || waypoint.location.length < 2) return;
      const key = waypoint.location.map(value => Number(value).toFixed(6)).join(',');
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        location: waypoint.location,
        hint: waypoint.hint || '',
        name: waypoint.name || 'Unnamed road',
        distance: waypoint.distance,
      });
    });
    if (!candidates.length) {
      throw new Error(`No drivable road was found within ${radius} m of this stop. Increase the buffer and try again.`);
    }
    return candidates;
  }

  function clearRoadCandidates() {
    pendingStopId = null;
    pendingStopRadius = null;
    pendingCandidates = [];
    elements.roadChoiceList.replaceChildren();
    elements.roadChoices.hidden = true;
    roadCandidateLayer.clearLayers();
  }

  function showRoadCandidates(stopId, radius, candidates) {
    pendingStopId = stopId;
    pendingStopRadius = radius;
    pendingCandidates = candidates;
    const stop = stopsById.get(stopId);
    elements.roadChoiceStop.textContent = `${stopName(stop)} — choose the road on the intended side of the median.`;
    elements.roadChoiceList.replaceChildren();
    roadCandidateLayer.clearLayers();

    candidates.forEach((candidate, index) => {
      const button = document.createElement('button');
      button.className = 'road-choice';
      button.type = 'button';
      const title = document.createElement('strong');
      title.textContent = `${index + 1}. ${candidate.name}`;
      const detail = document.createElement('span');
      detail.textContent = `${Math.round(candidate.distance)} m from stop · ${candidate.location[1].toFixed(5)}, ${candidate.location[0].toFixed(5)}`;
      button.append(title, detail);
      button.addEventListener('click', () => chooseRoadCandidate(index));
      elements.roadChoiceList.append(button);

      const marker = L.marker([candidate.location[1], candidate.location[0]], {
        icon: L.divIcon({
          className: 'road-candidate-icon',
          html: `<span class="${index === 0 ? 'is-nearest' : ''}">${index + 1}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      });
      marker.bindTooltip(`${index + 1}. ${candidate.name} · ${Math.round(candidate.distance)} m`, {
        direction: 'top',
      });
      marker.on('click', () => chooseRoadCandidate(index));
      marker.addTo(roadCandidateLayer);
    });

    elements.roadChoices.hidden = false;
    const bounds = L.latLngBounds([stopLatLng(stop), ...candidates.map(candidate => [
      candidate.location[1],
      candidate.location[0],
    ])]);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
  }

  function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  }

  function updateSummary() {
    elements.stopCount.textContent = String(selectedStops.length);
    elements.undo.disabled = routing || Boolean(pendingStopId) || selectedStops.length === 0;
    elements.save.disabled = routing || Boolean(pendingStopId) || selectedStops.length < 2 || routeCoordinates.length < 2;
    elements.distance.textContent = routeCoordinates.length ? formatDistance(routeDistance) : '—';
    elements.duration.textContent = routeCoordinates.length ? formatDuration(routeDuration) : '—';
    elements.stopList.replaceChildren();

    if (!selectedStops.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = 'Click a stop on the map to start.';
      elements.stopList.append(empty);
      return;
    }

    selectedStops.forEach((id, index) => {
      const stop = stopsById.get(id);
      const item = document.createElement('li');
      const number = document.createElement('span');
      number.className = 'stop-number';
      number.textContent = String(index + 1);
      const name = document.createElement('span');
      name.textContent = stop ? stopName(stop) : id;
      item.append(number, name);
      elements.stopList.append(item);
    });
  }

  async function addStop(id) {
    if (routing) return;
    if (pendingStopId) {
      setStatus('Choose a road candidate or cancel the current stop before adding another.');
      return;
    }
    const stop = stopsById.get(id);
    if (!stop) return;
    let radius;
    try {
      radius = getStopRadius();
    } catch (error) {
      setStatus(error.message, 'error');
      return;
    }
    if (selectedStops.at(-1) === id) {
      setStatus('That stop is already the last stop in this route.');
      return;
    }
    routing = true;
    updateSummary();
    setStatus(`Finding road candidates near ${stopName(stop)}…`, 'loading');
    try {
      const candidates = await findRoadCandidates(stop, radius);
      showRoadCandidates(id, radius, candidates);
      setStatus(`Choose the road candidate for ${stopName(stop)}.`, 'loading');
    } catch (error) {
      setStatus(`Could not prepare ${stopName(stop)}: ${error.message}`, 'error');
    } finally {
      routing = false;
      updateSummary();
    }
  }

  async function chooseRoadCandidate(index) {
    if (routing || !pendingStopId || !pendingCandidates[index]) return;
    const id = pendingStopId;
    const stop = stopsById.get(id);
    const candidate = pendingCandidates[index];

    if (!selectedStops.length) {
      selectedStops.push(id);
      selectedStopRadii.push(pendingStopRadius);
      selectedSnaps.push(candidate);
      clearRoadCandidates();
      updateSummary();
      updateStopBuffers();
      setStatus(`Start set to ${stopName(stop)} on ${candidate.name}. Choose the next stop.`);
      return;
    }

    const previousId = selectedStops.at(-1);
    const previous = stopsById.get(previousId);
    routing = true;
    updateSummary();
    setStatus(`Routing ${stopName(previous)} → ${stopName(stop)} via ${candidate.name}…`, 'loading');
    try {
      const routed = await routeBetween(selectedSnaps.at(-1), candidate);
      if (!routeCoordinates.length) routeCoordinates.push(...routed.segment);
      else routeCoordinates.push(...routed.segment.slice(1));
      selectedSnaps[selectedSnaps.length - 1] = routed.start;
      selectedSnaps.push(routed.end);
      selectedStopRadii.push(pendingStopRadius);
      selectedStops.push(id);
      routeDistance += routed.route.distance;
      routeDuration += routed.route.duration;
      clearRoadCandidates();
      updateRouteLayer();
      updateStopBuffers();
      setStatus(`Added ${stopName(stop)} via ${candidate.name}. Choose another stop or save the route.`, 'success');
    } catch (error) {
      setStatus(`Could not route to ${stopName(stop)} via ${candidate.name}: ${error.message} Choose another candidate or cancel.`, 'error');
    } finally {
      routing = false;
      updateSummary();
    }
  }

  function cancelRoadCandidate() {
    if (routing) return;
    clearRoadCandidates();
    setStatus('Road selection cancelled. Click a stop to try again.');
  }

  function clearRoute() {
    if (routing) return;
    clearRoadCandidates();
    selectedStops = [];
    selectedStopRadii = [];
    selectedSnaps = [];
    routeCoordinates = [];
    routeDistance = 0;
    routeDuration = 0;
    currentFile = '';
    elements.savedRoutes.value = '';
    elements.routeName.value = '';
    elements.routeRef.value = '';
    elements.fileHint.textContent = 'Save creates GeoJSON and KML files and writes the route ref into selected stop DBFs. ZIP archives are not changed.';
    updateRouteLayer();
    updateStopBuffers();
    updateSummary();
    setStatus('Route cleared. Click a stop on the map to start.');
  }

  async function undoLastStop() {
    if (routing || !selectedStops.length) return;
    if (selectedStops.length === 1) {
      clearRoute();
      return;
    }

    const removedStop = selectedStops.pop();
    const removedRadius = selectedStopRadii.pop();
    const removedSnap = selectedSnaps.pop();
    const rebuiltCoordinates = [];
    const rebuiltSnaps = [selectedSnaps[0]];
    let distance = 0;
    let duration = 0;
    routing = true;
    updateSummary();
    try {
      for (let index = 1; index < selectedStops.length; index += 1) {
        const routed = await routeBetween(selectedSnaps[index - 1], selectedSnaps[index]);
        if (!rebuiltCoordinates.length) rebuiltCoordinates.push(...routed.segment);
        else rebuiltCoordinates.push(...routed.segment.slice(1));
        rebuiltSnaps[index - 1] = routed.start;
        rebuiltSnaps.push(routed.end);
        distance += routed.route.distance;
        duration += routed.route.duration;
      }
      routeCoordinates = rebuiltCoordinates;
      selectedSnaps = rebuiltSnaps;
      routeDistance = distance;
      routeDuration = duration;
      updateRouteLayer();
      setStatus('Removed the last stop and updated the route.');
    } catch (error) {
      selectedStops.push(removedStop);
      selectedStopRadii.push(removedRadius);
      selectedSnaps.push(removedSnap);
      setStatus(`Could not rebuild the route after undo: ${error.message}`, 'error');
    } finally {
      routing = false;
      updateSummary();
    }
    updateStopBuffers();
  }

  function safeFileName(name) {
    const normalized = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const slug = normalized.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 80);
    return `${slug || 'brt-route'}.geojson`;
  }

  async function saveRoute() {
    if (routing || selectedStops.length < 2 || routeCoordinates.length < 2) return;
    const name = elements.routeName.value.trim();
    if (!name) {
      elements.routeName.focus();
      setStatus('Enter a route name before saving.', 'error');
      return;
    }
    const ref = getRouteRef(name);
    if (!ref) {
      elements.routeName.focus();
      setStatus('Route name must include a BRT route number, for example “BRT 19: Cibiru – Dago”.', 'error');
      return;
    }

    const route = {
      type: 'Feature',
      properties: {
        name,
        ref,
        stop_ids: [...selectedStops],
        stop_names: selectedStops.map(id => stopName(stopsById.get(id))),
        stop_radii_m: [...selectedStopRadii],
        stop_snap_coordinates: selectedSnaps.map(snap => snap.location),
        stop_radius_m: selectedStopRadii.at(-1) || DEFAULT_STOP_RADIUS_METERS,
        distance_m: Math.round(routeDistance),
        duration_s: Math.round(routeDuration),
        routing_service: 'OSRM',
      },
      geometry: { type: 'LineString', coordinates: routeCoordinates },
    };
    const filename = currentFile || safeFileName(name);
    elements.save.disabled = true;
    setStatus('Saving route to the project…', 'loading');
    try {
      const result = await requestJSON(`/api/route?file=${encodeURIComponent(filename)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/geo+json' },
        body: JSON.stringify(route),
      });
      currentFile = result.file;
      elements.fileHint.textContent = `Saved ${currentFile} and ${result.kml_file}; selected stops now reference route ${ref}.`;
      setStatus(`Saved GeoJSON and KML; updated ${result.updated_stops} stop SHP feature(s) with ref ${ref}.`, 'success');
      try {
        await refreshRoutes(currentFile);
        const stopCollection = await requestJSON('/api/stops');
        stopCollection.features.forEach(feature => {
          const existing = stopsById.get(feature.properties?._stop_id);
          if (existing) existing.properties.ref = feature.properties.ref || '';
        });
        renderStops();
      } catch (refreshError) {
        setStatus(`Route files were saved, but the editor could not refresh its lists: ${refreshError.message}`, 'error');
      }
    } catch (error) {
      setStatus(`Could not save route: ${error.message}`, 'error');
    } finally {
      updateSummary();
    }
  }

  async function refreshRoutes(selectFile = '') {
    const routes = await requestJSON('/api/routes');
    elements.savedRoutes.replaceChildren();
    const newOption = document.createElement('option');
    newOption.value = '';
    newOption.textContent = 'New route';
    elements.savedRoutes.append(newOption);
    routes.forEach(route => {
      const option = document.createElement('option');
      option.value = route.file;
      option.textContent = route.name;
      elements.savedRoutes.append(option);
    });
    elements.savedRoutes.value = selectFile;
  }

  async function loadRoute() {
    const filename = elements.savedRoutes.value;
    if (!filename) {
      clearRoute();
      return;
    }
    if (routing) return;
    setStatus('Loading saved route…', 'loading');
    try {
      const feature = await requestJSON(`/api/route?file=${encodeURIComponent(filename)}`);
      if (feature.type !== 'Feature' || feature.geometry?.type !== 'LineString') {
        throw new Error('Saved file is not a route LineString.');
      }
      const ids = feature.properties?.stop_ids;
      if (!Array.isArray(ids) || ids.length < 2 || ids.some(id => !stopsById.has(id))) {
        throw new Error('Some route stops are no longer in the stop datasets. The route file was not changed.');
      }
      selectedStops = [...ids];
      const storedRadii = feature.properties.stop_radii_m;
      const fallbackRadius = Number(feature.properties.stop_radius_m) || DEFAULT_STOP_RADIUS_METERS;
      selectedStopRadii = Array.isArray(storedRadii) && storedRadii.length === ids.length
        ? storedRadii.map(radius => Number(radius) || fallbackRadius)
        : ids.map(() => fallbackRadius);
      routeCoordinates = feature.geometry.coordinates;
      const storedSnaps = feature.properties.stop_snap_coordinates;
      selectedSnaps = Array.isArray(storedSnaps) && storedSnaps.length === ids.length
        ? storedSnaps.map(location => ({ location, hint: '' }))
        : ids.map((id, index) => ({
          location: index === ids.length - 1
            ? routeCoordinates.at(-1)
            : stopsById.get(id).geometry.coordinates,
          hint: '',
        }));
      elements.stopRadius.value = String(selectedStopRadii.at(-1) || DEFAULT_STOP_RADIUS_METERS);
      routeDistance = Number(feature.properties.distance_m) || 0;
      routeDuration = Number(feature.properties.duration_s) || 0;
      currentFile = filename;
      clearRoadCandidates();
      elements.routeName.value = feature.properties.name || filename.replace(/\.geojson$/i, '');
      elements.routeRef.value = feature.properties.ref || getRouteRef(elements.routeName.value);
      elements.fileHint.textContent = `Saving updates ${filename} in dataset/BRT-Route/Created-Routes/.`;
      updateRouteLayer();
      updateStopBuffers();
      updateSummary();
      map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
      setStatus(`Loaded ${elements.routeName.value}. Add stops, undo the last stop, or save your changes.`, 'success');
    } catch (error) {
      setStatus(`Could not load route: ${error.message}`, 'error');
    }
  }

  async function initialize() {
    elements.mapError.hidden = true;
    try {
      const collection = await requestJSON('/api/stops');
      collection.features.forEach(feature => {
        const id = feature.properties?._stop_id;
        if (typeof id !== 'string' || feature.geometry?.type !== 'Point') return;
        stopsById.set(id, feature);
      });
      renderStops();
      updateSummary();
      await refreshRoutes();
      setStatus(`Loaded ${stopsById.size} bus stops. Click one to begin.`);
      if (!stopsById.size) throw new Error('No bus stops were found in the project datasets.');
    } catch (error) {
      elements.mapError.hidden = false;
      elements.mapError.textContent = `Could not start the route editor: ${error.message}. Make sure you launched it with tools/routes_editor/server.py.`;
      setStatus(error.message, 'error');
    }
  }

  elements.stopSearch.addEventListener('input', renderStops);
  elements.routeName.addEventListener('input', updateRouteRef);
  elements.stopRadius.addEventListener('change', () => {
    try {
      const radius = getStopRadius();
      if (pendingStopId && radius !== pendingStopRadius) {
        clearRoadCandidates();
        setStatus('Buffer changed. Click the stop again to find candidates within the new buffer.');
      }
      if (selectedStops.length === 1 && routeCoordinates.length === 0) {
        selectedStopRadii[0] = radius;
        updateStopBuffers();
      }
    } catch (error) {
      elements.stopRadius.value = String(DEFAULT_STOP_RADIUS_METERS);
      setStatus(error.message, 'error');
    }
  });
  document.querySelectorAll('[data-group]').forEach(input => input.addEventListener('change', renderStops));
  elements.undo.addEventListener('click', undoLastStop);
  elements.clear.addEventListener('click', clearRoute);
  elements.cancelRoadChoice.addEventListener('click', cancelRoadCandidate);
  elements.save.addEventListener('click', saveRoute);
  elements.loadRoute.addEventListener('click', loadRoute);
  elements.savedRoutes.addEventListener('change', () => {
    elements.loadRoute.disabled = routing;
  });
  initialize();
})();
