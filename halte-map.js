// halte-map.js
// Embedded interactive halte map for KawalBRT (kawalbrt.transportforbandung.org)
// Adapted from brtroute.transportforbandung.org source (basemap.js, bus-stop-display.js, routedisp.js)
// Handles point (halte) layers and optionally line (route) layers.

(function () {
  'use strict';

  // ─── Configuration ────────────────────────────────────────────────────────

  const MAP_CENTER = [-6.9104, 107.6183];
  const MAP_ZOOM = 11;
  const MAP_ID = 'halte-map';

  // Point layer configs — add more objects here for additional halte datasets
  const pointLayerConfigs = [
    {
      id: 'off-corridor',
      name: 'Halte Off-Corridor',
      filePath: 'dataset/Off-Corridor-Stops/Off-Corridor-Stops.geojson',
      defaultEnabled: true,
      // Style per Type value. Fallback used when Type is unrecognised.
      typeStyles: {
        'Bus Pole': { radius: 5, color: '#00568E', fillColor: '#00568E', fillOpacity: 0.85, weight: 1.5 },
        'Small Shelter': { radius: 6, color: '#007A3D', fillColor: '#00A651', fillOpacity: 0.85, weight: 1.5 },
        'Big Shelter': { radius: 7, color: '#B8860B', fillColor: '#FFCA0A', fillOpacity: 0.95, weight: 2 },
      },
      fallbackStyle: { radius: 5, color: '#888888', fillColor: '#aaaaaa', fillOpacity: 0.7, weight: 1 },
    },
    {
      id: 'on-corridor',
      name: 'Halte On-Corridor',
      filePath: 'dataset/On-Corridor-Stops/On-Corridor-Stops.geojson',
      defaultEnabled: true,
      typeStyles: {
        'On-Corridor Type A': { radius: 9, color: '#d82b00', fillColor: '#d82b00', fillOpacity: 0.9, weight: 2 },
        'On-Corridor Type B': { radius: 9, color: '#007A3D', fillColor: '#00A651', fillOpacity: 0.9, weight: 2 },
        'On-Corridor Type C': { radius: 9, color: '#B8860B', fillColor: '#FFCA0A', fillOpacity: 0.9, weight: 2 },
        'On-Corridor Type D': { radius: 9, color: '#6A5ACD', fillColor: '#9370DB', fillOpacity: 0.9, weight: 2 },
        'On-Corridor Type E': { radius: 9, color: '#8B0000', fillColor: '#FF6347', fillOpacity: 0.9, weight: 2 },
        'On-Corridor Type F': { radius: 9, color: '#2F4F4F', fillColor: '#708090', fillOpacity: 0.9, weight: 2 },
      },
      fallbackStyle: { radius: 9, color: '#00568E', fillColor: '#5BACD4', fillOpacity: 0.8, weight: 1.5 },
    },
    {
      id: 'end-station',
      name: 'Halte End Station',
      filePath: 'dataset/End-Stations/End-Stations.geojson',
      defaultEnabled: true,
      typeStyles: {
        'End-Station': { radius: 9, color: '#addd00', fillColor: '#addd00', fillOpacity: 0.9, weight: 2 }
      },
      fallbackStyle: { radius: 9, color: '#00568E', fillColor: '#5BACD4', fillOpacity: 0.8, weight: 1.5 },
    },
  ];

  // Line layer configs — BRT routes loaded from KML files in dataset/BRT-Route/.
  // Each route has two directions (A→B and B→A) loaded as separate KML files.
  // Format: 'kmlFiles' is an array of KML paths to merge into a single layer.
  const lineLayerConfigs = [
    { id: 'brt-01', name: 'BRT 01: Cibiru–Kalapa', color: '#E63946', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 01_ Cibiru → Kalapa.kml', 'dataset/BRT-Route/BRT 01_ Kalapa → Cibiru.kml'] },
    { id: 'brt-02', name: 'BRT 02: Lembang–Kalapa', color: '#457B9D', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 02_ Kalapa → Lembang.kml', 'dataset/BRT-Route/BRT 02_ Lembang → Kalapa.kml'] },
    { id: 'brt-03', name: 'BRT 03: Leuwipanjang–Dago via Dipatiukur', color: '#2A9D8F', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 03_ Dago → Dipatiukur → Leuwipanjang.kml', 'dataset/BRT-Route/BRT 03_ Leuwipanjang → Dipatiukur → Dago.kml'] },
    { id: 'brt-04', name: 'BRT 04: Elang–Riau', color: '#E9C46A', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 04_ Elang → Riau.kml', 'dataset/BRT-Route/BRT 04_ Riau → Elang.kml'] },
    { id: 'brt-05', name: 'BRT 05: Ciroyom–Antapani–Pajajaran', color: '#F4A261', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 05_ Antapani → Pajajaran → Ciroyom.kml', 'dataset/BRT-Route/BRT 05_ Ciroyom → Pajajaran → Antapani.kml'] },
    { id: 'brt-06', name: 'BRT 06: Cibaduyut–Leuwipanjang–Dago', color: '#264653', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 06_ Cibaduyut → Leuwipanjang → Dago.kml', 'dataset/BRT-Route/BRT 06_ Dago → Leuwipanjang → Cibaduyut.kml'] },
    { id: 'brt-07', name: 'BRT 07: Padalarang–Alun-alun Bandung', color: '#6A4C93', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 07_ Alun-alun Bandung → Padalarang.kml', 'dataset/BRT-Route/BRT 07_ Padalarang → Alun-alun Bandung.kml'] },
    { id: 'brt-08', name: 'BRT 08: Cimahi–Cicaheum', color: '#1982C4', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 08_ Cicaheum → Cimahi.kml', 'dataset/BRT-Route/BRT 08_ Cimahi → Cicaheum.kml'] },
    { id: 'brt-09', name: 'BRT 09: Ledeng–Antapani', color: '#8AC926', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 09_ Antapani → Ledeng.kml', 'dataset/BRT-Route/BRT 09_ Ledeng → Antapani.kml'] },
    { id: 'brt-10', name: 'BRT 10: Cicaheum–Kalapa via Binong', color: '#FF595E', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 10_ Cicaheum → Kalapa.kml', 'dataset/BRT-Route/BRT 10_ Kalapa → Cicaheum.kml'] },
    { id: 'brt-11', name: 'BRT 11: Tegalluar–Stasiun Hall', color: '#6A0572', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 11_ Stasiun Hall → Tegalluar.kml', 'dataset/BRT-Route/BRT 11_ Tegalluar → Stasiun Hall.kml'] },
    { id: 'brt-12', name: 'BRT 12: Soreang–Terminal Tegallega', color: '#B5838D', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 12_ Soreang → Terminal Tegallega.kml', 'dataset/BRT-Route/BRT 12_ Terminal Tegallega → Soreang.kml'] },
    { id: 'brt-13', name: 'BRT 13: Jatinangor–Elang', color: '#FF6B35', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 13_ Elang → Jatinangor.kml', 'dataset/BRT-Route/BRT 13_ Jatinangor → Elang.kml'] },
    { id: 'brt-14', name: 'BRT 14: Majalaya–Baleendah–Leuwipanjang', color: '#004E89', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 14_ Leuwipanjang → Baleendah → Majalaya.kml', 'dataset/BRT-Route/BRT 14_ Majalaya → Baleendah → Leuwipanjang.kml'] },
    { id: 'brt-15', name: 'BRT 15: Banjaran–Baleendah–BEC', color: '#00A676', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 15_ BEC → Baleendah → Banjaran.kml', 'dataset/BRT-Route/BRT 15_ Banjaran → Baleendah → BEC.kml'] },
    { id: 'brt-16', name: 'BRT 16: Sarijadi–Antapani', color: '#D62828', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 16_ Antapani → Sarijadi.kml', 'dataset/BRT-Route/BRT 16_ Sarijadi → Antapani.kml'] },
    { id: 'brt-17', name: 'BRT 17: Cicaheum–Sarijadi', color: '#3A86FF', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 17_ Cicaheum → Sarijadi.kml', 'dataset/BRT-Route/BRT 17_ Sarijadi → Cicaheum.kml'] },
    { id: 'brt-18', name: 'BRT 18: Jatinangor–Dipatiukur', color: '#9B5DE5', weight: 3.5, opacity: 0.85, defaultEnabled: false,
      kmlFiles: ['dataset/BRT-Route/BRT 18_ Dipatiukur → Jatinangor.kml', 'dataset/BRT-Route/BRT 18_ Jatinangor → Dipatiukur.kml'] },
  ];

  // ─── State ────────────────────────────────────────────────────────────────

  let halteMap = null;
  const pointLayers = new Map(); // id → { layer: L.GeoJSON, config, enabled }
  const lineLayers = new Map(); // id → { layer: L.LayerGroup, config, enabled }
  const dataCache = new Map(); // filePath → parsed GeoJSON

  // Active filter — null means "show all"
  let activeTypeFilter = new Set();// e.g. 'Bus Pole'
  let activeWilayahFilter = null; // e.g. 'Kota Bandung'
  let activePriorityFilter = false; // true = show only priority_2026 === 'yes'
  let pointLayersVisible = true;

  // ─── Map initialisation ───────────────────────────────────────────────────

  function syncHalteMapFullscreenButton() {
    const btn = document.getElementById('halte-map-fullscreen-btn');
    if (!btn) return;

    const isFullscreen = Boolean(document.fullscreenElement);
    btn.classList.toggle('is-active', isFullscreen);
    btn.setAttribute('aria-pressed', String(isFullscreen));
    btn.setAttribute('aria-label', isFullscreen ? 'Tutup layar penuh' : 'Buka peta layar penuh');
    const label = btn.querySelector('span');
    if (label) {
      label.textContent = isFullscreen ? 'Keluar layar penuh' : 'Layar penuh';
    }
  }

  function bindHalteMapFullscreenControl() {
    const btn = document.getElementById('halte-map-fullscreen-btn');
    const shell = document.querySelector('.halte-map-shell');
    if (!btn || !shell) return;

    btn.addEventListener('click', event => {
      event.preventDefault();
      if (!document.fullscreenElement) {
        shell.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      syncHalteMapFullscreenButton();
      if (halteMap) {
        setTimeout(() => halteMap.invalidateSize(), 80);
      }
    });

    syncHalteMapFullscreenButton();
  }

  function initHalteMap() {
    const el = document.getElementById(MAP_ID);
    if (!el) return;

    halteMap = L.map(MAP_ID, { zoomControl: true }).setView(MAP_CENTER, MAP_ZOOM);

    // Grayscale OSM tiles (same treatment as brtroute)
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> Contributors',
      maxZoom: 19,
    }).addTo(halteMap);

    tiles.on('tileload', function (e) {
      e.tile.style.filter = 'grayscale(100%)';
    });

    // Load all configured layers
    pointLayerConfigs.forEach(config => loadPointLayer(config));
    // Only auto-load line layers that default to enabled; others are lazy-loaded on click
    lineLayerConfigs.filter(c => c.defaultEnabled).forEach(config => loadLineLayer(config));

    // Wire up filter controls once map is ready
    bindFilterControls();
    bindHalteMapFullscreenControl();
  }

  // ─── GeoJSON fetch helper (cache-first) ───────────────────────────────────

  async function fetchGeoJSON(filePath) {
    if (dataCache.has(filePath)) return dataCache.get(filePath);
    const res = await fetch(filePath);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${filePath}`);
    const data = await res.json();
    dataCache.set(filePath, data);
    return data;
  }

  // ─── KML fetch + parse helper ─────────────────────────────────────────────
  // Parses KML <LineString> coordinates inside <MultiGeometry> or standalone.
  // Returns an array of coordinate arrays: [ [[lat,lng], …], … ]

  async function fetchKML(filePath) {
    if (dataCache.has(filePath)) return dataCache.get(filePath);
    const res = await fetch(filePath);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${filePath}`);
    const text = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, 'application/xml');
    const lines = xml.querySelectorAll('LineString coordinates');
    const polylines = [];
    lines.forEach(coordEl => {
      const raw = coordEl.textContent.trim();
      const coords = raw.split(/\s+/).map(triple => {
        const [lng, lat] = triple.split(',').map(Number);
        return [lat, lng]; // Leaflet uses [lat, lng]
      }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
      if (coords.length > 0) polylines.push(coords);
    });
    dataCache.set(filePath, polylines);
    return polylines;
  }

  // ─── Point (halte) layer loader ───────────────────────────────────────────

  async function loadPointLayer(config) {
    let data;
    try {
      data = await fetchGeoJSON(config.filePath);
    } catch (err) {
      console.warn(`[halte-map] Could not load ${config.filePath}:`, err.message);
      return;
    }

    const layer = L.geoJSON(data, {
      pointToLayer: (feature, latlng) => {
        const type = feature.properties?.Type || '';
        const style = config.typeStyles?.[type] ?? config.fallbackStyle;
        return L.circleMarker(latlng, style);
      },
      onEachFeature: (feature, marker) => {
        const p = feature.properties || {};
        marker.bindPopup(buildPointPopup(p), {
          maxWidth: 280,
          minWidth: 200,
          className: 'halte-popup',
        });
      },
      // Filter applied at render time
      filter: feature => featurePassesFilter(feature),
    });

    if (config.defaultEnabled) {
      layer.addTo(halteMap);
    }

    pointLayers.set(config.id, { layer, config, enabled: config.defaultEnabled });
  }

  // ─── Line (route) layer loader ─────────────────────────────────────────────
  // Supports: kmlFiles (array of KML paths), filePath (GeoJSON), or relationId (Overpass).

  async function loadLineLayer(config) {
    let layerGroup;
    try {
      if (config.kmlFiles && config.kmlFiles.length > 0) {
        layerGroup = await buildLineLayerFromKML(config);
      } else if (config.filePath) {
        layerGroup = await buildLineLayerFromFile(config);
      } else if (config.relationId) {
        layerGroup = await buildLineLayerFromOverpass(config);
      } else {
        console.warn(`[halte-map] No data source for line layer "${config.name}"`);
        return;
      }
    } catch (err) {
      // Fallback to Overpass if local load fails
      if (config.relationId) {
        try {
          layerGroup = await buildLineLayerFromOverpass(config);
        } catch (overpassErr) {
          console.warn(`[halte-map] Failed to load line layer "${config.name}":`, overpassErr.message);
          return;
        }
      } else {
        console.warn(`[halte-map] Failed to load line layer "${config.name}":`, err.message);
        return;
      }
    }

    if (config.defaultEnabled) {
      layerGroup.addTo(halteMap);
    }

    lineLayers.set(config.id, { layer: layerGroup, config, enabled: config.defaultEnabled });
  }

  // Build line layer from one or more KML files
  async function buildLineLayerFromKML(config) {
    const group = L.layerGroup();
    const lineStyle = {
      color: config.color || '#00568E',
      weight: config.weight || 4,
      opacity: config.opacity || 0.85,
    };

    for (const kmlPath of config.kmlFiles) {
      const polylines = await fetchKML(kmlPath);
      polylines.forEach(coords => {
        const line = L.polyline(coords, lineStyle);
        line.bindPopup(
          `<div class="halte-popup-inner">
            <div class="halte-popup-header">
              <span class="halte-popup-type-badge" style="background:${config.color}">Rute</span>
              <div class="halte-popup-name">${config.name}</div>
            </div>
          </div>`,
          { maxWidth: 260, minWidth: 180, className: 'halte-popup' }
        );
        line.addTo(group);
      });
    }
    return group;
  }

  async function buildLineLayerFromFile(config) {
    const data = await fetchGeoJSON(config.filePath);
    const group = L.layerGroup();
    data.features.forEach(f => {
      if (f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString') {
        L.geoJSON(f, {
          style: { color: config.color || '#00568E', weight: config.weight || 4, opacity: config.opacity || 0.85 }
        }).addTo(group);
      }
    });
    return group;
  }

  async function buildLineLayerFromOverpass(config) {
    const query = `[out:json];relation(${config.relationId});way(r);>;out geom;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();
    const group = L.layerGroup();
    data.elements.forEach(el => {
      if (el.type === 'way' && el.geometry) {
        L.polyline(
          el.geometry.map(p => [p.lat, p.lon]),
          { color: config.color || '#00568E', weight: config.weight || 4, opacity: config.opacity || 0.85 }
        ).addTo(group);
      }
    });
    return group;
  }

  // ─── Popup builder ────────────────────────────────────────────────────────

  function buildPointPopup(p) {
    const nama = p.Nama || p.name || '(Tanpa Nama)';
    const type = p.Type || '—';
    const kepemilikan = p.Kepemilikan || p.Milik || '—';
    const wilAdmin = p.Wil_Admin || '—';

    // Type badge colour mirrors the circleMarker palette
    const typeBadgeColor = {
      'Bus Pole': '#00568E',
      'Small Shelter': '#00A651',
      'Big Shelter': '#B8860B',
      'On-Corridor Type A': '#d82b00',
      'On-Corridor Type B': '#007A3D',
      'On-Corridor Type C': '#B8860B',
      'On-Corridor Type D': '#6A5ACD',
      'On-Corridor Type E': '#8B0000',
      'On-Corridor Type F': '#2F4F4F',
      'End-Station': '#addd00',
    }[type] || '#888888';

    return `
      <div class="halte-popup-inner">
        <div class="halte-popup-header">
          <span class="halte-popup-type-badge" style="background:${typeBadgeColor}">${type}</span>
          <div class="halte-popup-name">${nama}</div>
        </div>
        <div class="halte-popup-meta">
          <div class="halte-popup-row">
            <span class="halte-popup-label">Kewenangan Jalan</span>
            <span class="halte-popup-value">${kepemilikan}</span>
          </div>
          <div class="halte-popup-row">
            <span class="halte-popup-label">Wilayah Administrasi</span>
            <span class="halte-popup-value">${wilAdmin}</span>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Filter logic ─────────────────────────────────────────────────────────

  function featurePassesFilter(feature) {
    const p = feature.properties || {};
    const type = p.Type || '';
    const wil = p.Wil_Admin || '';

    if (activeTypeFilter.size > 0 && !activeTypeFilter.has(type)) return false;
    if (activeWilayahFilter && wil !== activeWilayahFilter) return false;
    if (activePriorityFilter && (p.priority_2026 || '').toLowerCase() !== 'yes') return false;
    return true;
  }

  // Re-draw all point layers respecting current filters.
  // GeoJSON layers don't support dynamic filtering natively, so we rebuild.
  function applyFilters() {
      pointLayers.forEach(({ layer, config, enabled }) => {
        if (!enabled) return;
        halteMap.removeLayer(layer);

        // Rebuild with new filter
        const newLayer = L.geoJSON(dataCache.get(config.filePath), {
          pointToLayer: (feature, latlng) => {
            const type = feature.properties?.Type || '';
            const style = config.typeStyles?.[type] ?? config.fallbackStyle;
            return L.circleMarker(latlng, style);
          },
          onEachFeature: (feature, marker) => {
            marker.bindPopup(buildPointPopup(feature.properties || {}), {
              maxWidth: 280, minWidth: 200, className: 'halte-popup',
            });
          },
          filter: f => featurePassesFilter(f),
        });

        if (pointLayersVisible) {
          newLayer.addTo(halteMap);
        }

        // Update stored reference so toggle controls still work
        pointLayers.set(config.id, { layer: newLayer, config, enabled });
      });

      syncSemuaButton();
      updateFilterCount();
    }
  // ─── Filter UI wiring ─────────────────────────────────────────────────────

  function bindFilterControls() {
    // Type filter checkboxes
    document.querySelectorAll('[data-halte-type-filter]').forEach(chk => {
      chk.addEventListener('change', () => {
        const val = chk.dataset.halteTypeFilter;
        if (chk.checked) {
          activeTypeFilter.add(val);
        } else {
          activeTypeFilter.delete(val);
        }
        applyFilters();
        updateStopDropdownLabel();
      });
    });

    // "Semua" button — activates all filters; goes idle when any is unclicked
    const semuaBtn = document.getElementById('halte-filter-semua');
    if (semuaBtn) {
      semuaBtn.addEventListener('click', () => {
        const allTypeVals = [...document.querySelectorAll('[data-halte-type-filter]')]
          .map(b => b.dataset.halteTypeFilter);

        const allActive = allTypeVals.every(v => activeTypeFilter.has(v));

        if (allActive) {
          activeTypeFilter.clear();
          document.querySelectorAll('[data-halte-type-filter]').forEach(chk => chk.checked = false);
        } else {
          allTypeVals.forEach(v => activeTypeFilter.add(v));
          document.querySelectorAll('[data-halte-type-filter]').forEach(chk => chk.checked = true);
        }

        applyFilters();
        updateStopDropdownLabel();
      });
    }

    // Wilayah dropdown
    const wilSelect = document.getElementById('halte-wilayah-filter');
    if (wilSelect) {
      wilSelect.addEventListener('change', () => {
        activeWilayahFilter = wilSelect.value || null;
        applyFilters();
      });
    }

    // Priority 2026 toggle
    const priorityBtn = document.getElementById('halte-priority-2026');
    if (priorityBtn) {
      priorityBtn.addEventListener('click', () => {
        activePriorityFilter = !activePriorityFilter;
        priorityBtn.classList.toggle('halte-filter-active', activePriorityFilter);
        applyFilters();
      });
    }

    // Hide/show bus stops
    const hideStopsBtn = document.getElementById('halte-toggle-haltes');
    if (hideStopsBtn) {
      hideStopsBtn.addEventListener('click', () => {
        pointLayersVisible = !pointLayersVisible;
        hideStopsBtn.textContent = pointLayersVisible ? 'Sembunyikan Halte' : 'Tampilkan Halte';
        hideStopsBtn.classList.toggle('halte-filter-active', !pointLayersVisible);

        pointLayers.forEach(({ layer, enabled }, id) => {
          if (pointLayersVisible && enabled) {
            layer.addTo(halteMap);
          } else {
            halteMap.hasLayer(layer) && halteMap.removeLayer(layer);
          }
        });

        if (pointLayersVisible) {
          applyFilters();
        }
      });
    }

    // Layer visibility toggles (one per pointLayerConfig + lineLayerConfig)
    document.querySelectorAll('[data-halte-layer-toggle]').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.dataset.halteLayerToggle;
        const pt = pointLayers.get(id);
        const ln = lineLayers.get(id);

        if (pt) {
          pt.enabled = chk.checked;
          chk.checked ? pt.layer.addTo(halteMap) : halteMap.removeLayer(pt.layer);
          pointLayers.set(id, pt);
        }
        if (ln) {
          ln.enabled = chk.checked;
          chk.checked ? ln.layer.addTo(halteMap) : halteMap.removeLayer(ln.layer);
          lineLayers.set(id, ln);
        }
      });
    });

    function updateStopDropdownLabel() {
      const label = document.getElementById('halte-stop-dropdown-label');
      if (!label) return;
      const activeCount = activeTypeFilter.size;
      if (activeCount === 0) {
        label.textContent = 'Semua Halte';
      } else if (activeCount === 1) {
        const type = [...activeTypeFilter][0];
        label.textContent = type;
      } else {
        label.textContent = `${activeCount} jenis aktif`;
      }
    }

    function updateRouteDropdownLabel() {
      const label = document.getElementById('halte-route-dropdown-label');
      if (!label) return;
      const activeRoutes = [...lineLayerConfigs].filter(c => lineLayers.get(c.id)?.enabled).map(c => c.name);
      if (activeRoutes.length === 0) {
        label.textContent = 'Tidak Ada Rute';
      } else if (activeRoutes.length === lineLayerConfigs.length) {
        label.textContent = 'Semua Rute';
      } else if (activeRoutes.length === 1) {
        label.textContent = activeRoutes[0];
      } else {
        label.textContent = `${activeRoutes.length} Rute`; 
      }
    }

    function syncRouteCheckboxes() {
      document.querySelectorAll('input[data-route-toggle]').forEach(chk => {
        const id = chk.dataset.routeToggle;
        chk.checked = !!lineLayers.get(id)?.enabled;
      });
      updateRouteDropdownLabel();
    }

    function createRouteDropdownItems() {
      const routeMenu = document.getElementById('halte-route-dropdown-menu');
      if (!routeMenu) return;
      routeMenu.querySelectorAll('.dropdown-item').forEach(item => item.remove());

      lineLayerConfigs.forEach(config => {
        const label = document.createElement('label');
        label.className = 'dropdown-item';
        label.setAttribute('role', 'menuitem');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.routeToggle = config.id;

        const colorDot = document.createElement('span');
        colorDot.className = 'route-color';
        colorDot.style.background = config.color;
        if (config.id === 'brt-13' || config.id === 'brt-14') {
          colorDot.style.border = '1.5px solid #00000010';
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'dropdown-item-label';
        textSpan.textContent = config.name;

        label.appendChild(checkbox);
        label.appendChild(colorDot);
        label.appendChild(textSpan);

        routeMenu.appendChild(label);
      });
    }

    function bindRouteDropdownControls() {
      createRouteDropdownItems();

      document.querySelectorAll('input[data-route-toggle]').forEach(chk => {
        chk.addEventListener('change', async () => {
          const id = chk.dataset.routeToggle;
          const config = lineLayerConfigs.find(c => c.id === id);
          if (!config) return;

          let entry = lineLayers.get(id);
          if (chk.checked) {
            if (!entry) {
              chk.disabled = true;
              const allRoutesBtn = document.getElementById('halte-route-toggle-all');
              allRoutesBtn?.classList.add('route-loading');
              await loadLineLayer({ ...config, defaultEnabled: true });
              chk.disabled = false;
              allRoutesBtn?.classList.remove('route-loading');
              entry = lineLayers.get(id);
            }
            if (entry && !entry.enabled) {
              entry.layer.addTo(halteMap);
              entry.enabled = true;
              lineLayers.set(id, entry);
            }
          } else if (entry && entry.enabled) {
            halteMap.removeLayer(entry.layer);
            entry.enabled = false;
            lineLayers.set(id, entry);
          }

          updateRouteDropdownLabel();
          const allRoutesBtn = document.getElementById('halte-route-toggle-all');
          const allActive = [...lineLayerConfigs].every(c => lineLayers.get(c.id)?.enabled);
          allRoutesBtn?.classList.toggle('halte-filter-active', allActive);
        });
      });
    }

    bindRouteDropdownControls();
    syncRouteCheckboxes();
    updateStopDropdownLabel();
    updateRouteDropdownLabel();

    // "Show all routes" / "Hide all routes" toggle
    const allRoutesBtn = document.getElementById('halte-route-toggle-all');
    if (allRoutesBtn) {
      allRoutesBtn.addEventListener('click', async () => {
        const anyActive = [...lineLayers.values()].some(e => e.enabled);

        if (anyActive) {
          // Hide all loaded routes
          lineLayers.forEach((entry, id) => {
            if (entry.enabled) {
              halteMap.removeLayer(entry.layer);
              entry.enabled = false;
              lineLayers.set(id, entry);
            }
          });
          document.querySelectorAll('input[data-route-toggle]').forEach(chk => chk.checked = false);
          allRoutesBtn.classList.remove('halte-filter-active');
        } else {
          // Load + show all routes
          allRoutesBtn.classList.add('route-loading');
          allRoutesBtn.disabled = true;
          for (const config of lineLayerConfigs) {
            let entry = lineLayers.get(config.id);
            if (!entry) {
              await loadLineLayer({ ...config, defaultEnabled: true });
              entry = lineLayers.get(config.id);
            }
            if (entry && !entry.enabled) {
              entry.layer.addTo(halteMap);
              entry.enabled = true;
              lineLayers.set(config.id, entry);
            }
          }
          document.querySelectorAll('input[data-route-toggle]').forEach(chk => chk.checked = true);
          allRoutesBtn.disabled = false;
          allRoutesBtn.classList.remove('route-loading');
          allRoutesBtn.classList.add('halte-filter-active');
        }

        updateRouteDropdownLabel();
      });
    }
  }

  // Update the visible count badge
  function updateFilterCount() {
    const badge = document.getElementById('halte-filter-count');
    if (!badge) return;
    let total = 0;
    pointLayers.forEach(({ layer }) => {
      if (layer) total += layer.getLayers().length;
    });
    badge.textContent = `${total} perhentian ditampilkan`;
  }

  function syncSemuaButton() {
    const semuaBtn = document.getElementById('halte-filter-semua');
    if (!semuaBtn) return;
    const allTypeVals = [...document.querySelectorAll('[data-halte-type-filter]')]
      .map(b => b.dataset.halteTypeFilter);
    const allActive = allTypeVals.length > 0 && allTypeVals.every(v => activeTypeFilter.has(v));
    semuaBtn.classList.toggle('halte-filter-active', allActive);
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHalteMap);
  } else {
    initHalteMap();
  }

})();