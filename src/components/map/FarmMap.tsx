'use client';

import { useEffect, useRef } from 'react';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Free vector tiles, no API key (https://openfreemap.org). Swap for a
// self-hosted style URL if the pilot needs guaranteed uptime.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export interface MapPoint {
  id: string;
  lng: number;
  lat: number;
  verified?: boolean;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface Props {
  center: [number, number];
  zoom: number;
  points?: MapPoint[];
  selectedId?: string | null;
  interactive?: boolean;
  /** Pin-drop mode: a fixed pin sits in the centre and the map moves under it. */
  centerPin?: boolean;
  onSelect?: (id: string | null) => void;
  onMoveEnd?: (bounds: Bounds, zoom: number) => void;
  onCenterChange?: (lng: number, lat: number) => void;
  /** Change this value to fly the map to `center` / `zoom` again. */
  flyKey?: string | number;
  /** Fit these points (with padding) instead of using center/zoom when it changes. */
  fitKey?: string | number;
  fitPoints?: [number, number][];
  padding?: { top: number; bottom: number; left: number; right: number };
  className?: string;
  label: string;
}

const COLORS = {
  pin: '#067647',
  pinStroke: '#ffffff',
  selected: '#053B2B',
  verified: '#B6F04A',
  cluster: '#053B2B',
  clusterHalo: '#12B76A',
};

function toGeoJSON(points: MapPoint[], selectedId: string | null | undefined) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p) => ({
      type: 'Feature' as const,
      id: p.id,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { id: p.id, verified: Boolean(p.verified), selected: p.id === selectedId },
    })),
  };
}

export function FarmMap({
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
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ points, selectedId, onSelect, onMoveEnd, onCenterChange, padding });
  latest.current = { points, selectedId, onSelect, onMoveEnd, onCenterChange, padding };

  // Create the map once. maplibre-gl is loaded on demand so it never weighs
  // down pages that don't show a map.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const maplibregl = (await import('maplibre-gl')).default;
      if (cancelled || !container.current) return;
      const map = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        center,
        zoom,
        interactive,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxBounds: [
          [28, -12],
          [46, 8],
        ],
      });
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;

      map.on('load', () => {
        map.addSource('farms', {
          type: 'geojson',
          data: toGeoJSON(latest.current.points, latest.current.selectedId),
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 12,
        });
        map.addLayer({
          id: 'cluster-halo',
          type: 'circle',
          source: 'farms',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': COLORS.clusterHalo,
            'circle-opacity': 0.28,
            'circle-radius': ['step', ['get', 'point_count'], 22, 10, 27, 50, 32],
          },
        });
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'farms',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': COLORS.cluster,
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 50, 26],
          },
        });
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'farms',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 13,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#ffffff' },
        });
        map.addLayer({
          id: 'farm-points',
          type: 'circle',
          source: 'farms',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['case', ['get', 'selected'], COLORS.selected, COLORS.pin],
            'circle-radius': ['case', ['get', 'selected'], 13, 10],
            'circle-stroke-width': ['case', ['get', 'verified'], 4, 2.5],
            'circle-stroke-color': ['case', ['get', 'verified'], COLORS.verified, COLORS.pinStroke],
          },
        });
        ready.current = true;
        if (fitPoints?.length) fit(map, fitPoints, latest.current.padding);
      });

      if (interactive) {
        map.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const source = map.getSource('farms') as GeoJSONSource;
          const nextZoom = await source.getClusterExpansionZoom(feature.properties?.cluster_id as number);
          map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom: nextZoom + 0.5 });
        });
        map.on('click', 'farm-points', (e: MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) latest.current.onSelect?.(id);
        });
        map.on('click', (e) => {
          const hits = map.queryRenderedFeatures(e.point, { layers: ['farm-points', 'clusters'] });
          if (hits.length === 0) latest.current.onSelect?.(null);
        });
        for (const layer of ['clusters', 'farm-points']) {
          map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
          map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
        }
      }

      const report = () => {
        const b = map.getBounds();
        latest.current.onMoveEnd?.({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, map.getZoom());
        const c = map.getCenter();
        latest.current.onCenterChange?.(c.lng, c.lat);
      };
      map.on('moveend', report);
      map.once('idle', report);
      if (centerPin) {
        map.on('move', () => {
          const c = map.getCenter();
          latest.current.onCenterChange?.(c.lng, c.lat);
        });
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pins in sync with the data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    (map.getSource('farms') as GeoJSONSource | undefined)?.setData(toGeoJSON(points, selectedId));
  }, [points, selectedId]);

  useEffect(() => {
    if (flyKey === undefined) return;
    mapRef.current?.flyTo({ center, zoom, essential: true, padding: latest.current.padding });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  useEffect(() => {
    if (fitKey === undefined || !fitPoints?.length) return;
    const map = mapRef.current;
    if (map && ready.current) fit(map, fitPoints, latest.current.padding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={container} className="absolute inset-0" role="region" aria-label={label} />
      {centerPin ? (
        <svg
          className="pointer-events-none absolute left-1/2 top-1/2 h-[52px] w-10 -translate-x-1/2 -translate-y-full drop-shadow-md"
          viewBox="0 0 40 52"
          aria-hidden="true"
        >
          <path d="M20 51C14 42 2 33 2 20a18 18 0 0 1 36 0c0 13-12 22-18 31z" fill="#053B2B" />
          <circle cx="20" cy="20" r="7" fill="#B6F04A" />
        </svg>
      ) : null}
    </div>
  );
}

function fit(map: MlMap, pts: [number, number][], padding?: Props['padding']) {
  if (pts.length === 1) {
    map.flyTo({ center: pts[0], zoom: 13, padding });
    return;
  }
  let w = 180, e = -180, s = 90, n = -90;
  for (const [lng, lat] of pts) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  map.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: padding ?? 48, maxZoom: 12.5, duration: 700 },
  );
}
