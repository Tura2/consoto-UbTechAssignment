import { ChevronRight, CircleAlert, CircleCheck, CircleStop, Database, Gauge, Hourglass, Link2, LoaderCircle, RefreshCw, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LlmCaller } from "../../../shared/events";
import { cleanAnswer } from "../../../shared/text";
import { AGENT_NAMES, seconds, shortModel } from "../format";
import { sourceGroups } from "../sources";
import type { AgentView, StepView, TurnView } from "../state/turnReducer";
import { CardView } from "./Cards";
import { Elapsed } from "./Elapsed";
import { OWNER_ICON, OwnerTag, StatusIcon, toneClass } from "./icons";
import { ProgressStrip } from "./ProgressStrip";

// Models write GitHub-flavored markdown (tables included) even when asked not to; render it instead of showing pipes.
const GFM = [remarkGfm];
const OrchestratorIcon = OWNER_ICON.orchestrator;

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
            <button className="steps-toggle" aria-expanded={stepsOpen} onClick={() => setStepsOpen((open) => !open)}>
              <ChevronRight size={16} className="chevron" aria-hidden="true" />
              {stepsOpen ? "Hide" : "Show"} steps
              <span className="muted">
                {turn.steps.length} tool calls, {turn.llmCalls} LLM calls
              </span>
            </button>
            {stepsOpen && <Steps turn={turn} />}
          </section>
        )}
        {failedCalls.map((call, index) => (
          <div key={`call-${index}`} className="notice warn">
            {call.status === "rate_limited" ? <Gauge size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            <span>
              {call.status === "rate_limited"
                ? `${shortModel(call.model)} is rate limited${call.detail ? ` (${call.detail})` : ""}, so the next model takes over.`
                : `${shortModel(call.model)} failed (${call.detail ?? call.status}), so the next model takes over.`}
            </span>
          </div>
        ))}
        {turn.waits.map((wait, index) => (
          <div key={`wait-${index}`} className="notice warn">
            <Hourglass size={16} aria-hidden="true" />
            <span>
              {wait.reason === "local_limit"
                ? `Waiting ${Math.ceil(wait.waitMs / 1000)} s for a free LLM slot (staying under the rate limit).`
                : `All models are busy, so trying again in ${Math.ceil(wait.waitMs / 1000)} s.`}
            </span>
          </div>
        ))}
        {turn.cards.map((card, index) => (
          <CardView key={index} card={card} />
        ))}
        {turn.answer && (
          <div className="bubble answer">
            <Markdown remarkPlugins={GFM}>{cleanAnswer(turn.answer)}</Markdown>
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
    <div className="plan planning tone-orchestrator" role="status">
      <OrchestratorIcon size={16} className="tone-icon" aria-hidden="true" />
      <strong>Orchestrator</strong> is choosing which agents to run
      <LoaderCircle size={16} className="spin" aria-hidden="true" />
      {turn.startedAt !== null && (
        <span className="muted">
          <Elapsed since={turn.startedAt} />
        </span>
      )}
    </div>
  );
}

function PlanLine({ turn }: { turn: TurnView }) {
  const plan = turn.plan!;
  return (
    <div className="plan tone-orchestrator">
      <OrchestratorIcon size={16} className="tone-icon" aria-hidden="true" />
      <strong>Orchestrator</strong>
      {plan.agents.length > 0 && (
        <>
          <span>runs</span>
          {plan.agents.map((entry) => (
            <OwnerTag key={entry.agent} owner={entry.agent} />
          ))}
        </>
      )}
      <span className="plan-reason">{plan.reason}</span>
      <span className="badge">
        <Timer size={12} aria-hidden="true" /> Plan ready in {seconds(plan.ms)}
      </span>
    </div>
  );
}

function Steps({ turn }: { turn: TurnView }) {
  const byCode = turn.steps.filter((step) => step.owner === "orchestrator");
  return (
    <div className="steps">
      <LlmLine turn={turn} who="planner" label="Plan" />
      {turn.agents.map((agent) => {
        const Icon = OWNER_ICON[agent.agent];
        return (
          <div key={agent.agent} className={`group ${toneClass(agent.agent)}`}>
            <div className="group-head">
              <Icon size={16} className="tone-icon" aria-hidden="true" />
              <strong>{AGENT_NAMES[agent.agent]}</strong>
              <StatusIcon status={agent.status} size={15} />
              <AgentTime agent={agent} />
            </div>
            {agent.summary && (
              <div className="agent-summary">
                <Markdown remarkPlugins={GFM}>{cleanAnswer(agent.summary)}</Markdown>
              </div>
            )}
            {turn.steps.filter((step) => step.owner === agent.agent).map((step) => (
              <StepRow key={step.callId} step={step} />
            ))}
            <LlmLine turn={turn} who={agent.agent} label="Model" />
          </div>
        );
      })}
      {byCode.length > 0 && (
        <div className="group tone-orchestrator">
          <div className="group-head">
            <OrchestratorIcon size={16} className="tone-icon" aria-hidden="true" />
            <strong>Orchestrator</strong>
            <span className="muted">code, no model</span>
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
  const groups = useMemo(() => sourceGroups(turn.steps), [turn.steps]);
  if (turn.status === "running" || groups.length === 0) return null;
  return (
    <div className="sources">
      <span className="sources-label">
        <Link2 size={14} aria-hidden="true" /> Sources
      </span>
      {groups.map((group) => {
        const title = group.details.join(", ") || undefined;
        return group.url ? (
          <a key={group.provider} className="chip source" href={group.url} target="_blank" rel="noreferrer" title={title}>{group.provider}</a>
        ) : (
          <span key={group.provider} className="chip source" title={title}>{group.provider}</span>
        );
      })}
    </div>
  );
}

function LlmLine({ turn, who, label }: { turn: TurnView; who: LlmCaller; label: string }) {
  const calls = turn.llm.filter((call) => call.who === who);
  if (calls.length === 0) return null;
  return (
    <div className="llm-line">
      {label}: {calls.map((call) => `${shortModel(call.model)} ${call.status} (${seconds(call.ms)})`).join(", ")}
    </div>
  );
}

function StepRow({ step }: { step: StepView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`step step-${step.status}`}>
      <button className="step-line" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={14} className="chevron" aria-hidden="true" />
        <StatusIcon status={step.status} size={15} />
        <code>{step.tool}</code>
        <span className="step-summary">{step.summary || "running..."}</span>
        {step.cached && (
          <span className="badge">
            <Database size={11} aria-hidden="true" /> cached
          </span>
        )}
        {step.ms !== null && <span className="muted step-ms">{step.ms} ms</span>}
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

function Footer({ turn, onRetry }: { turn: TurnView; onRetry: () => void }) {
  if (turn.status === "running") return null;
  if (turn.status === "done") {
    return (
      <div className="footer">
        <CircleCheck size={14} aria-hidden="true" /> Done in {seconds(turn.ms)}, {turn.llmCalls} LLM calls.
      </div>
    );
  }
  if (turn.status === "stopped") {
    return (
      <div className="footer">
        <CircleStop size={14} aria-hidden="true" /> Stopped.
      </div>
    );
  }
  return (
    <div className="footer error">
      <CircleAlert size={14} aria-hidden="true" /> {turn.error ?? "Something went wrong."} <button onClick={onRetry}>Try again</button>
    </div>
  );
}
