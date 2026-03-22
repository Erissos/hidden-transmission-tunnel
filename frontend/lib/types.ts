export type Identity = {
  alias: string;
  publicKey: string;
  privateKey: string;
};

export type JoinRoomResponse = {
  room_id: string;
  nickname: string;
  room_salt: string;
  ws_ticket: string;
  persistence_enabled: boolean;
};

export type CreateRoomResponse = {
  room_id: string;
  room_salt: string;
  expires_at: string;
};

export type AdminSessionResponse = {
  ok: boolean;
  client_ip: string;
};

export type OutboundCipherMessage = {
  type: "ciphertext";
  nonce: string;
  ciphertext: string;
  signature: string;
  public_key: string;
  timestamp: string;
  self_destruct_seconds?: number | null;
};

export type ChatMessage = {
  id: string;
  nickname: string;
  body: string;
  timestamp: string;
  mine: boolean;
  invalid?: boolean;
};

export type ServerEvent =
  | { type: "presence"; payload: { members: string[]; joined?: string; left?: string } }
  | { type: "participant-key"; payload: { nickname: string; public_key: string } }
  | {
      type: "ciphertext";
      payload: {
        nickname: string;
        nonce: string;
        ciphertext: string;
        signature: string;
        public_key: string;
        timestamp: string;
        self_destruct_seconds?: number | null;
      };
    }
  | { type: "rate-limited"; payload: { detail: string } }
  | { type: "error"; payload: { detail: string } };
