"""AI provider adapters.

The package deliberately keeps imports lazy.  ``backend.ai.configuration`` is
used by every adapter, so importing the registry here would create a cycle.
"""

