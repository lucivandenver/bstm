import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { AiJob } from "../models/portalModels.js";

const events = new EventEmitter();
const tickets = new Map();
export function signalCourseJob(id) {
  events.emit(String(id));
}
async function owned(req) {
  return AiJob.count({
    where: { id: req.params.id, userId: req.user.id, type: "course-draft" },
  });
}
export async function streamJob(req, res) {
  if (!(await owned(req))) return res.sendStatus(404);
  const id = String(req.params.id);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const notify = () => res.write("data: update\n\n");
  events.on(id, notify);
  notify();
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 20000);
  const expiry = setTimeout(() => res.end(), 10 * 60000);
  res.on("close", () => {
    events.off(id, notify);
    clearInterval(heartbeat);
    clearTimeout(expiry);
  });
}
export async function issueTicket(req, res) {
  if (!(await owned(req))) return res.sendStatus(404);
  const now = Date.now();
  for (const [key, entry] of tickets)
    if (entry.expires <= now) tickets.delete(key);
  if (tickets.size >= 1000) return res.sendStatus(503);
  const ticket = randomBytes(24).toString("hex");
  tickets.set(ticket, { id: String(req.params.id), expires: now + 15000 });
  res.set("Cache-Control", "no-store").json({ ticket });
}
export function attachCourseSockets(server) {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 256,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/faculty/live") return socket.destroy();
    let origin;
    try {
      origin = new URL(req.headers.origin);
    } catch {
      return socket.destroy();
    }
    const ticket = req.headers["sec-websocket-protocol"];
    const entry = tickets.get(ticket);
    if (
      !entry ||
      entry.expires < Date.now() ||
      origin.host !== req.headers.host
    )
      return socket.destroy();
    tickets.delete(ticket);
    sockets.handleUpgrade(req, socket, head, (ws) => {
      const notify = () => {
        if (ws.readyState === 1) ws.send("update");
      };
      events.on(entry.id, notify);
      const expiry = setTimeout(() => ws.close(), 10 * 60000);
      ws.on("error", () => ws.terminate());
      ws.on("message", () => ws.close(1008));
      ws.once("close", () => {
        events.off(entry.id, notify);
        clearTimeout(expiry);
      });
      notify();
    });
  });
  server.once("close", () => sockets.close());
}
