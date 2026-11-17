import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workerSource = fileURLToPath(
  new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url),
);
const workerDestination = fileURLToPath(
  new URL("../public/maplibre-gl-worker.mjs", import.meta.url),
);

copyFileSync(workerSource, workerDestination);

const boundaryFiles = [
  ["indonesia-adm0.geojson", "indonesia-adm0.geojson"],
  ["indonesia-adm1.geojson", "indonesia-adm1.geojson"],
  ["indonesia-adm2.geojson", "indonesia-adm2.geojson"],
];
const boundaryDestination = fileURLToPath(new URL("../public/boundaries/", import.meta.url));

mkdirSync(boundaryDestination, { recursive: true });
for (const [source, destination] of boundaryFiles) {
  copyFileSync(
    fileURLToPath(new URL(`../lib/boundries/${source}`, import.meta.url)),
    fileURLToPath(new URL(`../public/boundaries/${destination}`, import.meta.url)),
  );
}
