/**
 * Human-readable names for the risk model's raw feature columns
 * (zkd-risk-model/src/features.py's FEATURE_COLS). Moved out of
 * components/ForecastAudit.tsx (unchanged content, just relocated) so
 * server/engine/topReason.ts can build a plain-language "top reason"
 * sentence without a client component importing server code, and so the
 * client component can keep importing the same dictionary from one shared,
 * client-safe module.
 */
export const FEATURE_LABEL: Record<string, string> = {
  carrier_hist_cancel_rate: "Carrier's cancellation history",
  route_hist_cancel_rate: 'This route’s history',
  origin_hist_cancel_rate: 'Origin airport history',
  dest_hist_cancel_rate: 'Destination airport history',
  origin_month_hist_cancel_rate: 'Seasonal (origin, this month)',
  month: 'Month',
  day_of_week: 'Day of week',
  hour_of_day: 'Hour of day',
  is_redeye: 'Red-eye departure',
  is_weekend: 'Weekend departure',
  distance_km: 'Route distance',
  sched_duration_min: 'Scheduled flight time',
  origin_hour_density: 'Origin schedule density',
  prior_leg_cancelled: "Aircraft's previous leg cancelled",
  international: 'International route',
};
