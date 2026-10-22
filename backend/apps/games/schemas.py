"""WebSocket protocol — keep in sync with frontend/src/types/ws.ts.

Client -> Server:  LOBBY_JOIN, ANSWER_SUBMIT, HOST_START, HOST_NEXT
Server -> Client:  LOBBY_STATE, QUESTION_PUSH, SCORE_SYNC, GAME_END, ERROR
"""
from enum import StrEnum


class ClientAction(StrEnum):
    LOBBY_JOIN = "LOBBY_JOIN"
    ANSWER_SUBMIT = "ANSWER_SUBMIT"
    HOST_START = "HOST_START"
    HOST_NEXT = "HOST_NEXT"


class ServerEvent(StrEnum):
    LOBBY_STATE = "LOBBY_STATE"
    QUESTION_PUSH = "QUESTION_PUSH"
    SCORE_SYNC = "SCORE_SYNC"
    GAME_END = "GAME_END"
    ERROR = "ERROR"
