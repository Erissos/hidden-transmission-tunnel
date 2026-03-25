"use client";

import { useEffect, useState } from "react";

import { createAdminRoom, validateAdminSession } from "@/lib/api";
import { clearAdminKey, loadAdminKey, storeAdminKey } from "@/lib/session";
import type { CreateRoomResponse } from "@/lib/types";

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [roomCode, setRoomCode] = useState("XRT-");
  const [ttlSeconds, setTtlSeconds] = useState("86400");
  const [persistMessages, setPersistMessages] = useState(false);
  const [status, setStatus] = useState("Admin key required.");
  const [error, setError] = useState<string | null>(null);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<CreateRoomResponse | null>(null);

  useEffect(() => {
    const existing = loadAdminKey();
    if (existing) {
      setAdminKey(existing);
    }
  }, []);

  async function handleAuthenticate() {
    try {
      setError(null);
      setStatus("Validating admin access.");
      const session = await validateAdminSession(adminKey.trim());
      storeAdminKey(adminKey.trim());
      setClientIp(session.client_ip);
      setIsAuthorized(true);
      setStatus("Admin access granted.");
    } catch (caught) {
      clearAdminKey();
      setIsAuthorized(false);
      setClientIp(null);
      setCreatedRoom(null);
      setError(caught instanceof Error ? caught.message : "Admin access failed");
      setStatus("Access denied.");
    }
  }

  function handleLogout() {
    clearAdminKey();
    setAdminKey("");
    setIsAuthorized(false);
    setClientIp(null);
    setCreatedRoom(null);
    setError(null);
    setStatus("Admin key cleared.");
  }

  async function handleCreateRoom() {
    try {
      setError(null);
      setStatus("Creating sealed room.");
      const created = await createAdminRoom(adminKey.trim(), {
        room_code: roomCode.trim().toUpperCase(),
        ttl_seconds: Number.parseInt(ttlSeconds, 10),
        persist_messages: persistMessages,
      });
      setCreatedRoom(created);
      setStatus("Room created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Room creation failed");
      setStatus("Room creation failed.");
    }
  }

  return (
    <main className="shell">
      <div className="admin-layout">
        <section className="panel sidebar">
          <div className="brand">
            <span className="eyebrow">Restricted Surface</span>
            <h1 className="headline admin-headline">Admin Panel</h1>
            <p className="subtle">
              This panel is only useful when the request originates from an allowed IP address and the correct admin key is supplied. Backend enforcement remains mandatory even if this page is publicly reachable.
            </p>
          </div>

          <section className="signal-strip" aria-label="Admin surface summary">
            <div className="signal-block">
              <span className="label">Access</span>
              <strong>{isAuthorized ? "Granted" : "Locked"}</strong>
            </div>
            <div className="signal-block">
              <span className="label">Client IP</span>
              <strong>{clientIp ?? "Pending"}</strong>
            </div>
            <div className="signal-block">
              <span className="label">Storage</span>
              <strong>{persistMessages ? "Persistent" : "Ephemeral"}</strong>
            </div>
          </section>
        </section>

        <section className="panel sidebar">
          <div className="card">
            <span className="label">Access Gate</span>
            <input
              className="input"
              type="password"
              placeholder="Enter admin key"
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
            />
            <div className="actions">
              <button className="button" onClick={() => void handleAuthenticate()} disabled={!adminKey.trim()}>
                Enter Panel
              </button>
              <button className="button secondary" onClick={handleLogout}>
                Clear Key
              </button>
            </div>
            <div className="notice">{status}</div>
            {clientIp ? <div className="notice">Validated IP: {clientIp}</div> : null}
            {error ? <div className="notice alert">{error}</div> : null}
          </div>

          <div className="card">
            <span className="label">Room Provisioning</span>
            <input
              className="input"
              placeholder="XRT-4821"
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              disabled={!isAuthorized}
            />
            <input
              className="input"
              placeholder="TTL seconds"
              value={ttlSeconds}
              onChange={(event) => setTtlSeconds(event.target.value.replace(/[^0-9]/g, ""))}
              disabled={!isAuthorized}
              inputMode="numeric"
            />
            <label className="inline-toggle notice">
              <input
                type="checkbox"
                checked={persistMessages}
                onChange={(event) => setPersistMessages(event.target.checked)}
                disabled={!isAuthorized}
              />
              Persist encrypted envelopes in MongoDB
            </label>
            <button className="button" onClick={() => void handleCreateRoom()} disabled={!isAuthorized || !roomCode.trim()}>
              Create Room
            </button>
            {createdRoom ? (
              <div className="card">
                <span className="label">Created Room</span>
                <div className="notice">Room code: {roomCode.trim().toUpperCase()}</div>
                <div className="notice">Room id: {createdRoom.room_id}</div>
                <div className="notice">Expires: {new Date(createdRoom.expires_at).toLocaleString()}</div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}