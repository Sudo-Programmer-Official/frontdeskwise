-- Per-status-code request telemetry. This keeps the main hourly ledger compact
-- while making polling lifecycle, auth, rate-limit, and server failures
-- distinguishable in the Super Admin view.
create table if not exists api_request_metrics_status_hourly (
  bucket_start timestamptz not null,
  route text not null,
  method text not null,
  traffic_class text not null,
  status_code integer not null,
  request_count integer not null default 0,
  primary key (bucket_start, route, method, traffic_class, status_code)
);

create index if not exists api_request_metrics_status_hourly_time_idx
  on api_request_metrics_status_hourly (bucket_start desc);

create index if not exists api_request_metrics_status_hourly_status_idx
  on api_request_metrics_status_hourly (status_code, bucket_start desc);
