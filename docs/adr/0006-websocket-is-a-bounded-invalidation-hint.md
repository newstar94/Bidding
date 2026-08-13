---
status: accepted
---

# WebSocket is a bounded invalidation hint

Delta sync is the authoritative convergence mechanism and WebSocket delivery is an invalidation hint, not durable per-worker fanout. Connected clients reconcile from the server cursor on a bounded interval and after reconnect; the transactional event log must still avoid retry gaps and false global-delivery claims, but it does not promise one acknowledgement per ASGI worker.
