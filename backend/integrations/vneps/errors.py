class VnepsError(RuntimeError):
    """Base error for the external VNEPS seam."""


class VnepsConfigurationError(VnepsError):
    """The production adapter has no verified endpoint configuration."""


class VnepsUpstreamError(VnepsError):
    """VNEPS did not return a usable response."""


class VnepsSchemaError(VnepsError):
    """VNEPS returned a response that cannot be safely normalized."""
