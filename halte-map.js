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

  // Line layer configs — populate when route GeoJSON files are available.
  // Supports local GeoJSON (filePath) with optional Overpass fallback (relationId).
  // Each config can have both, one, or neither fallback — the loader tries in order.
  const lineLayerConfigs = [
    // Example:
    // {
    //   id:          'brt-route-7',
    //   name:        'BRT 7 – Padalarang–Alun-alun',
    //   color:       '#00568E',
    //   weight:      4,
    //   opacity:     0.85,
    //   filePath:    'dataset/Routes/BRT7/ways.geojson',   // local first
    //   relationId:  '12345678',                         // Overpass fallback
    //   defaultEnabled: false,
    // },
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

  // ─── Map initialisation ───────────────────────────────────────────────────

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
    lineLayerConfigs.forEach(config => loadLineLayer(config));

    // Wire up filter controls once map is ready
    bindFilterControls();
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
  // Tries local filePath first, then Overpass API if relationId is provided.

  async function loadLineLayer(config) {
    let layerGroup;
    try {
      layerGroup = config.filePath
        ? await buildLineLayerFromFile(config)
        : await buildLineLayerFromOverpass(config);
    } catch (localErr) {
      if (config.relationId) {
        try {
          layerGroup = await buildLineLayerFromOverpass(config);
        } catch (overpassErr) {
          console.warn(`[halte-map] Failed to load line layer "${config.name}":`, overpassErr.message);
          return;
        }
      } else {
        console.warn(`[halte-map] Failed to load line layer "${config.name}":`, localErr.message);
        return;
      }
    }

    if (config.defaultEnabled) {
      layerGroup.addTo(halteMap);
    }

    lineLayers.set(config.id, { layer: layerGroup, config, enabled: config.defaultEnabled });
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
            <span class="halte-popup-label">Kepemilikan Jalan</span>
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

      newLayer.addTo(halteMap);
      // Update stored reference so toggle controls still work
      pointLayers.set(config.id, { layer: newLayer, config, enabled });
    });

    syncSemuaButton();
    updateFilterCount();
  }

  // ─── Filter UI wiring ─────────────────────────────────────────────────────

  function bindFilterControls() {
    // Type filter buttons
    document.querySelectorAll('[data-halte-type-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.halteTypeFilter;
        if (activeTypeFilter.has(val)) {
          activeTypeFilter.delete(val);
        } else {
          activeTypeFilter.add(val);
        }
        btn.classList.toggle('halte-filter-active', activeTypeFilter.has(val));
        applyFilters();
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
          // All were on — turn all off
          activeTypeFilter.clear();
        } else {
          // Some or none were on — turn all on
          allTypeVals.forEach(v => activeTypeFilter.add(v));
        }

        document.querySelectorAll('[data-halte-type-filter]').forEach(b => {
          b.classList.toggle('halte-filter-active', activeTypeFilter.has(b.dataset.halteTypeFilter));
        });

        applyFilters();
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