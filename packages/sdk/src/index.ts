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

export type IdeaSection = {
  id: string;
  title: string;
  words: number;
  verdict: string;
};

export type Usage = {
  body_chars: number;
  body_remaining: number;
  body_words: number;
  chapters: number;
  chapters_remaining: number;
};
