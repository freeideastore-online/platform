export type Idea = {
  id: string;
  title: string;
  summary: string;
  preview?: string;
  signal?: string;
  source_url?: string;
  visibility?: string;
  stage: string;
  category: string;
  next_step: string;
  risk: string;
  created_by: string;
  parent_id?: string;
  status: string;
  pro_candidate: number;
  created_at: string;
  updated_at: string;
  support: number;
  trash: number;
  pivot: number;
  contribution_count: number;
  has_publication?: number;
};

export type AuthUser = {
  handle: string;
  displayName: string;
  provider: string;
  avatarUrl: string | null;
};

export type IdeaSection = {
  id: string;
  title: string;
  words: number;
  verdict: string;
};

export type Usage = {
  chars: number;
  chars_remaining: number;
  chapters: number;
  chapters_remaining: number;
  below_floor: number;
  above_ceiling: number;
};

export type BodyView = "none" | "preamble" | "full";

export type ListIdeasResponse = {
  ideas: Idea[];
};

export type GetIdeaResponse = {
  idea: Idea;
  body: string | null;
  body_view: BodyView;
  sections: IdeaSection[];
  usage: Usage;
  url: string;
};

export type GetSectionsResponse = {
  idea: string;
  sections: IdeaSection[];
  usage: Usage;
};

export type GetSectionResponse = {
  idea: string;
  section: string;
  markdown: string;
};

export type SessionResponse = {
  user: AuthUser;
};

export class FisApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FisApiError";
    this.status = status;
  }
}

export class FisClient {
  private readonly baseUrl: string;

  constructor(options: { baseUrl?: string } = {}) {
    this.baseUrl = options.baseUrl || "";
  }

  async listIdeas(options: { stage?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (options.stage) params.set("stage", options.stage);
    if (options.limit) params.set("limit", String(options.limit));
    const query = params.toString();
    return this.get<ListIdeasResponse>(`/api/ideas${query ? `?${query}` : ""}`);
  }

  async getIdea(ideaId: string, options: { body?: BodyView } = {}) {
    const body = options.body || "preamble";
    return this.get<GetIdeaResponse>(`/api/ideas/${encodeURIComponent(ideaId)}?body=${body}`);
  }

  async getSections(ideaId: string) {
    return this.get<GetSectionsResponse>(`/api/ideas/${encodeURIComponent(ideaId)}/sections`);
  }

  async getSection(ideaId: string, sectionId: string) {
    return this.get<GetSectionResponse>(
      `/api/ideas/${encodeURIComponent(ideaId)}/sections/${encodeURIComponent(sectionId)}`,
    );
  }

  async session() {
    return this.get<SessionResponse>("/api/session");
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      throw new FisApiError(data?.error || `Request failed with ${response.status}`, response.status);
    }
    return data as T;
  }
}
