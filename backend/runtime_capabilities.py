"""Bounded capabilities advertised to same-origin web clients."""

AGGREGATE_VERSION_V1 = "aggregate-version-v1"
SERVER_CAPABILITIES = (AGGREGATE_VERSION_V1,)


def with_server_capabilities(payload):
    """Attach the additive compatibility contract without mutating callers."""
    return {**payload, "serverCapabilities": list(SERVER_CAPABILITIES)}
