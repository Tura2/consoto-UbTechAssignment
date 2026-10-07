// Chat state: the turns on screen, sending, stopping, and reloading a conversation from the URL (?c=<id>).
import { useEffect, useRef, useState } from "react";
import { getConversation, streamChat } from "../api";
import { applyEvent, newTurn, turnFromEvents, type TurnView } from "../state/turnReducer";

function conversationFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("c");
}

export function useChat() {
  const [conversationId, setConversationId] = useState<string | null>(conversationFromUrl);
  const [turns, setTurns] = useState<TurnView[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  async function loadConversation(id: string) {
    const conversation = await getConversation(id);
    if (!conversation) throw new Error("That conversation no longer exists.");
    setTurns(conversation.turns.map((t) => turnFromEvents(t.id, t.userMessage, t.events, t.status)));
  }

  useEffect(() => {
    const id = conversationFromUrl();
    if (id) loadConversation(id).catch(() => {});
  }, []);

  const update = (id: string, change: (turn: TurnView) => TurnView) =>
    setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));

  async function send(message: string) {
    controllerRef.current?.abort(); // a new message stops the running turn (the server does the same)
    const controller = new AbortController();
    controllerRef.current = controller;
    let turnId = `local-${Date.now()}`;
    setTurns((all) => [...all, newTurn(turnId, message, Date.now())]);
    try {
      await streamChat({
        conversationId,
        message,
        signal: controller.signal,
        onEvent: (event) => {
          const id = turnId;
          if (event.type === "turn_start") {
            turnId = event.turnId;
            setConversationId(event.conversationId);
            window.history.replaceState(null, "", `?c=${event.conversationId}`);
          }
          update(id, (turn) => applyEvent(turn, event, Date.now()));
        },
      });
      update(turnId, (turn) =>
        turn.status === "running" ? { ...turn, status: "error", error: "The connection closed before the turn finished." } : turn,
      );
    } catch (error) {
      const stopped = controller.signal.aborted;
      update(turnId, (turn) =>
        turn.status === "running" ? { ...turn, status: stopped ? "stopped" : "error", error: stopped ? null : (error as Error).message } : turn,
      );
    }
  }

  function stop() {
    controllerRef.current?.abort();
  }

  function newChat() {
    stop();
    setTurns([]);
    setConversationId(null);
    window.history.replaceState(null, "", window.location.pathname);
  }

  // Opens a saved conversation from the History panel. The next message continues it.
  async function openConversation(id: string) {
    stop();
    await loadConversation(id);
    setConversationId(id);
    window.history.replaceState(null, "", `?c=${id}`);
  }

  return { turns, conversationId, running: turns.some((turn) => turn.status === "running"), send, stop, newChat, openConversation };
}
