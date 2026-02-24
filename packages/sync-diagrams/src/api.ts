export type Drawing = {
  id: string;
  name: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type CreateDrawingPayload = {
  name: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files?: Record<string, unknown>;
  collectionId?: string;
};

export type UpdateDrawingPayload = {
  name: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export class ExcaliDashClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    };
  }

  async getDrawing(id: string): Promise<Drawing> {
    const res = await fetch(`${this.baseUrl}/drawings/${id}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`GET /drawings/${id} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<Drawing>;
  }

  async createDrawing(payload: CreateDrawingPayload): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/drawings`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`POST /drawings failed: ${res.status} ${res.statusText} — ${body}`);
    }
    return res.json() as Promise<{ id: string }>;
  }

  async updateDrawing(id: string, payload: UpdateDrawingPayload): Promise<void> {
    const res = await fetch(`${this.baseUrl}/drawings/${id}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`PUT /drawings/${id} failed: ${res.status} ${res.statusText} — ${body}`);
    }
  }
}
