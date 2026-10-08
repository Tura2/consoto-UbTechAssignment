// HTTP routes. POST /api/chat streams one turn as server-sent events.
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { z } from "zod";
import type { HealthInfo } from "../../shared/events";
import { agentsInfo } from "./agents/registry";
import { runTurn, type TurnDeps } from "./orchestrator/turn";
import type { Store } from "./state/conversations";

export type AppDeps = { store: Store; turnDeps: TurnDeps; health: () => Promise<HealthInfo>; webDist: string | null };

const ChatBody = z.object({
  conversationId: z.string().min(1).max(100).nullish(),
  message: z.string().trim().min(1).max(2_000),
});

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: "20kb" }));

  app.post("/api/chat", async (req, res) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: z.prettifyError(body.error) });
      return;
    }
    const conversation = deps.store.getOrCreate(body.data.conversationId);
    conversation.active?.abort(); // one turn at a time: a new message stops the running one
    const controller = new AbortController();
    conversation.active = controller;

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const write = (chunk: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    };
    const ping = setInterval(() => write(": ping\n\n"), 15_000);
    res.on("close", () => {
      if (!res.writableFinished) controller.abort(); // the browser left: stop the work
    });

    try {
      await runTurn(conversation, body.data.message, deps.turnDeps, (event) => write(`data: ${JSON.stringify(event)}\n\n`), controller.signal);
    } finally {
      deps.store.save(conversation);
      clearInterval(ping);
      if (conversation.active === controller) conversation.active = null;
      res.end();
    }
  });

  app.get("/api/conversations", (_req, res) => {
    res.json({ conversations: deps.store.list() });
  });

  app.get("/api/conversations/:id", (req, res) => {
    const conversation = deps.store.get(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ id: conversation.id, turns: conversation.turns });
  });

  app.get("/api/health", async (_req, res) => {
    res.json(await deps.health());
  });

  app.get("/api/agents", (_req, res) => {
    res.json(agentsInfo());
  });

  const webDist = deps.webDist;
  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) res.sendFile(path.join(webDist, "index.html"));
      else next();
    });
  }
  return app;
}
