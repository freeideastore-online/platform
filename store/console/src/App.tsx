import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Library,
  LogIn,
  RefreshCcw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  FisApiError,
  FisClient,
  type AuthUser,
  type GetIdeaResponse,
  type GetSectionResponse,
  type Idea,
  type IdeaSection,
} from "@fis/sdk";

const client = new FisClient();

type LoadState<T> =
  | { status: "loading"; data?: T; error?: never }
  | { status: "loaded"; data: T; error?: never }
  | { status: "error"; data?: T; error: string };

function useLoader<T>(loader: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ status: "loading", data: current.data }));
    loader()
      .then((data) => {
        if (!cancelled) setState({ status: "loaded", data });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof FisApiError || error instanceof Error ? error.message : "Request failed";
        setState((current) => ({ status: "error", data: current.data, error: message }));
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  return state;
}

function useSession() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.session()
      .then((session) => {
        if (!cancelled) setUser(session.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return user;
}

function initials(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "FI";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "section";
}

function stageOptions(ideas: Idea[]) {
  return ["all", ...Array.from(new Set(ideas.map((idea) => idea.stage).filter(Boolean)))];
}

function Shell({ children }: { children: React.ReactNode }) {
  const user = useSession();

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-panel/95 px-3 backdrop-blur md:px-5">
        <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold">
          <span className="grid size-7 shrink-0 place-items-center rounded border border-line bg-accent text-xs font-black text-white">
            FI
          </span>
          <span className="hidden sm:inline">FreeIdeaStore Console</span>
          <span className="sm:hidden">Console</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm font-semibold text-muted">
          <a className="hidden rounded px-2 py-1 hover:bg-panel-alt hover:text-ink sm:inline-flex" href="/ideas/">
            Public ideas
          </a>
          {user ? (
            <a className="flex items-center gap-2 rounded px-2 py-1 hover:bg-panel-alt hover:text-ink" href="/profile/">
              {user.avatarUrl ? (
                <img className="size-6 rounded-full" src={user.avatarUrl} alt="" />
              ) : (
                <span className="grid size-6 place-items-center rounded-full bg-panel-alt text-[11px]">
                  {initials(user.displayName || user.handle)}
                </span>
              )}
              <span className="hidden sm:inline">@{user.handle}</span>
            </a>
          ) : (
            <a
              className="inline-flex items-center gap-1.5 rounded border border-line bg-panel px-2.5 py-1.5 text-ink hover:border-accent"
              href="/.fis/auth/start?provider=github&return_to=/console/"
            >
              <LogIn className="size-4" />
              <span>Sign in</span>
            </a>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}

function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="grid min-h-60 place-items-center text-sm font-semibold text-muted">
      <div className="flex items-center gap-2">
        <RefreshCcw className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="mx-auto mt-8 max-w-2xl border border-danger bg-panel p-4 text-sm font-semibold text-danger">
      {message}
    </div>
  );
}

function IdeaMeta({ idea }: { idea: Idea }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px] font-black uppercase tracking-wide text-muted">
      <span className="rounded border border-line bg-panel px-2 py-1">{idea.stage || "unstaged"}</span>
      <span className="rounded border border-line bg-panel px-2 py-1">{idea.category || "uncategorized"}</span>
      <span className="rounded border border-line bg-panel px-2 py-1">
        {idea.has_publication ? "published book" : "working note"}
      </span>
      {idea.pro_candidate ? <span className="rounded border border-line bg-panel px-2 py-1">pro candidate</span> : null}
    </div>
  );
}

function CatalogPage() {
  const [stage, setStage] = useState("all");
  const [query, setQuery] = useState("");
  const state = useLoader(() => client.listIdeas({ stage, limit: 100 }), [stage]);
  const ideas = state.data?.ideas || [];
  const visible = ideas.filter((idea) => {
    const haystack = `${idea.title} ${idea.summary} ${idea.category} ${idea.stage}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 md:grid-cols-[280px_1fr] md:px-5">
      <aside className="border border-line bg-panel p-3 md:sticky md:top-16 md:h-[calc(100dvh-5rem)]">
        <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide">
          <Library className="size-4 text-accent" />
          Catalog
        </div>
        <label className="mb-3 grid gap-1 text-xs font-bold text-muted">
          Search
          <span className="flex items-center gap-2 border border-line bg-paper px-2">
            <Search className="size-4 shrink-0" />
            <input
              className="min-h-10 w-full bg-transparent text-sm text-ink outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, summary, category"
            />
          </span>
        </label>
        <label className="grid gap-1 text-xs font-bold text-muted">
          Stage
          <select
            className="min-h-10 border border-line bg-paper px-2 text-sm text-ink"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
          >
            {stageOptions(ideas).map((item) => (
              <option key={item} value={item}>
                {item === "all" ? "All stages" : item}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 border-t border-line pt-3 text-xs font-semibold text-muted">
          {visible.length} of {ideas.length} ideas
        </div>
      </aside>
      <section className="min-w-0">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">Idea console</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Browse canonical ideas and read their sections without touching the public, crawlable pages.
            </p>
          </div>
        </div>
        {state.status === "loading" && !state.data ? <LoadingBlock label="Loading ideas" /> : null}
        {state.status === "error" ? <ErrorBlock message={state.error} /> : null}
        <div className="grid gap-2">
          {visible.map((idea) => (
            <Link
              key={idea.id}
              to={`/ideas/${idea.id}`}
              className="grid gap-2 border border-line bg-panel p-3 hover:border-accent md:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <IdeaMeta idea={idea} />
                <h2 className="mt-2 text-lg font-black leading-tight">{idea.title}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{idea.summary || idea.preview}</p>
              </div>
              <div className="flex items-end justify-between gap-3 text-xs font-bold text-muted md:grid md:justify-items-end">
                <span>{formatDate(idea.updated_at)}</span>
                <span>{idea.contribution_count} contributions</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function SectionRail({ ideaId, sections, activeId }: { ideaId: string; sections: IdeaSection[]; activeId?: string }) {
  return (
    <aside className="border border-line bg-panel p-3 lg:sticky lg:top-16 lg:h-[calc(100dvh-5rem)] lg:overflow-auto">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">
          <BookOpen className="size-4 text-accent" />
          Sections
        </div>
        <span className="text-xs font-bold text-muted">{sections.length}</span>
      </div>
      <nav className="grid gap-1">
        {sections.map((section, index) => (
          <Link
            key={section.id}
            to={`/ideas/${ideaId}/${section.id}`}
            className={`grid grid-cols-[28px_1fr] gap-2 border px-2 py-2 text-sm ${
              activeId === section.id
                ? "border-accent bg-accent text-white"
                : "border-line bg-paper hover:border-accent hover:bg-panel-alt"
            }`}
          >
            <span className="font-mono text-xs font-black">{index + 1}</span>
            <span className="min-w-0">
              <span className="block truncate font-black">{section.title}</span>
              <span className="block text-xs opacity-75">
                {section.words} words / {section.verdict}
              </span>
            </span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

function IdeaHeader({ idea }: { idea: Idea }) {
  return (
    <div className="border-b border-line bg-panel px-3 py-5 md:px-5">
      <div className="mx-auto max-w-7xl">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-accent-strong">
          <ChevronLeft className="size-4" />
          Ideas
        </Link>
        <IdeaMeta idea={idea} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">{idea.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted md:text-base">{idea.summary}</p>
          </div>
          <a
            href={`/ideas/${idea.id}/`}
            className="inline-flex shrink-0 items-center gap-1.5 border border-line bg-paper px-3 py-2 text-sm font-bold hover:border-accent"
          >
            Public page
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

function MarkdownBlock({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return (
    <div className="console-markdown">
      {blocks.map((block, index) => (
        <MarkdownNode key={index} block={block} />
      ))}
    </div>
  );
}

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<MarkdownBlock, { kind: "list" }> | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: "paragraph", text: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(list);
    list = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        flushParagraph();
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: Math.min(3, heading[1].length), text: heading[2].trim() });
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const nextOrdered = Boolean(ordered);
      if (!list || list.ordered !== nextOrdered) flushList();
      if (!list) list = { kind: "list", ordered: nextOrdered, items: [] };
      const activeList = list;
      activeList.items.push((unordered?.[1] || ordered?.[1] || "").trim());
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }

  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}

function MarkdownNode({ block }: { block: MarkdownBlock }) {
  if (block.kind === "heading") {
    const id = slug(block.text);
    const classes = "font-display font-bold leading-tight text-ink";
    if (block.level === 1) return <h2 id={id} className={`${classes} mt-6 text-2xl`}>{block.text}</h2>;
    if (block.level === 2) return <h2 id={id} className={`${classes} mt-6 text-2xl`}>{block.text}</h2>;
    return <h3 id={id} className={`${classes} mt-5 text-xl`}>{block.text}</h3>;
  }
  if (block.kind === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className={`my-4 grid gap-2 pl-5 text-sm leading-7 text-muted ${block.ordered ? "list-decimal" : "list-disc"}`}>
        {block.items.map((item, index) => <li key={index}>{item}</li>)}
      </ListTag>
    );
  }
  if (block.kind === "code") {
    return <pre className="my-4 overflow-auto border border-line bg-paper p-3 font-mono text-xs leading-6 text-ink">{block.text}</pre>;
  }
  return <p className="my-3 text-sm leading-7 text-muted md:text-base">{block.text}</p>;
}

function IdeaPage() {
  const { ideaId = "" } = useParams();
  const state = useLoader(() => client.getIdea(ideaId, { body: "preamble" }), [ideaId]);
  if (state.status === "loading" && !state.data) return <LoadingBlock label="Loading idea" />;
  if (state.status === "error" && !state.data) return <ErrorBlock message={state.error} />;
  const data = state.data!;
  const firstSection = data.sections[0];

  return (
    <>
      <IdeaHeader idea={data.idea} />
      <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 md:px-5 lg:grid-cols-[280px_1fr]">
        <SectionRail ideaId={data.idea.id} sections={data.sections} />
        <article className="min-w-0 border border-line bg-panel p-4 md:p-5">
          <div className="mb-4 grid gap-2 border-b border-line pb-4 text-sm text-muted md:grid-cols-3">
            <Metric label="Document" value={`${data.usage.chars.toLocaleString()} chars`} />
            <Metric label="Chapters" value={`${data.usage.chapters} used`} />
            <Metric label="Needs work" value={`${data.usage.below_floor} merge / ${data.usage.above_ceiling} split`} />
          </div>
          {data.body ? (
            <MarkdownBlock markdown={data.body} />
          ) : (
            <div className="border border-line bg-paper p-4 text-sm leading-6 text-muted">
              This document starts directly in its sections. Open a section to read the idea body.
            </div>
          )}
          {firstSection ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to={`/ideas/${data.idea.id}/${firstSection.id}`}
                className="inline-flex items-center gap-2 bg-accent px-3 py-2 text-sm font-black text-white hover:bg-accent-strong"
              >
                <FileText className="size-4" />
                Open {firstSection.title}
              </Link>
              <a
                href={`/api/ideas/${data.idea.id}`}
                className="inline-flex items-center gap-2 border border-line bg-paper px-3 py-2 text-sm font-black hover:border-accent"
              >
                JSON
                <ExternalLink className="size-4" />
              </a>
            </div>
          ) : null}
        </article>
      </main>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-black uppercase tracking-wide">{label}</div>
      <div className="mt-1 font-black text-ink">{value}</div>
    </div>
  );
}

function ChapterPage() {
  const { ideaId = "", sectionId = "" } = useParams();
  const state = useLoader(async () => {
    const [idea, section] = await Promise.all([
      client.getIdea(ideaId, { body: "none" }),
      client.getSection(ideaId, sectionId),
    ]);
    return { idea, section };
  }, [ideaId, sectionId]);

  if (state.status === "loading" && !state.data) return <LoadingBlock label="Loading section" />;
  if (state.status === "error" && !state.data) return <ErrorBlock message={state.error} />;

  const data = state.data!;
  const index = data.idea.sections.findIndex((section) => section.id === sectionId);
  const current = data.idea.sections[index];
  const previous = data.idea.sections[index - 1];
  const next = data.idea.sections[index + 1];

  return (
    <>
      <IdeaHeader idea={data.idea.idea} />
      <main className="mx-auto grid max-w-7xl gap-4 px-3 py-4 md:px-5 lg:grid-cols-[280px_1fr]">
        <SectionRail ideaId={data.idea.idea.id} sections={data.idea.sections} activeId={sectionId} />
        <article className="min-w-0 border border-line bg-panel p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-wide text-muted">
                Section {index + 1} of {data.idea.sections.length}
              </div>
              <h2 className="mt-1 font-display text-2xl font-bold md:text-4xl">{current?.title || data.section.section}</h2>
            </div>
            <a
              href={`/ideas/${data.idea.idea.id}/${sectionId}/`}
              className="inline-flex items-center gap-1.5 border border-line bg-paper px-3 py-2 text-sm font-bold hover:border-accent"
            >
              Public section
              <ExternalLink className="size-4" />
            </a>
          </div>
          <MarkdownBlock markdown={data.section.markdown} />
          <nav className="mt-6 grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
            {previous ? (
              <Link className="grid gap-1 border border-line bg-paper p-3 hover:border-accent" to={`/ideas/${data.idea.idea.id}/${previous.id}`}>
                <span className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-wide text-muted">
                  <ChevronLeft className="size-4" />
                  Previous
                </span>
                <strong>{previous.title}</strong>
              </Link>
            ) : <span />}
            {next ? (
              <Link className="grid gap-1 border border-line bg-paper p-3 text-right hover:border-accent" to={`/ideas/${data.idea.idea.id}/${next.id}`}>
                <span className="inline-flex items-center justify-end gap-1 text-xs font-black uppercase tracking-wide text-muted">
                  Next
                  <ChevronRight className="size-4" />
                </span>
                <strong>{next.title}</strong>
              </Link>
            ) : <span />}
          </nav>
        </article>
      </main>
    </>
  );
}

function consoleBasename() {
  return "/console";
}

export default function App() {
  return (
    <BrowserRouter basename={consoleBasename()}>
      <Shell>
        <Routes>
          <Route index element={<CatalogPage />} />
          <Route path="ideas/:ideaId" element={<IdeaPage />} />
          <Route path="ideas/:ideaId/:sectionId" element={<ChapterPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
