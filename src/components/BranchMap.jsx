import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const UB_CENTER = [47.918, 106.917];

function pinIcon(on) {
  return L.divIcon({
    className: `map-pin${on ? ' is-on' : ''}`,
    html: '<span></span>',
    iconSize: [28, 36],
    iconAnchor: [14, 34],
  });
}

export default function BranchMap({ items, selected, onSelect, origin }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const markers = useRef(new Map());

  useEffect(() => {
    const m = L.map(el.current, { scrollWheelZoom: false, zoomControl: true }).setView(UB_CENTER, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    markers.current.clear();
    const points = [];
    items.forEach((b) => {
      if (b.lat == null || b.lng == null) return;
      const mk = L.marker([b.lat, b.lng], { icon: pinIcon(false), title: `${b.chain} · ${b.name}`, keyboard: true, alt: `${b.chain} · ${b.name}` });
      mk.on('click', () => onSelect(b.id));
      mk.bindTooltip(`${b.chain} · ${b.name}`, { direction: 'top', offset: [0, -30] });
      mk.addTo(g);
      markers.current.set(b.id, mk);
      points.push([b.lat, b.lng]);
    });
    if (origin) {
      L.circleMarker([origin.lat, origin.lng], { radius: 8, color: '#0F3D32', weight: 3, fillColor: '#7FE0BE', fillOpacity: 1 })
        .bindTooltip('Таны байршил')
        .addTo(g);
      points.push([origin.lat, origin.lng]);
    }
    if (points.length === 1) m.setView(points[0], 14);
    else if (points.length > 1) m.fitBounds(points, { padding: [36, 36], maxZoom: 14 });
  }, [items, origin, onSelect]);

  useEffect(() => {
    markers.current.forEach((mk, id) => mk.setIcon(pinIcon(id === selected)));
    const mk = markers.current.get(selected);
    if (mk && map.current) {
      map.current.setView(mk.getLatLng(), Math.max(map.current.getZoom(), 14), { animate: true });
      const card = document.getElementById(`branch-${selected}`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selected]);

  return <div ref={el} className="map" role="region" aria-label="Худалдаалах цэгүүдийн газрын зураг" />;
}
