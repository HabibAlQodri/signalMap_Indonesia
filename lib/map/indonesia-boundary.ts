const MIN_LATITUDE = -15;
const MAX_LATITUDE = 15;
const LATITUDE_STEP = 0.05;
const ROW_COUNT = Math.ceil((MAX_LATITUDE - MIN_LATITUDE) / LATITUDE_STEP);

export type IndonesiaBoundaryIndex = {
  contains(longitude: number, latitude: number): boolean;
};

export function buildIndonesiaBoundaryIndex(
  collection: GeoJSON.FeatureCollection,
): IndonesiaBoundaryIndex {
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("Data batas Indonesia tidak valid.");
  }

  const rows = Array.from({ length: ROW_COUNT }, () => [] as number[]);
  let segmentCount = 0;

  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];

    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[(i + 1) % ring.length];
          if (y1 === y2) continue;

          const minY = Math.min(y1, y2);
          const maxY = Math.max(y1, y2);
          if (maxY < MIN_LATITUDE || minY >= MAX_LATITUDE) continue;
          const firstRow = Math.max(0, Math.floor((minY - MIN_LATITUDE) / LATITUDE_STEP));
          const lastRow = Math.min(ROW_COUNT - 1, Math.floor((maxY - MIN_LATITUDE) / LATITUDE_STEP));

          for (let row = firstRow; row <= lastRow; row++) {
            rows[row].push(x1, y1, x2, y2);
          }
          segmentCount++;
        }
      }
    }
  }

  if (!segmentCount) throw new Error("Batas Indonesia tidak memiliki geometri poligon.");

  return {
    contains(longitude, latitude) {
      if (longitude < 90 || longitude > 145 || latitude < MIN_LATITUDE || latitude >= MAX_LATITUDE) {
        return false;
      }

      const row = rows[Math.floor((latitude - MIN_LATITUDE) / LATITUDE_STEP)];
      let inside = false;
      for (let i = 0; i < row.length; i += 4) {
        const x1 = row[i];
        const y1 = row[i + 1];
        const x2 = row[i + 2];
        const y2 = row[i + 3];
        if ((y1 > latitude) !== (y2 > latitude) && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) {
          inside = !inside;
        }
      }
      return inside;
    },
  };
}
