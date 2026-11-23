# Observability release correlation

FrontDeskWise attaches one bounded correlation context to API logs and durable
runtime telemetry. The context makes it possible to answer “what changed?” for
a tenant, workflow, or model without reconstructing a deployment from memory.

The dimensions are:

- `release_version`: immutable application release, normally the Git SHA.
- `deployment_version`: deployment instance or platform deployment ID.
- `tenant_id`, `organization_id`, `tenant_slug`: the business and account scope.
- `publication_version`: the immutable tenant configuration snapshot served to visitors.
- `workflow_action_id`, `workflow_key`, `workflow_version`: the action/workflow active for the turn.
- `model_routing_version`, `model_route`, `model_name`: model policy and provider model selected.
- `correlation_id`: request, widget event, or conversation-turn identifier.

The API reads these environment variables once at process start:

```text
FRONTDESKWISE_RELEASE_VERSION
FRONTDESKWISE_DEPLOYMENT_VERSION
FRONTDESKWISE_MODEL_ROUTING_VERSION
```

In production, the deployment pipeline should set the first two from the
immutable Git revision and deployment ID. The model routing version should be
incremented whenever routing policy changes, even if the provider model ID does
not.

Migration `075_observability_release_correlation.sql` adds queryable dimensions
to conversation messages/events, conversion events, experience signals, widget
performance, security events, and privileged audit events. JSON correlation
metadata is also retained in replay-oriented event payloads. During a rolling
deploy, the API falls back to the previous insert shape until the migration is
available.

Useful queries include:

```sql
select release_version, deployment_version, workflow_key, workflow_version,
       model_name, count(*)
from experience_signals
where occurred_at >= now() - interval '7 days'
group by 1, 2, 3, 4, 5
order by count(*) desc;

select release_version, publication_version, count(*)
from conversion_events
where business_id = $1
  and occurred_at >= now() - interval '30 days'
group by 1, 2
order by min(occurred_at);
```
