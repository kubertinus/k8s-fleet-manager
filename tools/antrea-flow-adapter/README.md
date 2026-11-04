# Antrea Flow Adapter (Minimal)

Lightweight adapter service that provides the JSON flow format used by K8s Fleet Manager.

## Why this exists

K8s Fleet Manager expects a JSON flow API for allow/drop overlays in network topology. This adapter supports two modes:

1. **Upstream mode**: query an existing HTTP flow endpoint.
2. **Receiver mode**: ingest IPFIX directly on UDP/TCP 4739 and expose `/flows`.

## Endpoints

- GET /health
- GET /flows?clusterId=<id>&namespace=<ns>&window=<5m>

In receiver mode, `clusterId` and `namespace` are accepted and forwarded as query context, but filtering depends on available metadata in parsed flow records.

The /flows response format matches K8s Fleet Manager expectations:

{
  "configured": true,
  "namespace": "default",
  "window": "5m",
  "source": "https://your-upstream",
  "flows": [
    {
      "sourceId": "pod-default-app-123",
      "targetId": "service-default-db",
      "action": "Allow",
      "packets": 123,
      "bytes": 45678,
      "lastSeen": "2026-02-22T12:34:56Z"
    }
  ]
}

## Configure

1. Copy .env.example to your environment.
2. Choose one mode:
  - **Upstream mode**: set `UPSTREAM_URL`
  - **Receiver mode**: leave `UPSTREAM_URL` empty and send IPFIX to this service on port `4739`

UPSTREAM_URL supports placeholders:
- {clusterId}
- {namespace}
- {window}

Example:
UPSTREAM_URL=http://ipfix-query.default.svc.cluster.local:8080/flows?clusterId={clusterId}&namespace={namespace}&window={window}

Optional:
- ADAPTER_TOKEN (protects this adapter)
- UPSTREAM_TOKEN (for upstream auth)

Receiver mode envs:
- IPFIX_PORT (default `4739`)
- IPFIX_HOST (default `0.0.0.0`)
- IPFIX_ENABLE_UDP (`true` by default)
- IPFIX_ENABLE_TCP (`true` by default)
- FLOW_TTL_MS (default `300000`, 5 minutes)

## Run locally

From tools/antrea-flow-adapter:

npm start

Service listens on PORT (default 8081).

## Build container image

From repository root:

docker build -f tools/antrea-flow-adapter/Dockerfile -t kubertinus/antrea-flow-adapter:0.1.1 tools/antrea-flow-adapter
docker push kubertinus/antrea-flow-adapter:0.1.1

## Deploy on Kubernetes

Apply manifest:

kubectl apply -f tools/antrea-flow-adapter/k8s/antrea-flow-adapter.yaml

If you use receiver mode, keep `UPSTREAM_URL` empty and point Antrea FlowExporter to:

- `antrea-flow-adapter.k8s-fleet-manager.svc.cluster.local:4739`

If you set a non-empty `ADAPTER_TOKEN`, K8s Fleet Manager must send the same token.

## Hook into K8s Fleet Manager

In K8s Fleet Manager Settings -> Antrea Flow Configuration:

- Antrea Flow API URL: http://antrea-flow-adapter.k8s-fleet-manager.svc.cluster.local:8081/flows?clusterId={clusterId}
- Antrea Flow API Token: <ADAPTER_TOKEN if used>

K8s Fleet Manager appends namespace and window query parameters automatically.

## Record mapping

The adapter accepts multiple common field names and maps them to source/destination/action.

In **upstream mode**, it supports payload shapes:

- [ ... ]
- { flows: [ ... ] }
- { records: [ ... ] }
- { data: [ ... ] }

Required after mapping:
- source namespace + pod
- destination namespace + (pod or service)
- action (allow/drop/reject or similar)
