'use client';

import { mapColors } from '@/lib/theme-colors';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { MarkerClusterer, type Renderer } from '@googlemaps/markerclusterer';
import { useEffect, useRef } from 'react';
import type { FarmMapProps, MapPoint } from './FarmMap';

// Google Maps (Maps JavaScript API) with the same props as the MapLibre map.
// FarmMap picks this one when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set, and falls
// back to the free OpenStreetMap-based map if Google can't load (no key, key
// refused, network blocked).
//
// Pins are Advanced Markers, which need a Map ID: create one in Google Cloud
// (Maps → Map management, JavaScript, vector) and put it in
// NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID. Google's DEMO_MAP_ID is used until then.

const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

// Kenya, with a margin: the map can't be dragged off to another continent.
const KENYA = { north: 6.5, south: -6, west: 32.5, east: 43 };

type Libraries = { maps: google.maps.MapsLibrary; marker: google.maps.MarkerLibrary };

let loading: Promise<Libraries> | null = null;
let authFailed = false;
let colorScheme: google.maps.ColorScheme | undefined;

/** Loads the API once per page. Rejects if the key is refused or the script can't load (8 s). */
export function loadGoogleMaps(locale: string): Promise<Libraries> {
  if (authFailed) return Promise.reject(new Error('Google Maps key refused'));
  loading ??= new Promise<Libraries>((resolve, reject) => {
    // Google calls this when the key is wrong, restricted or billing is off.
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
      authFailed = true;
      window.dispatchEvent(new Event('i12f-gmaps-auth-failure'));
      reject(new Error('Google Maps key refused'));
    };
    const timer = setTimeout(() => reject(new Error('Google Maps did not load')), 8000);
    setOptions({ key: GOOGLE_MAPS_KEY, v: 'weekly', language: locale === 'sw' ? 'sw' : 'en', region: 'KE' });
    Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('core')])
      .then(([maps, marker, core]) => {
        clearTimeout(timer);
        colorScheme = core.ColorScheme?.FOLLOW_SYSTEM;
        resolve({ maps, marker });
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  }).catch((error) => {
    loading = null; // allow a retry on the next map
    throw error;
  });
  return loading;
}

function pinElement(p: MapPoint, selected: boolean): HTMLElement {
  const el = document.createElement('div');
  const size = selected ? 26 : 20;
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    'border-radius:50%',
    `background:${selected ? mapColors().selected : mapColors().pin}`,
    `border:${p.verified ? 4 : 2.5}px solid ${p.verified ? mapColors().verified : mapColors().pinStroke}`,
    'box-shadow:0 1px 4px rgba(0,0,0,.35)',
    'box-sizing:border-box',
    'transform:translateY(50%)', // centre the dot on the farm, not its bottom edge
  ].join(';');
  return el;
}

const clusterRenderer: Renderer = {
  render({ count, position }) {
    const size = count < 10 ? 34 : count < 50 ? 42 : 52;
    const el = document.createElement('div');
    el.style.cssText = [
      `width:${size}px`,
      `height:${size}px`,
      'border-radius:50%',
      `background:${mapColors().selected}`,
      `box-shadow:0 0 0 6px ${mapColors().clusterHalo}55`,
      'color:#fff',
      'font:700 13px/1 system-ui,sans-serif',
      'display:grid',
      'place-items:center',
      'transform:translateY(50%)',
    ].join(';');
    el.textContent = String(count);
    return new google.maps.marker.AdvancedMarkerElement({ position, content: el, zIndex: 1000 + count });
  },
};

