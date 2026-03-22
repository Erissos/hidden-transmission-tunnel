"use client";

import { useEffect, useRef, useState } from "react";

import { buildWebSocketUrl, joinRoom } from "@/lib/api";
import { createIdentity, decryptMessage, deriveRoomKey, encryptMessage } from "@/lib/crypto";
import { clearSessionState, loadStoredIdentity, storeIdentity } from "@/lib/session";
import type { ChatMessage, Identity, ServerEvent } from "@/lib/types";

type ConnectionState = "idle" | "connecting" | "connected";

export default function HomePage() {
  const socketRef = useRef<WebSocket | null>(null);
  const roomKeyRef = useRef<CryptoKey | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isConnectingRef = useRef(false);

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [nickname, setNickname] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<string[]>([]);
  const [status, setStatus] = useState("Awaiting channel code.");
  const [error, setError] = useState<string | null>(null);
  const [selfDestruct, setSelfDestruct] = useState("0");
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);

  useEffect(() => {
    if (retryAfterSeconds <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setRetryAfterSeconds((current) => (current > 1 ? current - 1 : 0));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [retryAfterSeconds]);

  useEffect(() => {
    const boot = async () => {
      const existing = loadStoredIdentity();
      if (existing) {
        setIdentity(existing);
        return;
      }
      const generated = await createIdentity();
      storeIdentity(generated);
      setIdentity(generated);
    };

    void boot();

    return () => {
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function resetConnectionState(nextStatus: string) {
    socketRef.current?.close();
    socketRef.current = null;
    roomKeyRef.current = null;
    isConnectingRef.current = false;
    setMessages([]);
    setPresence([]);
    setNickname(null);
    setConnectionState("idle");
    setStatus(nextStatus);
  }

  function parseRetryAfter(detail: string): number {
    const match = detail.match(/(\d+)\s+seconds/i);
    if (!match) {
      return 0;
    }
    return Number.parseInt(match[1], 10);
  }

  function handleDisconnect() {
    setError(null);
    resetConnectionState("Disconnected by user.");
  }

  async function handleRegenerateIdentity() {
    const generated = await createIdentity();
    storeIdentity(generated);
    setIdentity(generated);
    resetConnectionState("Anonymous local identity rotated. Reconnect to continue with the new keypair.");
  }

  function handlePanicMode() {
    clearSessionState();
    setRoomCode("");
    setMessageDraft("");
    resetConnectionState("Panic mode executed. Local session wiped.");
  }

  async function handleConnect() {
    if (!identity || isConnectingRef.current || connectionState !== "idle" || retryAfterSeconds > 0) {
      return;
    }

    try {
      isConnectingRef.current = true;
      setError(null);
      setRetryAfterSeconds(0);
      setConnectionState("connecting");
      setStatus("Negotiating anonymous entry.");
      setMessages([]);
      setPresence([]);

      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

      const joined = await joinRoom(roomCode);
      const roomKey = await deriveRoomKey(roomCode, joined.room_salt);
      roomKeyRef.current = roomKey;

      const socket = new WebSocket(buildWebSocketUrl(joined.ws_ticket));
      socketRef.current = socket;

      socket.onopen = () => {
        isConnectingRef.current = false;
        setConnectionState("connected");
        setNickname(joined.nickname);
        setStatus(`Connected to ${joined.room_id}. Relay sees ciphertext only.`);
        socket.send(
          JSON.stringify({
            type: "hello",
            public_key: identity.publicKey,
          }),
        );
      };

      socket.onmessage = async (event) => {
        const serverEvent = JSON.parse(event.data) as ServerEvent;

        if (serverEvent.type === "presence") {
          setPresence(serverEvent.payload.members);
          return;
        }

        if (serverEvent.type === "rate-limited" || serverEvent.type === "error") {
          setError(serverEvent.payload.detail);
          setRetryAfterSeconds(parseRetryAfter(serverEvent.payload.detail));
          return;
        }

        if (serverEvent.type === "participant-key") {
          return;
        }

        if (serverEvent.type === "ciphertext" && roomKeyRef.current) {
          const next = await decryptMessage(serverEvent.payload, roomKeyRef.current, joined.nickname);
          setMessages((current) => {
            if (current.some((message) => message.id === next.id)) {
              return current;
            }
            return [...current, next];
          });

          if (serverEvent.payload.self_destruct_seconds) {
            window.setTimeout(() => {
              setMessages((current) => current.filter((message) => message.id !== next.id));
            }, serverEvent.payload.self_destruct_seconds * 1000);
          }
        }
      };

      socket.onclose = () => {
        socketRef.current = null;
        roomKeyRef.current = null;
        isConnectingRef.current = false;
        setConnectionState("idle");
        setPresence([]);
        setNickname(null);
        setStatus("Disconnected.");
      };

      socket.onerror = () => {
        isConnectingRef.current = false;
        setError("WebSocket connection failed");
      };
    } catch (caught) {
      isConnectingRef.current = false;
      setConnectionState("idle");
      const message = caught instanceof Error ? caught.message : "Connection failed";
      setError(message);
      setRetryAfterSeconds(parseRetryAfter(message));
      setStatus("Connection failed.");
    }
  }

  async function handleSend() {
    if (!identity || !nickname || !socketRef.current || !roomKeyRef.current || !messageDraft.trim()) {
      return;
    }

    const selfDestructSeconds = Number.parseInt(selfDestruct, 10);
    const payload = await encryptMessage(
      messageDraft.trim(),
      roomKeyRef.current,
      identity,
      Number.isFinite(selfDestructSeconds) && selfDestructSeconds > 0 ? selfDestructSeconds : undefined,
    );
    socketRef.current.send(JSON.stringify(payload));
    setMessageDraft("");
  }

  function handleRoomCodeKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleConnect();
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <main className="shell">
      <div className="grid">
        <aside className="panel sidebar">
          <div className="brand">
            <span className="eyebrow">Private Transmission</span>
            <h1 className="headline">Hidden Transmission Tunnel</h1>
            <p className="subtle">
              Private channels are reachable only by code. The server authorizes entry and relays ciphertext; message contents are encrypted and decrypted inside the browser.
            </p>
          </div>

          <section className="card">
            <span className="label">Anonymous Registration</span>
            <div className="subtle">Local-only signing identity. The relay nickname is separate and assigned per room join.</div>
            <div className="identity-stack">
              <div className="identity-chip">
                <span className="label">Signing Alias</span>
                <strong>{identity ? identity.alias : "Generating local identity..."}</strong>
              </div>
              <div className="identity-chip">
                <span className="label">Relay Alias</span>
                <strong>{nickname ?? "Not connected"}</strong>
              </div>
            </div>
            <div className="actions">
              <button className="button secondary" onClick={() => void handleRegenerateIdentity()}>
                Rotate Signing Identity
              </button>
              <button className="button danger" onClick={handlePanicMode}>
                Panic Mode
              </button>
            </div>
          </section>

          <section className="card">
            <label className="label" htmlFor="room-code">
              Channel Code
            </label>
            <input
              id="room-code"
              className="input"
              placeholder="XRT-4821"
              value={roomCode}
              onChange={(event) => {
                setRoomCode(event.target.value.toUpperCase());
                setError(null);
              }}
              onKeyDown={handleRoomCodeKeyDown}
            />
            <div className="actions">
              <button className="button" onClick={() => void handleConnect()} disabled={connectionState !== "idle" || !roomCode.trim() || retryAfterSeconds > 0}>
              {connectionState === "connecting" ? "Connecting..." : connectionState === "connected" ? "Connected" : "Connect"}
              </button>
              <button className="button secondary" onClick={handleDisconnect} disabled={connectionState === "idle"}>
                Disconnect
              </button>
            </div>
            <div className="notice">The room key is derived locally from the code and room salt. Plaintext never leaves the client.</div>
            {retryAfterSeconds > 0 ? <div className="notice alert">Join temporarily locked. Retry in {retryAfterSeconds}s.</div> : null}
          </section>

          <section className="card">
            <span className="label">Operational State</span>
            <div className="subtle">{status}</div>
            {error ? <div className="notice alert">{error}</div> : null}
            <a href="/admin" className="notice">
              Restricted admin panel
            </a>
          </section>
        </aside>

        <section className="panel chat-panel">
          <header className="status-row">
            <div>
              <div className="label">Live Relay</div>
              <div>{nickname ?? "No active room"}</div>
            </div>
            <div className="status-cluster">
              <div className="presence-count">{presence.length} online</div>
              <div className="badge">{connectionState}</div>
            </div>
          </header>

          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="card">
                <span className="label">Cold Channel</span>
                <div className="subtle">Connect with a valid room code to start a private session.</div>
              </div>
            ) : null}

            {messages.map((message) => (
              <article key={message.id} className={`message${message.mine ? " me" : ""}`}>
                <div className="meta">
                  <span>{message.nickname}</span>
                  <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                </div>
                <div>{message.body}</div>
                {message.invalid ? <div className="notice alert">Signature verification or decryption failed.</div> : null}
              </article>
            ))}
          </div>

          <footer className="composer">
            <div className="presence">
              {presence.map((member) => (
                <span key={member}>{member}</span>
              ))}
            </div>
            <textarea
              className="textarea"
              rows={4}
              placeholder="Encrypt and send... Enter sends, Shift+Enter adds a new line."
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="actions">
              <input
                className="input"
                value={selfDestruct}
                onChange={(event) => setSelfDestruct(event.target.value)}
                placeholder="Self-destruct seconds"
                style={{ maxWidth: 210 }}
              />
              <button className="button" onClick={() => void handleSend()} disabled={connectionState !== "connected" || !messageDraft.trim()}>
                Transmit
              </button>
            </div>
            <div className="notice">Client-side encryption only. Press Enter to transmit quickly.</div>
          </footer>
        </section>
      </div>
    </main>
  );
}