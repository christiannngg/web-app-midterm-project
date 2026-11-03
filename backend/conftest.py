import pytest


@pytest.fixture(autouse=True)
def in_memory_channel_layer(settings):
    """Tests must not need a running Redis: swap the Channels layer for an in-process one."""
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
