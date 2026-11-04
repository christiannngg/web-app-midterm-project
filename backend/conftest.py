import pytest

from apps.games.services import timer


@pytest.fixture(autouse=True)
def in_memory_channel_layer(settings):
    """Tests must not need a running Redis: swap the Channels layer for an in-process one."""
    settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


@pytest.fixture(autouse=True)
def fast_reveal(settings):
    """Keep the pause between questions short so a full game finishes in well under a second."""
    settings.TRIVIA_REVEAL_SECONDS = 0.05


@pytest.fixture(autouse=True)
async def stop_game_timers():
    """A started game keeps an asyncio timer task alive; cancel it when the test ends."""
    yield
    await timer.shutdown()
