'use client';

import { mapColors } from '@/lib/theme-colors';
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { FarmMapProps } from './FarmMap';

// Fallback map for browsers without WebGL (privacy browsers such as
// LibreWolf switch it off; some old Android phones lack it). Leaflet draws
// plain image tiles, so it works everywhere. Same props as FarmMap.
//
// Tiles: OpenStreetMap's own servers, which allow light use with attribution
// (operations.osmfoundation.org/policies/tiles). This path only serves the
// minority of visitors without WebGL; if it ever carries real traffic, point
// RASTER_TILES at a provider or a self-hosted tile server.
const RASTER_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';


export default function RasterMap({
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
}: FarmMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const latest = useRef({ onSelect, onMoveEnd, onCenterChange, padding, fitPoints });
  latest.current = { onSelect, onMoveEnd, onCenterChange, padding, fitPoints };

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, {
      center: [center[1], center[0]],
      zoom: Math.round(zoom),
      zoomControl: false, // pinch and scroll zoom; buttons would sit under the search bar
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      preferCanvas: true,
      maxBounds: L.latLngBounds([-12, 28], [8, 46]),
      minZoom: 5,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    L.tileLayer(RASTER_TILES, {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layer.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const report = () => {
      const b = map.getBounds();
      latest.current.onMoveEnd?.({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, map.getZoom());
      const c = map.getCenter();
      latest.current.onCenterChange?.(c.lng, c.lat);
    };
    map.on('moveend', report);
    if (centerPin) map.on('move', () => latest.current.onCenterChange?.(map.getCenter().lng, map.getCenter().lat));
    if (interactive) map.on('click', () => latest.current.onSelect?.(null));
    setTimeout(report, 0);
    if (latest.current.fitPoints?.length) fitTo(map, latest.current.fitPoints, latest.current.padding);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    for (const p of points) {
      const selected = p.id === selectedId;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: selected ? 11 : 8,
        color: p.verified ? mapColors().verified : mapColors().pinStroke,
        weight: p.verified ? 4 : 2.5,
        fillColor: selected ? mapColors().selected : mapColors().pin,
        fillOpacity: 1,
        bubblingMouseEvents: false,
      });
      if (interactive) marker.on('click', () => latest.current.onSelect?.(p.id));
      marker.addTo(group);
    }
  }, [points, selectedId, interactive]);

  useEffect(() => {
    if (flyKey === undefined) return;
    mapRef.current?.flyTo([center[1], center[0]], Math.round(zoom), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  useEffect(() => {
    if (fitKey === undefined || !fitPoints?.length || !mapRef.current) return;
    fitTo(mapRef.current, fitPoints, latest.current.padding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <div className={positioned(className)}>
      <div ref={container} className="absolute inset-0 z-0 bg-mint" role="region" aria-label={label} />
      {centerPin ? (
        <svg
          className="pointer-events-none absolute left-1/2 top-1/2 z-[500] h-[52px] w-10 -translate-x-1/2 -translate-y-full drop-shadow-md"
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

function fitTo(map: L.Map, pts: [number, number][], padding?: FarmMapProps['padding']) {
  if (pts.length === 1) {
    map.setView([pts[0][1], pts[0][0]], 13);
    return;
  }
  map.fitBounds(L.latLngBounds(pts.map(([lng, lat]) => [lat, lng] as [number, number])), {
    paddingTopLeft: [padding?.left ?? 48, padding?.top ?? 48],
    paddingBottomRight: [padding?.right ?? 48, padding?.bottom ?? 48],
    maxZoom: 12,
  });
}

/** The map fills its box with absolutely positioned layers, so the box must be
 * positioned. Callers that already position it (Explore uses "absolute inset-0")
 * keep theirs: adding "relative" as well would collapse the box to 0 px high. */
function positioned(className: string | undefined): string {
  return /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/.test(className ?? '') ? (className ?? '') : `relative ${className ?? ''}`;
}
