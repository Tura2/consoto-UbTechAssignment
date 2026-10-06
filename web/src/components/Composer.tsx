import { useState } from "react";

export function Composer(props: { running: boolean; suggestion: string | null; onSend: (message: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  function submit() {
    const message = text.trim();
    if (!message) return;
    props.onSend(message);
    setText("");
  }
  return (
    <footer className="composer">
      {props.suggestion && !props.running && (
        <button className="suggestion" onClick={() => props.onSend(props.suggestion!)}>
          Next demo message: {props.suggestion}
        </button>
      )}
      <div className="composer-row">
        <textarea
          value={text}
          rows={2}
          placeholder="Ask about an offsite..."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {props.running && !text.trim() ? (
          <button className="stop" onClick={props.onStop}>Stop</button>
        ) : (
          <button className="primary" onClick={submit} disabled={!text.trim()}>
            {props.running ? "Send (stops the current turn)" : "Send"}
          </button>
        )}
      </div>
    </footer>
  );
}
