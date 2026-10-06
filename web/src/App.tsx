import { useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { EmptyState } from "./components/EmptyState";
import { Header } from "./components/Header";
import { HowItWorks } from "./components/HowItWorks";
import { TurnBlock } from "./components/TurnBlock";
import { DEMO_MESSAGES } from "./demo";
import { useChat } from "./hooks/useChat";

export function App() {
  const chat = useChat();
  const [showHow, setShowHow] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const last = chat.turns[chat.turns.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.turns.length, last?.answer.length, last?.steps.length, last?.cards.length]);
  const count = chat.turns.length;
  const suggestion = count > 0 && count < DEMO_MESSAGES.length ? DEMO_MESSAGES[count] : null;

  return (
    <div className="app">
      <Header onHowItWorks={() => setShowHow(true)} onNewChat={chat.newChat} />
      <main className="chat">
        {count === 0 ? (
          <EmptyState onPick={chat.send} />
        ) : (
          chat.turns.map((turn) => <TurnBlock key={turn.id} turn={turn} onRetry={() => chat.send(turn.userMessage)} />)
        )}
        <div ref={endRef} />
      </main>
      <Composer running={chat.running} suggestion={suggestion} onSend={chat.send} onStop={chat.stop} />
      {showHow && <HowItWorks onClose={() => setShowHow(false)} />}
    </div>
  );
}
