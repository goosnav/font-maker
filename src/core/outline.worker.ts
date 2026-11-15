import { traceMask } from "./contours";
import { traceSmooth, fitCurves } from "./curves";
import { EXTENT } from "./model";
self.onmessage = ({ data }) => {
  try {
    const { alpha, width, height, detailed } = data;
    const result = detailed
      ? {
          curves: traceSmooth(new Uint8Array(alpha), width, height).map(
            (points) => fitCurves(points, (EXTENT / width) * 0.35),
          ),
        }
      : { contours: traceMask(new Uint8Array(alpha), width, height) };
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