export default function GoogleMap({
  center,
  zoom,
  points = [],
  selectedId,
  interactive = true,
  centerPin = false,
  onSelect,
  onMoveEnd,
  onCenterChange,
  flyKey,
  fitKey,
  fitPoints,
  padding,
  className,
  label,
  locale,
  onFail,
}: FarmMapProps & { locale: string; onFail: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  const clusterer = useRef<MarkerClusterer | null>(null);
  const latest = useRef({ points, selectedId, onSelect, onMoveEnd, onCenterChange, padding, onFail, fitPoints });
  latest.current = { points, selectedId, onSelect, onMoveEnd, onCenterChange, padding, onFail, fitPoints };

  useEffect(() => {
    let cancelled = false;
    const failed = () => latest.current.onFail();
    window.addEventListener('i12f-gmaps-auth-failure', failed);
    loadGoogleMaps(locale)
      .then(({ maps }) => {
        if (cancelled || !container.current) return;
        const map = new maps.Map(container.current, {
          center: { lat: center[1], lng: center[0] },
          zoom,
          mapId: MAP_ID,
          colorScheme, // light or dark with the phone or computer (set once, at creation)
          disableDefaultUI: true,
          zoomControl: interactive,
          clickableIcons: false,
          gestureHandling: interactive ? 'greedy' : 'none',
          keyboardShortcuts: interactive,
          minZoom: 5,
          restriction: { latLngBounds: KENYA, strictBounds: false },
        });
        mapRef.current = map;
        if (interactive) {
          clusterer.current = new MarkerClusterer({
            map,
            renderer: clusterRenderer,
            onClusterClick: (_e, cluster, m) => {
              if (cluster.bounds) m.fitBounds(cluster.bounds, 64);
            },
          });
          map.addListener('click', () => latest.current.onSelect?.(null));
        }
        drawMarkers();
        const report = () => {
          const b = map.getBounds();
          const c = map.getCenter();
          if (b) {
            const ne = b.getNorthEast();
            const sw = b.getSouthWest();
            latest.current.onMoveEnd?.({ west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat() }, map.getZoom() ?? zoom);
          }
          if (c) latest.current.onCenterChange?.(c.lng(), c.lat());
        };
        map.addListener('idle', report);
        if (centerPin) {
          map.addListener('center_changed', () => {
            const c = map.getCenter();
            if (c) latest.current.onCenterChange?.(c.lng(), c.lat());
          });
        }
        if (latest.current.fitPoints?.length) fit(map, latest.current.fitPoints, latest.current.padding);
      })
      .catch((error: unknown) => {
        console.warn('Google Maps unavailable, using the free map instead:', error);
        if (!cancelled) failed();
      });
    return () => {
      cancelled = true;
      window.removeEventListener('i12f-gmaps-auth-failure', failed);
      clusterer.current?.clearMarkers();
      clusterer.current = null;
      markers.current.forEach((m) => (m.map = null));
      markers.current.clear();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins: add new ones, restyle the selected one, drop ones that left.
  function drawMarkers() {
    const map = mapRef.current;
    if (!map || typeof google === 'undefined') return;
    const { points: pts, selectedId: sel } = latest.current;
    const keep = new Set(pts.map((p) => p.id));
    const removed: google.maps.marker.AdvancedMarkerElement[] = [];
    for (const [id, m] of markers.current) {
      if (!keep.has(id)) {
        removed.push(m);
        markers.current.delete(id);
      }
    }
    const added: google.maps.marker.AdvancedMarkerElement[] = [];
    for (const p of pts) {
      const selected = p.id === sel;
      let m = markers.current.get(p.id);
      if (!m) {
        m = new google.maps.marker.AdvancedMarkerElement({
          position: { lat: p.lat, lng: p.lng },
          content: pinElement(p, selected),
          gmpClickable: interactive,
          zIndex: selected ? 999 : undefined,
        });
        if (interactive) m.addListener('gmp-click', () => latest.current.onSelect?.(p.id));
        markers.current.set(p.id, m);
        added.push(m);
      } else {
        m.content = pinElement(p, selected);
        m.zIndex = selected ? 999 : null;
      }
    }
    if (clusterer.current) {
      if (removed.length) clusterer.current.removeMarkers(removed, true);
      if (added.length) clusterer.current.addMarkers(added, true);
      clusterer.current.render();
    } else {
      removed.forEach((m) => (m.map = null));
      added.forEach((m) => (m.map = map));
    }
  }

  useEffect(() => {
    drawMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, selectedId]);

  useEffect(() => {
    if (flyKey === undefined) return;
    const map = mapRef.current;
    if (!map) return;
    map.panTo({ lat: center[1], lng: center[0] });
    map.setZoom(Math.round(zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  useEffect(() => {
    if (fitKey === undefined || !fitPoints?.length || !mapRef.current) return;
    fit(mapRef.current, fitPoints, latest.current.padding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <div className={positioned(className)}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} className="bg-mint" role="region" aria-label={label} />
      {centerPin ? (
        <svg
          className="pointer-events-none absolute left-1/2 top-1/2 h-[52px] w-10 -translate-x-1/2 -translate-y-full drop-shadow-md"
          viewBox="0 0 40 52"
          aria-hidden="true"
        >
          <path d="M20 51C14 42 2 33 2 20a18 18 0 0 1 36 0c0 13-12 22-18 31z" style={{ fill: 'var(--color-forest)' }} />
          <circle cx="20" cy="20" r="7" style={{ fill: 'var(--color-lime)' }} />
        </svg>
      ) : null}
    </div>
  );
}

function fit(map: google.maps.Map, pts: [number, number][], padding?: FarmMapProps['padding']) {
  if (pts.length === 1) {
    map.panTo({ lat: pts[0][1], lng: pts[0][0] });
    map.setZoom(13);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  for (const [lng, lat] of pts) bounds.extend({ lat, lng });
  map.fitBounds(bounds, padding ?? 48);
  // Don't zoom in past county level for a handful of nearby farms.
  google.maps.event.addListenerOnce(map, 'idle', () => {
    if ((map.getZoom() ?? 0) > 12) map.setZoom(12);
  });
}

function positioned(className: string | undefined): string {
  return /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/.test(className ?? '') ? (className ?? '') : `relative ${className ?? ''}`;
}
