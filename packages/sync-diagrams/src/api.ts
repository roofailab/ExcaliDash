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

export type Collection = {
  id: string;
  name: string;
};

export class ExcaliDashClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, apiKey: string, timeoutMs = 30_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    };
    this.timeoutMs = timeoutMs;
  }

  private fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async getDrawing(id: string): Promise<Drawing> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/drawings/${id}`, {
      headers: this.headers,
    });
    if (!res.ok) {
      throw new Error(`GET /drawings/${id} failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<Drawing>;
  }

  async createDrawing(payload: CreateDrawingPayload): Promise<{ id: string }> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/drawings`, {
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

  async getCollections(): Promise<Collection[]> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/collections`, { headers: this.headers });
    if (!res.ok) throw new Error(`GET /collections failed: ${res.status} ${res.statusText}`);
    return res.json() as Promise<Collection[]>;
  }

  async createCollection(name: string): Promise<Collection> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/collections`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`POST /collections failed: ${res.status} ${res.statusText} — ${body}`);
    }
    return res.json() as Promise<Collection>;
  }

  async updateDrawing(id: string, payload: UpdateDrawingPayload): Promise<void> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/drawings/${id}`, {
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
