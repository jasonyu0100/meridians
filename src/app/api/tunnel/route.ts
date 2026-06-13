/** Conviction LIVE — the NGROK tunnel manager. A local-first convenience for the
 *  GM: opens an ngrok tunnel (via the official `@ngrok/ngrok` agent SDK — no CLI
 *  binary, no log-parsing) straight to the Next server the GM is already running,
 *  and hands the public URL back so the Share modal can fill it in with one click.
 *
 *  The tunnel proxies straight to this same Next process, so remote players reach the
 *  exact server + in-process broker the GM's browser is the master of — players'
 *  intents flow up and update the master with zero extra infra.
 *
 *  Auth: the SDK reads the authtoken from NGROK_AUTH_TOKEN (or NGROK_AUTHTOKEN).
 *
 *  SECURITY NOTE: the tunnel exposes your WHOLE local app publicly, not just the
 *  locked /play seat. Share the per-seat /play links, not the bare tunnel root, and
 *  stop the tunnel when done. */
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The bits of an @ngrok/ngrok Listener we use. */
type Listener = { url(): string | null; close(): Promise<void> };

type TunnelState = { listener: Listener | null; url: string | null; starting: boolean; error: string | null };
// Survive HMR / route re-imports so a running tunnel isn't orphaned on recompile.
const g = globalThis as unknown as { __ngrokTunnel?: TunnelState };
const state: TunnelState = (g.__ngrokTunnel ??= { listener: null, url: null, starting: false, error: null });

function snapshot() {
  return Response.json({
    running: !!state.listener && !!state.url,
    url: state.url,
    starting: state.starting,
    error: state.error,
  });
}

async function stop() {
  try {
    await state.listener?.close();
  } catch {
    /* already gone */
  }
  state.listener = null;
  state.url = null;
  state.starting = false;
  state.error = null;
}

export async function GET() {
  return snapshot();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "stop") {
    await stop();
    return snapshot();
  }
  if (body.action !== "start") {
    return Response.json({ error: "unknown action" }, { status: 400 });
  }

  // Already up → return it (idempotent start).
  if (state.listener && state.url) return snapshot();

  const authtoken = process.env.NGROK_AUTH_TOKEN || process.env.NGROK_AUTHTOKEN;
  if (!authtoken) return Response.json({ error: "ngrok-auth-required" });

  // Tunnel to the GM's own Next server. Precedence: explicit TUNNEL_TARGET_PORT
  // (the Electron shell sets this) → the port THIS request arrived on → 3001.
  const host = req.headers.get("host") ?? "localhost:3001";
  const hostPort = host.includes(":") ? host.split(":")[1] : "3001";
  const port = Number((process.env.TUNNEL_TARGET_PORT || hostPort).replace(/\D/g, "")) || 3001;

  state.starting = true;
  state.error = null;
  state.url = null;

  try {
    // Native N-API addon — dynamic import keeps it off the build's static graph.
    const ngrok = await import("@ngrok/ngrok");
    const listener = (await ngrok.forward({ addr: port, authtoken })) as unknown as Listener;
    state.listener = listener;
    state.url = listener.url();
    state.starting = false;
    if (!state.url) {
      await stop();
      return Response.json({ error: "ngrok started but returned no URL" });
    }
    return snapshot();
  } catch (e) {
    state.starting = false;
    state.listener = null;
    const msg = e instanceof Error ? e.message : String(e);
    // Surface the common auth failure as a stable code the modal explains.
    const code = /authtoken|ERR_NGROK_(105|107|4018)|authentication/i.test(msg) ? "ngrok-auth-required" : msg;
    state.error = code;
    return Response.json({ error: code });
  }
}
