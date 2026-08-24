"""Provider adapters for opt-in outbound calendar delivery."""

from .base import CalendarHttpClient, CalendarProviderError
from .google import GoogleCalendarProvider
from .microsoft import MicrosoftCalendarProvider

__all__ = [
    "CalendarHttpClient",
    "CalendarProviderError",
    "GoogleCalendarProvider",
    "MicrosoftCalendarProvider",
]
