'use client';

import { mapColors } from '@/lib/theme-colors';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MlMap, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Free vector tiles, no API key (https://openfreemap.org). Swap for a
// self-hosted style URL if the pilot needs guaranteed uptime.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

// Browsers without WebGL get a plain image-tile map instead (Leaflet).
const RasterMap = dynamic(() => import('./RasterMap'), { ssr: false });
// Google Maps when a key is configured; the free maps above are the fallback.
const GoogleMap = dynamic(() => import('./GoogleMap'), { ssr: false });
const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
let googleFailed = false; // once Google fails on this page, don't try it again

// When the map style can't be downloaded, pins still draw on a plain background.
const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': mapColors().background } }],
};

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// One download of the style per page load, shared by every map; 8 s limit.
let stylePromise: Promise<StyleSpecification | null> | null = null;
function loadStyle(): Promise<StyleSpecification | null> {
  stylePromise ??= fetch(STYLE_URL, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : null))
    .catch(() => null)
    .then((style) => {
      if (!style) stylePromise = null; // try again on the next map
      return style;
    });
  return stylePromise;
}

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

export type FarmMapProps = Props;

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

export function FarmMap(props: Props) {
  const locale = useLocale();
  const [mode, setMode] = useState<'google' | 'vector' | 'raster' | null>(null);
  useEffect(() => {
    const free = webglAvailable() ? 'vector' : 'raster';
    setMode(GOOGLE_KEY && !googleFailed ? 'google' : free);
  }, []);
  if (mode === 'google')
    return (
      <GoogleMap
        {...props}
        locale={locale}
        onFail={() => {
          googleFailed = true;
          setMode(webglAvailable() ? 'vector' : 'raster');
        }}
      />
    );
  if (mode === 'raster') return <RasterMap {...props} />;
  return <VectorMap {...props} active={mode === 'vector'} onFail={() => setMode('raster')} />;
}

function VectorMap({
  active,
  onFail,
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
}: Props & { active: boolean; onFail: () => void }) {
  const t = useTranslations('map');
  const [offline, setOffline] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ points, selectedId, onSelect, onMoveEnd, onCenterChange, padding, fitPoints });
  latest.current = { points, selectedId, onSelect, onMoveEnd, onCenterChange, padding, fitPoints };

  // Create the map once. maplibre-gl is loaded on demand so it never weighs
  // down pages that don't show a map.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      const [maplibregl, style] = await Promise.all([import('maplibre-gl'), loadStyle()]);
      // The worker file is copied to /public at build time (scripts/copy-map-worker.mjs).
      if (!maplibregl.getWorkerUrl().includes('/vendor/maplibre/')) {
        maplibregl.setWorkerUrl(`/vendor/maplibre/maplibre-gl-worker-${maplibregl.getVersion()}.mjs`);
      }
      if (cancelled || !container.current) return;
      if (!style) setOffline(true);
      let map: MlMap;
      try {
        map = new maplibregl.Map({
          container: container.current,
          style: style ?? OFFLINE_STYLE,
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
      } catch {
        // WebGL present but unusable (blocked context, driver issue): use the image-tile map.
        onFail();
        return;
      }
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
            'circle-color': mapColors().clusterHalo,
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
            'circle-color': mapColors().cluster,
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 50, 26],
          },
        });
        if (style)
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
            'circle-color': ['case', ['get', 'selected'], mapColors().selected, mapColors().pin],
            'circle-radius': ['case', ['get', 'selected'], 13, 10],
            'circle-stroke-width': ['case', ['get', 'verified'], 4, 2.5],
            'circle-stroke-color': ['case', ['get', 'verified'], mapColors().verified, mapColors().pinStroke],
          },
        });
        ready.current = true;
        // The newest points: a fit asked for while the map was still loading isn't lost.
        if (latest.current.fitPoints?.length) fit(map, latest.current.fitPoints, latest.current.padding);
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
  }, [active]);

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
    <div className={positioned(className)}>
      {/* inline style: maplibre-gl.css sets .maplibregl-map { position: relative }, which would collapse the box */}
      <div ref={container} style={{ position: 'absolute', inset: 0 }} role="region" aria-label={label} />
      {offline ? (
        <div className="absolute inset-x-0 z-10 flex justify-center px-4" style={{ top: (padding?.top ?? 8) + 4 }}>
          <p
            role="status"
            className="flex items-center gap-2 rounded-full bg-surface/95 px-3 py-1.5 text-xs font-semibold text-forest shadow"
          >
            {t('offline')}
            <button type="button" className="hit font-bold text-sprout-deep underline" onClick={() => window.location.reload()}>
              {t('retry')}
            </button>
          </p>
        </div>
      ) : null}
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

function fit(map: MlMap, pts: [number, number][], padding?: Props['padding']) {
  if (pts.length === 1) {
    map.flyTo({ center: pts[0], zoom: 13, padding });
    return;
  }
  let w = 180,
    e = -180,
    s = 90,
    n = -90;
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

/** The map fills its box with absolutely positioned layers, so the box must be
 * positioned. Callers that already position it (Explore uses "absolute inset-0")
 * keep theirs: adding "relative" as well would collapse the box to 0 px high. */
function positioned(className: string | undefined): string {
  return /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/.test(className ?? '') ? (className ?? '') : `relative ${className ?? ''}`;
}
