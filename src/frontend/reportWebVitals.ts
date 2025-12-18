import {
  onCLS,
  onFID,
  onFCP,
  onLCP,
  onTTFB,
  onINP,
  type Metric,
} from "web-vitals";

type ReportHandler = (metric: Metric) => void;

const reportWebVitals = (onPerfEntry?: ReportHandler) => {
  if (!onPerfEntry) return;

  onCLS(onPerfEntry);
  onFID(onPerfEntry);
  onFCP(onPerfEntry);
  onLCP(onPerfEntry);
  onTTFB(onPerfEntry);
  onINP(onPerfEntry);
};

export default reportWebVitals;
