"""WebSocket protocol — keep in sync with frontend/src/types/ws.ts.

Envelope (both directions): {"type": "<NAME>", "payload": {...}}. Payload keys are camelCase.

Client -> Server:
    LOBBY_JOIN     {}                         player: "I'm in the room" (marks them connected)
    HOST_KICK      {playerId: int}            host: ban a player from this game
    HOST_LOCK      {locked: bool}             host: open/close the lobby to new joins
    HOST_START     {}                         host: leave the lobby and begin the game
    ANSWER_SUBMIT  {questionId, choiceId}     player: answer the open question (once)
    HOST_NEXT      {}                         host: end the open question / skip the results pause
Server -> Client:
    LOBBY_STATE    {players: [...], status, locked}   sent on connect and after every change
    QUESTION_PUSH  {id, text, choices: [{id, text}], timeLimitSeconds, startedAtMs,
                    serverNowMs, index, total}        a question opened; never includes the answer
    ANSWER_PROGRESS {answered, total}                 after each accepted answer
    SCORE_SYNC     {leaderboard: [{id, nickname, score}], correctChoiceId,
                    awarded: [{playerId, points}]}    the question closed; reveal + new scores
    GAME_END       {leaderboard: [...]}               final standings (podium = first three)
    ERROR          {code, detail}             the socket stays open

Close codes (the browser sees these in `CloseEvent.code`):
    4401 unauthorized (missing/invalid token)   4403 forbidden (not this game's host/player)
    4404 game not found                          4410 kicked
"""
from enum import StrEnum
from typing import Any


class ClientAction(StrEnum):
    LOBBY_JOIN = "LOBBY_JOIN"
    HOST_KICK = "HOST_KICK"
    HOST_LOCK = "HOST_LOCK"
    HOST_START = "HOST_START"
    ANSWER_SUBMIT = "ANSWER_SUBMIT"
    HOST_NEXT = "HOST_NEXT"


class ServerEvent(StrEnum):
    LOBBY_STATE = "LOBBY_STATE"
    QUESTION_PUSH = "QUESTION_PUSH"
    ANSWER_PROGRESS = "ANSWER_PROGRESS"
    SCORE_SYNC = "SCORE_SYNC"
    GAME_END = "GAME_END"
    ERROR = "ERROR"


CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_NOT_FOUND = 4404
CLOSE_KICKED = 4410


class ProtocolError(Exception):
    """A client mistake. The consumer turns it into an ERROR event and keeps the socket open."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


def parse_client_message(content: Any) -> tuple[ClientAction, dict[str, Any]]:
    """Validate the envelope. Per-action payload checks live with each handler."""
    if not isinstance(content, dict):
        raise ProtocolError("bad_request", "Messages must be JSON objects.")
    try:
        action = ClientAction(content.get("type"))
    except ValueError:
        raise ProtocolError("unknown_action", "Unknown message type.") from None
    payload = content.get("payload", {})
    if not isinstance(payload, dict):
        raise ProtocolError("bad_request", "payload must be an object.")
    return action, payload
