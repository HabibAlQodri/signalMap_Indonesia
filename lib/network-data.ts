export type Operator = {
  name: string;
  color: string;
  share: string;
  cells: string;
};

export type Region = {
  name: string;
  label: string;
  center: { lat: number; lng: number };
  zoom: number;
};

export type NetworkPoint = {
  id: number;
  city: string;
  lat: number;
  lng: number;
  operator: string;
  technology: string;
};

export const operators: Operator[] = [
  { name: "Telkomsel", color: "#ed6c4d", share: "42%", cells: "8.420" },
  { name: "Indosat Ooredoo", color: "#805ad5", share: "28%", cells: "5.610" },
  { name: "XL Axiata", color: "#3d8bdf", share: "19%", cells: "3.820" },
  { name: "Smartfren", color: "#12a88a", share: "11%", cells: "2.190" },
];

export const regions: Region[] = [
  { name: "Indonesia", label: "Nasional", center: { lat: -2.4, lng: 118 }, zoom: 4 },
  { name: "Jawa", label: "Pulau Jawa", center: { lat: -7.2, lng: 110.2 }, zoom: 7 },
  { name: "Sumatra", label: "Pulau Sumatra", center: { lat: -0.5, lng: 102.2 }, zoom: 6 },
  { name: "Kalimantan", label: "Pulau Kalimantan", center: { lat: 0.4, lng: 114.5 }, zoom: 6 },
  { name: "Sulawesi", label: "Pulau Sulawesi", center: { lat: -2.4, lng: 120.3 }, zoom: 6 },
  { name: "Bali & Nusa Tenggara", label: "Bali & Nusa Tenggara", center: { lat: -8.4, lng: 117.3 }, zoom: 6 },
  { name: "Papua", label: "Pulau Papua", center: { lat: -4.1, lng: 138.5 }, zoom: 6 },
];

export const clusters = [
  { city: "Jakarta", lat: -6.2, lng: 106.85, count: 28 },
  { city: "Bandung", lat: -6.91, lng: 107.61, count: 17 },
  { city: "Surabaya", lat: -7.25, lng: 112.75, count: 19 },
  { city: "Semarang", lat: -6.97, lng: 110.42, count: 13 },
  { city: "Yogyakarta", lat: -7.8, lng: 110.37, count: 12 },
  { city: "Medan", lat: 3.59, lng: 98.67, count: 18 },
  { city: "Palembang", lat: -2.99, lng: 104.76, count: 12 },
  { city: "Denpasar", lat: -8.67, lng: 115.21, count: 12 },
  { city: "Makassar", lat: -5.14, lng: 119.43, count: 16 },
  { city: "Balikpapan", lat: -1.24, lng: 116.85, count: 10 },
  { city: "Banjarmasin", lat: -3.32, lng: 114.59, count: 11 },
  { city: "Manado", lat: 1.47, lng: 124.84, count: 10 },
];

function randomOffset(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

export function createNetworkPoints(): NetworkPoint[] {
  let id = 0;
  return clusters.flatMap((cluster, clusterIndex) =>
    Array.from({ length: cluster.count }, (_, index) => {
      id += 1;
      return {
        id,
        city: cluster.city,
        lat: cluster.lat + randomOffset(id + 1) * 0.72,
        lng: cluster.lng + randomOffset(id + 29) * 0.86,
        operator: operators[(index + clusterIndex * 3) % operators.length].name,
        technology: (index + clusterIndex) % 7 === 0 ? "5G" : "4G",
      };
    }),
  );
}

export function project(lng: number, lat: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const safeLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function unproject(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  return {
    lng: (x / scale) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI,
  };
}

export function roundCoordinate(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function formatNumber(value: number, locale = "id-ID") {
  return new Intl.NumberFormat(locale).format(value);
}
