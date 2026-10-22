from channels.generic.websocket import AsyncJsonWebsocketConsumer


class GameConsumer(AsyncJsonWebsocketConsumer):
    """One socket per participant; all sockets for a game share group `game_<code>`.

    TODO:
      connect():    reject anonymous (close 4401), validate game code exists, group_add
      receive_json: validate payload against schemas.ClientAction, dispatch to handlers
      handlers:     lobby_join, answer_submit (-> services.scoring), host_start, host_next
      group events: broadcast_event(self, event) -> send_json to client
      disconnect(): group_discard, mark player disconnected
    Wrap DB work in try/except and send an ERROR event instead of crashing the socket.
    """

    async def connect(self):
        await self.close(code=4501)  # not implemented yet
