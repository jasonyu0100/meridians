/** Conviction LIVE — the GM's SHARE panel. Opening it puts the game LIVE (mints a
 *  guest pass per seat) and shows, for each seat, an invite link + QR code. Scan
 *  or send one and that player lands in the locked seat UI (/play/<id>?t=<token>)
 *  — only Conviction, only their seat. The GM picks the public URL (the Cloudflare
 *  tunnel) so the QR resolves from a phone off the GM's machine. */
"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { Modal, ModalHeader } from "@/components/Modal";
import { perspectiveName } from "@/components/stage/RoomUI";
import { IconCopy } from "@/components/icons";
import type { GameRoom, NarrativeState } from "@/types/narrative";

export function ShareGameModal({
  room,
  narrative,
  canHost = true,
  onClose,
  onStopHosting,
}: {
  room: GameRoom;
  narrative: NarrativeState;
  /** Host controls — only the GM may open/close the tunnel and stop hosting. A
   *  player opens this sheet purely to copy and forward the already-minted links. */
  canHost?: boolean;
  onClose: () => void;
  onStopHosting: () => void;
}) {
  const [base, setBase] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const [qr, setQr] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState<{ running: boolean; url: string | null; busy: boolean; error: string | null }>({
    running: false,
    url: null,
    busy: false,
    error: null,
  });

  // On open, pick up a tunnel that's already running (survives modal re-opens / HMR)
  // and adopt its URL as the public base.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tunnel")
      .then((r) => r.json())
      .then((s: { running?: boolean; url?: string | null }) => {
        if (cancelled || !s.running || !s.url) return;
        setTunnel({ running: true, url: s.url, busy: false, error: null });
        setBase(s.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const startTunnel = async () => {
    setTunnel((t) => ({ ...t, busy: true, error: null }));
    try {
      const res = await fetch("/api/tunnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const s = (await res.json()) as { url?: string | null; error?: string };
      if (s.url) {
        setTunnel({ running: true, url: s.url, busy: false, error: null });
        setBase(s.url);
      } else {
        setTunnel({ running: false, url: null, busy: false, error: s.error ?? "Tunnel failed to start" });
      }
    } catch {
      setTunnel({ running: false, url: null, busy: false, error: "Tunnel request failed" });
    }
  };

  const localBase = () => (typeof window !== "undefined" ? window.location.origin : "");

  // One "Stop hosting" tears the whole live session down: close the tunnel, drop
  // every guest pass (onStopHosting → live:false), and revert the share base to
  // localhost so the links don't keep pointing at the dead tunnel URL.
  const stopHosting = async () => {
    setTunnel((t) => ({ ...t, busy: true }));
    await fetch("/api/tunnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    }).catch(() => {});
    setTunnel({ running: false, url: null, busy: false, error: null });
    setBase(localBase());
    onStopHosting();
    onClose();
  };

  const passes = room.guestPasses ?? [];
  const cleanBase = base.replace(/\/+$/, "");
  const linkFor = (token: string) => `${cleanBase}/play/${room.id}?t=${token}`;
  const nameOf = (seatId: string) =>
    perspectiveName(narrative.perspectives?.[room.seats[seatId]?.perspectiveId], narrative);

  const passKey = passes.map((p) => p.token).join(",");

  // Render a QR per invite whenever the base or the passes change.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      passes.map(async (p) => [p.token, await QRCode.toDataURL(linkFor(p.token), { margin: 1, width: 240 })] as const),
    ).then((entries) => {
      if (!cancelled) setQr(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanBase, passKey]);

  const copy = (token: string) => {
    void navigator.clipboard?.writeText(linkFor(token));
    setCopied(token);
    setTimeout(() => setCopied((t) => (t === token ? null : t)), 1500);
  };

  const playerPasses = passes.filter((p) => room.seats[p.seatId]?.driver === "human");
  const agentPasses = passes.filter((p) => room.seats[p.seatId]?.driver === "agent");

  const renderCard = (p: (typeof passes)[number]) => (
    <div key={p.token} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/2 p-3">
      {qr[p.token] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr[p.token]} alt="invite QR" width={88} height={88} className="shrink-0 rounded bg-white p-1" />
      ) : (
        <div className="h-22 w-22 shrink-0 animate-pulse rounded bg-white/10" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: room.seats[p.seatId]?.color ?? "#888" }} />
          <span className="truncate text-[13px] font-semibold">{nameOf(p.seatId)}</span>
          {room.seats[p.seatId]?.driver === "agent" && (
            <span className="rounded bg-violet-500/80 px-1 text-[8px] font-bold text-white">AI</span>
          )}
        </div>
        <div className="truncate font-mono text-[10px] text-text-dim/60">{linkFor(p.token)}</div>
        <button
          onClick={() => copy(p.token)}
          className="flex items-center gap-1 self-start rounded-md border border-white/12 px-2 py-1 text-[11px] text-text-secondary transition hover:bg-white/5"
        >
          <IconCopy size={12} />
          {copied === p.token ? "Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );

  return (
    <Modal onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>Invite players</ModalHeader>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-[12px] leading-relaxed text-text-secondary">
          The game is <span className="font-semibold text-green-300">live</span>. Send a player their link or have them
          scan the QR — they join straight into their seat, locked to Conviction (they can&rsquo;t see the rest of the
          narrative). You stay the host and the table syncs in real time.
        </p>

        {/* Public URL — defaults to where you opened the app; set it to your
            Cloudflare tunnel so a phone off your machine can reach it. */}
        <label className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-text-dim/60">Public URL (ngrok tunnel)</span>
            {tunnel.running ? (
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-green-300">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px] shadow-green-400" />
                Tunnel live
              </span>
            ) : (
              canHost && (
                <button
                  onClick={startTunnel}
                  disabled={tunnel.busy}
                  className="ml-auto flex items-center gap-1.5 rounded-md border border-accent/40 px-2 py-0.5 text-[10px] font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-50"
                >
                  {tunnel.busy && <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-accent/30 border-t-accent" />}
                  {tunnel.busy ? "Starting tunnel…" : "Start tunnel"}
                </button>
              )
            )}
          </div>
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            readOnly={!canHost}
            placeholder="https://your-tunnel.ngrok-free.app"
            className="w-full rounded-md border border-white/10 bg-bg-field/60 px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-accent/40 read-only:opacity-70"
          />
          {tunnel.error === "ngrok-auth-required" ? (
            <span className="text-[10px] text-amber-300/80">
              ngrok needs an authtoken — set <code className="font-mono">NGROK_AUTH_TOKEN</code> in <code className="font-mono">.env.local</code> (free at ngrok.com), then retry.
            </span>
          ) : tunnel.error ? (
            <span className="text-[10px] text-rose-300/80">{tunnel.error}</span>
          ) : tunnel.running ? (
            <span className="text-[10px] text-green-300/80">Tunnel live — players reach your table through this URL. Stop it when you&rsquo;re done.</span>
          ) : (
            <span className="text-[10px] text-text-dim/50">
              Click to open an ngrok tunnel so players can reach you off your machine — or paste a public URL by hand.
            </span>
          )}
        </label>

        {/* Two groups, divided: the MEMBER seats (meant for players) and the AGENT
            seats a player can take over. gm-proxy seats are the GM's own — no link. */}
        {playerPasses.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sky-300/70">Players</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{playerPasses.map(renderCard)}</div>
          </section>
        )}

        {playerPasses.length > 0 && agentPasses.length > 0 && <div className="border-t border-white/8" />}

        {agentPasses.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300/70">
              Playable agents
              <span className="font-normal normal-case tracking-normal text-text-dim/45">— a player can take one over; leaving hands it back to the AI</span>
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{agentPasses.map(renderCard)}</div>
          </section>
        )}

        <div className="flex items-center justify-between border-t border-white/8 pt-3">
          <span className="text-[11px] text-text-dim/60">A player who takes an AI seat flies it until they leave — then the agent resumes.</span>
          {/* One control ends the live session for everyone: closes the tunnel,
              drops the guest passes, and reverts links to localhost. Host only. */}
          {canHost && (
            <button
              onClick={stopHosting}
              disabled={tunnel.busy}
              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-[12px] text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-40"
            >
              {tunnel.busy ? "Stopping…" : "Stop hosting"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
