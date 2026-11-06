import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workerSource = fileURLToPath(
  new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url),
);
const workerDestination = fileURLToPath(
  new URL("../public/maplibre-gl-worker.mjs", import.meta.url),
);

copyFileSync(workerSource, workerDestination);
