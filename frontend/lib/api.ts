import type { AdminSessionResponse, CreateRoomResponse, JoinRoomResponse } from "@/lib/types";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export async function joinRoom(roomCode: string): Promise<JoinRoomResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/rooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room_code: roomCode.trim() }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Room join failed");
  }

  return (await response.json()) as JoinRoomResponse;
}

export async function validateAdminSession(adminKey: string): Promise<AdminSessionResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/admin/session`, {
    method: "GET",
    headers: {
      "x-admin-key": adminKey,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Admin session validation failed");
  }

  return (await response.json()) as AdminSessionResponse;
}

export async function createAdminRoom(
  adminKey: string,
  payload: { room_code: string; ttl_seconds: number; persist_messages: boolean },
): Promise<CreateRoomResponse> {
  const response = await fetch(`${apiBaseUrl}/api/v1/admin/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? "Room creation failed");
  }

  return (await response.json()) as CreateRoomResponse;
}

export function buildWebSocketUrl(ticket: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
