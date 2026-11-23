-- Aggregated HTTP request telemetry for capacity planning. One row represents
-- one route/category/method per UTC hour; request bodies and visitor content are
-- never stored here.
create table if not exists api_request_metrics_hourly (
  bucket_start timestamptz not null,
  route text not null,
  method text not null,
  traffic_class text not null,
  request_count integer not null default 0,
  error_count integer not null default 0,
  total_duration_ms bigint not null default 0,
  duration_le_50 integer not null default 0,
  duration_le_100 integer not null default 0,
  duration_le_250 integer not null default 0,
  duration_le_500 integer not null default 0,
  duration_le_1000 integer not null default 0,
  duration_le_2000 integer not null default 0,
  duration_le_5000 integer not null default 0,
  duration_gt_5000 integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (bucket_start, route, method, traffic_class)
);

create index if not exists api_request_metrics_hourly_time_idx
  on api_request_metrics_hourly (bucket_start desc);

create index if not exists api_request_metrics_hourly_class_idx
  on api_request_metrics_hourly (traffic_class, bucket_start desc);
