import type {
  Award,
  Choice,
  GameStatus,
  LobbyPlayer,
  Player,
  QuestionPayload,
  ServerMessage,
} from "@/types/ws";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

function isArrayOf<T>(v: unknown, guard: (item: unknown) => item is T): v is T[] {
  return Array.isArray(v) && v.every(guard);
}

const GAME_STATUSES: readonly string[] = ["LOBBY", "IN_PROGRESS", "FINISHED"];
const isGameStatus = (v: unknown): v is GameStatus => isString(v) && GAME_STATUSES.includes(v);

const isPlayer = (v: unknown): v is Player =>
  isObject(v) && isNumber(v.id) && isString(v.nickname) && isNumber(v.score);

const isLobbyPlayer = (v: unknown): v is LobbyPlayer =>
  isObject(v) &&
  isNumber(v.id) &&
  isString(v.nickname) &&
  isNumber(v.score) &&
  isBoolean(v.connected);

const isAward = (v: unknown): v is Award =>
  isObject(v) && isNumber(v.playerId) && isNumber(v.points);

const isChoice = (v: unknown): v is Choice => isObject(v) && isNumber(v.id) && isString(v.text);

const isQuestionPayload = (v: unknown): v is QuestionPayload =>
  isObject(v) &&
  isNumber(v.id) &&
  isString(v.text) &&
  isArrayOf(v.choices, isChoice) &&
  isNumber(v.timeLimitSeconds) &&
  isNumber(v.startedAtMs) &&
  isNumber(v.serverNowMs) &&
  isNumber(v.index) &&
  isNumber(v.total);

/**
 * Turn a raw WebSocket frame into a typed ServerMessage, or null if it isn't one.
 * The server is ours, but a frame is still untrusted input: nothing reaches the store
 * without its shape being checked first (this is what keeps `any` out of the socket code).
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isString(raw)) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || !isString(data.type) || !isObject(data.payload)) return null;
  const p = data.payload;

  switch (data.type) {
    case "LOBBY_STATE":
      if (isArrayOf(p.players, isLobbyPlayer) && isGameStatus(p.status) && isBoolean(p.locked)) {
        return {
          type: "LOBBY_STATE",
          payload: { players: p.players, status: p.status, locked: p.locked },
        };
      }
      return null;
    case "QUESTION_PUSH":
      return isQuestionPayload(p) ? { type: "QUESTION_PUSH", payload: p } : null;
    case "ANSWER_PROGRESS":
      return isNumber(p.answered) && isNumber(p.total)
        ? { type: "ANSWER_PROGRESS", payload: { answered: p.answered, total: p.total } }
        : null;
    case "SCORE_SYNC":
      if (
        isArrayOf(p.leaderboard, isPlayer) &&
        isArrayOf(p.awarded, isAward) &&
        (p.correctChoiceId === null || isNumber(p.correctChoiceId))
      ) {
        return {
          type: "SCORE_SYNC",
          payload: {
            leaderboard: p.leaderboard,
            correctChoiceId: p.correctChoiceId,
            awarded: p.awarded,
          },
        };
      }
      return null;
    case "GAME_END":
      return isArrayOf(p.leaderboard, isPlayer)
        ? { type: "GAME_END", payload: { leaderboard: p.leaderboard } }
        : null;
    case "YOUR_ANSWER":
      return isNumber(p.questionId) && isNumber(p.choiceId)
        ? { type: "YOUR_ANSWER", payload: { questionId: p.questionId, choiceId: p.choiceId } }
        : null;
    case "PONG":
      return { type: "PONG", payload: {} };
    case "ERROR":
      return isString(p.code) && isString(p.detail)
        ? { type: "ERROR", payload: { code: p.code, detail: p.detail } }
        : null;
    default:
      return null;
  }
}
