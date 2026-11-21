-- Keep the canonical required/optional projections synchronized with the
-- authoritative ordered fields array for actions created before 053.

update business_actions
set required_fields = coalesce(
      (select jsonb_agg(field->>'key' order by ordinality)
       from jsonb_array_elements(fields) with ordinality as item(field, ordinality)
       where coalesce((field->>'required')::boolean, true) = true
         and coalesce(field->>'visibility', 'visible') <> 'hidden'),
      '[]'::jsonb),
    optional_fields = coalesce(
      (select jsonb_agg(field->>'key' order by ordinality)
       from jsonb_array_elements(fields) with ordinality as item(field, ordinality)
       where coalesce((field->>'required')::boolean, true) = false
         and coalesce(field->>'visibility', 'visible') <> 'hidden'),
      '[]'::jsonb)
where jsonb_typeof(fields) = 'array';
