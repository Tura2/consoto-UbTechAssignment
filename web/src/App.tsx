import { type UIEvent, useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { Header } from "./components/Header";
import { HowItWorks } from "./components/HowItWorks";
import { TurnBlock } from "./components/TurnBlock";
import { nextDemoMessage } from "./demo";
import { useChat } from "./hooks/useChat";
import { keepFollowing } from "./scroll";

export function App() {
  const chat = useChat();
  const [showHow, setShowHow] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lastTopRef = useRef(0);
  const last = chat.turns[chat.turns.length - 1];
  useEffect(() => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.turns.length, last?.answer.length, last?.steps.length, last?.cards.length]);
  // Follow the stream until the user scrolls up, so reading or expanding a step mid-stream does not jump.
  const onScroll = (event: UIEvent<HTMLElement>) => {
    followRef.current = keepFollowing(followRef.current, lastTopRef.current, event.currentTarget);
    lastTopRef.current = event.currentTarget.scrollTop;
  };
  const send = (message: string) => {
    followRef.current = true;
    chat.send(message);
  };
  const count = chat.turns.length;
  const suggestion = nextDemoMessage(chat.turns);

  return (
    <div className="app">
      <Header onHowItWorks={() => setShowHow(true)} onNewChat={chat.newChat} />
      <main className="chat" onScroll={onScroll}>
        {count === 0 ? (
          <EmptyState onPick={send} />
        ) : (
          chat.turns.map((turn) => <TurnBlock key={turn.id} turn={turn} onRetry={() => send(turn.userMessage)} />)
        )}
        <div ref={endRef} />
      </main>
      <Composer running={chat.running} suggestion={suggestion} onSend={send} onStop={chat.stop} />
      {showHow && <HowItWorks onClose={() => setShowHow(false)} />}
    </div>
  );
}
