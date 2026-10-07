import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import type { LlmCaller } from "../../../shared/events";
import { cleanAnswer } from "../../../shared/text";
import { AGENT_NAMES, seconds, shortModel } from "../format";
import { uniqueSources } from "../sources";
import type { AgentView, StepView, TurnView } from "../state/turnReducer";
import { CardView } from "./Cards";
import { Elapsed } from "./Elapsed";
import { ProgressStrip } from "./ProgressStrip";

export function TurnBlock({ turn, onRetry }: { turn: TurnView; onRetry: () => void }) {
  const [stepsOpen, setStepsOpen] = useState(true);
  useEffect(() => {
    if (turn.status === "done") setStepsOpen(false);
  }, [turn.status]);
  const failedCalls = turn.llm.filter((call) => call.status !== "ok");

  return (
    <article className="turn">
      <div className="bubble user">{turn.userMessage}</div>
      <div className="assistant">
        {(turn.plan || turn.status === "running") && <ProgressStrip turn={turn} />}
        {turn.plan ? <PlanLine turn={turn} /> : turn.status === "running" && <PlanningLine turn={turn} />}
        {(turn.agents.length > 0 || turn.steps.length > 0) && (
          <section className="steps-box">
            <button className="link" aria-expanded={stepsOpen} onClick={() => setStepsOpen((open) => !open)}>
              {stepsOpen ? "Hide" : "Show"} steps ({turn.steps.length} tool calls, {turn.llmCalls} LLM calls)
            </button>
            {stepsOpen && <Steps turn={turn} />}
          </section>
        )}
        {failedCalls.map((call, index) => (
          <div key={`call-${index}`} className="notice warn">
            {call.status === "rate_limited"
              ? `${shortModel(call.model)} is rate limited${call.detail ? ` (${call.detail})` : ""}, so the next model takes over.`
              : `${shortModel(call.model)} failed (${call.detail ?? call.status}), so the next model takes over.`}
          </div>
        ))}
        {turn.waits.map((wait, index) => (
          <div key={`wait-${index}`} className="notice warn">
            {wait.reason === "local_limit"
              ? `Waiting ${Math.ceil(wait.waitMs / 1000)} s for a free LLM slot (staying under the rate limit).`
              : `All models are busy, so trying again in ${Math.ceil(wait.waitMs / 1000)} s.`}
          </div>
        ))}
        {turn.cards.map((card, index) => (
          <CardView key={index} card={card} />
        ))}
        {turn.answer && (
          <div className="bubble answer">
            <Markdown>{cleanAnswer(turn.answer)}</Markdown>
          </div>
        )}
        <SourcesRow turn={turn} />
        <Footer turn={turn} onRetry={onRetry} />
      </div>
    </article>
  );
}

// Shown between the message and the plan, while the planner model is choosing the agents.
function PlanningLine({ turn }: { turn: TurnView }) {
  return (
    <div className="plan planning" role="status">
      <span className="spinner" aria-hidden="true" /> <strong>Orchestrator</strong> is choosing which agents to run
      {turn.startedAt !== null && (
        <>
          {" "}
          <span className="muted"><Elapsed since={turn.startedAt} /></span>
        </>
      )}
    </div>
  );
}

function PlanLine({ turn }: { turn: TurnView }) {
  const plan = turn.plan!;
  return (
    <div className="plan">
      <strong>Orchestrator:</strong>{" "}
      {plan.agents.length > 0 && (
        <>
          running{" "}
          {plan.agents.map((entry) => (
            <span key={entry.agent} className="chip">{AGENT_NAMES[entry.agent]}</span>
          ))}{" "}
        </>
      )}
      <span className="muted">{plan.reason}</span> <span className="badge">Plan ready in {seconds(plan.ms)}</span>
    </div>
  );
}

function Steps({ turn }: { turn: TurnView }) {
  const byCode = turn.steps.filter((step) => step.owner === "orchestrator");
  return (
    <div className="steps">
      <LlmLine turn={turn} who="planner" label="Plan" />
      {turn.agents.map((agent) => (
        <div key={agent.agent} className="group">
          <div className="group-head">
            <StatusIcon status={agent.status} />
            <strong>{AGENT_NAMES[agent.agent]}</strong>
            <AgentTime agent={agent} />
          </div>
          {agent.summary && (
            <div className="muted agent-summary">
              <Markdown>{cleanAnswer(agent.summary)}</Markdown>
            </div>
          )}
          {turn.steps.filter((step) => step.owner === agent.agent).map((step) => (
            <StepRow key={step.callId} step={step} />
          ))}
          <LlmLine turn={turn} who={agent.agent} label="Model" />
        </div>
      ))}
      {byCode.length > 0 && (
        <div className="group">
          <div className="group-head">
            <StatusIcon status="ok" />
            <strong>Orchestrator (code, no model)</strong>
          </div>
          {byCode.map((step) => (
            <StepRow key={step.callId} step={step} />
          ))}
        </div>
      )}
      <LlmLine turn={turn} who="answer" label="Answer" />
    </div>
  );
}

function AgentTime({ agent }: { agent: AgentView }) {
  if (agent.status === "running") {
    return <span className="muted">running{agent.startedAt !== null && <> <Elapsed since={agent.startedAt} /></>}</span>;
  }
  const time = agent.ms === null ? "" : ` after ${seconds(agent.ms)}`;
  const text = { ok: `done in ${seconds(agent.ms)}`, error: `failed${time}`, timeout: `timed out${time}` }[agent.status];
  return <span className="muted">{text}</span>;
}

// The data sources behind this turn's answer, from the tool calls that succeeded.
function SourcesRow({ turn }: { turn: TurnView }) {
  const sources = useMemo(() => uniqueSources(turn.steps), [turn.steps]);
  if (turn.status === "running" || sources.length === 0) return null;
  return (
    <div className="sources">
      <span className="muted">Sources</span>
      {sources.map((source) =>
        source.url.startsWith("http") ? (
          <a key={source.name} className="chip" href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
        ) : (
          <span key={source.name} className="chip">{source.name}</span>
        ),
      )}
    </div>
  );
}

function LlmLine({ turn, who, label }: { turn: TurnView; who: LlmCaller; label: string }) {
  const calls = turn.llm.filter((call) => call.who === who);
  if (calls.length === 0) return null;
  return (
    <div className="llm-line muted">
      {label}: {calls.map((call) => `${shortModel(call.model)} ${call.status} (${seconds(call.ms)})`).join(", ")}
    </div>
  );
}

function StepRow({ step }: { step: StepView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`step step-${step.status}`}>
      <button className="step-line" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <StatusIcon status={step.status} />
        <code>{step.tool}</code>
        <span className="step-summary">{step.summary || "running..."}</span>
        {step.cached && <span className="badge muted">cached</span>}
        {step.ms !== null && <span className="muted">{step.ms} ms</span>}
      </button>
      {open && (
        <div className="step-details">
          <Detail title="Input" value={step.input} />
          {step.status !== "running" && <Detail title="Output" value={step.data} />}
          {step.gaps.length > 0 && (
            <div>
              <h5>Gaps</h5>
              <ul>{step.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
            </div>
          )}
          {step.sources.length > 0 && (
            <div>
              <h5>Sources</h5>
              <ul>
                {step.sources.map((source, index) => (
                  <li key={index}>
                    {source.url.startsWith("http") ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> : source.name}{" "}
                    <span className="muted">
                      fetched {new Date(source.fetchedAt).toLocaleString()}
                      {source.cached ? " (from cache)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <h5>{title}</h5>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const symbol = status === "running" ? "..." : status === "ok" ? "✓" : status === "timeout" ? "⏱" : "!";
  return <span className={`status status-${status}`} aria-label={status}>{symbol}</span>;
}

function Footer({ turn, onRetry }: { turn: TurnView; onRetry: () => void }) {
  if (turn.status === "running") return null;
  if (turn.status === "done") return <div className="footer muted">Done in {seconds(turn.ms)}, {turn.llmCalls} LLM calls.</div>;
  if (turn.status === "stopped") return <div className="footer muted">Stopped.</div>;
  return (
    <div className="footer error">
      {turn.error ?? "Something went wrong."} <button onClick={onRetry}>Try again</button>
    </div>
  );
}
