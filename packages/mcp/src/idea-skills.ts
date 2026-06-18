export const IDEA_SKILL_IDS = [
  "idea-flow-orchestrator",
  "idea-interviewer",
  "idea-document-architect",
  "idea-critic",
  "competitor-finder",
  "idea-researcher",
  "idea-refiner",
  "pivot-generator",
  "validation-planner",
  "prototype-planner",
  "pro-candidate-assessor",
] as const;
export const TOOL_COUNT = 16;

import { IDEA_SKILLS as CATALOG_IDEA_SKILLS, type IdeaSkill as CatalogIdeaSkill } from "./idea-skill-catalog.js";

export type IdeaSkill = Omit<CatalogIdeaSkill, "id"> & {
  id: (typeof IDEA_SKILL_IDS)[number];
};

export const FREE_IDEA_SECTIONS = [
  ["snapshot", "Snapshot", "One paragraph describing the idea, user, and current maturity."],
  ["signal", "Current Signal", "Why it may be worth attention now."],
  ["next_step", "Next Step", "The cheapest useful validation step."],
  ["risk", "Risk", "The main reason this may fail or should be trashed."],
  ["help", "How To Help", "Prompts for evidence, critique, pivot, and prototype contributions."],
] as const;

export const CHAPTERS = [
  ["Overview", "### Snapshot\nWhat is the idea in one plain paragraph?\n\n### Current Thesis\nWhat currently seems true, and how confident are we?\n\n### Status\nWhat lifecycle stage is this in?\n\n### Why This Deserves Attention\nWhy should anyone spend another minute on it?"],
  ["People And Problem", "### First User Or Buyer\nWho is the narrowest first user, buyer, sponsor, or participant?\n\n### Problem Moment\nWhere and when does the need appear?\n\n### Current Workaround\nWhat do people do today instead?\n\n### Urgency Or Frequency\nHow often does this happen, and how painful is it?"],
  ["Context And Evidence", "### Existing Alternatives\nWhich products, services, communities, content, manual workflows, or substitutes already solve part of this?\n\n### Competitors Or Substitutes\nWhich named competitors should be linked and compared?\n\n### Source Trail\nWhich public sources support the claims?\n\n### Unknowns\nWhat still needs evidence?"],
  ["Proposed Solution", "### Core Promise\nWhat promise does this make to the user?\n\n### User Workflow\nHow does someone discover, use, and get value from it?\n\n### Smallest Useful Version\nWhat is the smallest version worth testing?\n\n### Out Of Scope\nWhat should not be built or claimed yet?"],
  ["Risks And Constraints", "### Trust And Safety\nWhat could harm users, contributors, partners, or public trust?\n\n### Legal Or Regulatory Constraints\nWhat laws, permissions, licenses, or platform rules matter?\n\n### Operational Or Technical Constraints\nWhat makes delivery hard?\n\n### Kill Signals\nWhat evidence should make us stop, park, or pivot?"],
  ["Validation", "### Riskiest Assumption\nWhat must be true for this idea to work?\n\n### Cheapest Test\nWhat can be tested this week without overbuilding?\n\n### Success Threshold\nWhat result means continue?\n\n### Pivot Or Trash Criteria\nWhat result means change direction or stop?"],
  ["Prototype Or Pilot", "### Demo Or Pilot\nWhat should the first demo, pilot, manual service, or concierge test show?\n\n### Required Resources\nWhat data, people, permissions, integrations, assets, or locations are needed?\n\n### Manual Or Fakeable Parts\nWhat can be done manually without lying to users?\n\n### Must Be Real\nWhat must be real for the test to be honest?"],
  ["Model And Distribution", "### Sustainability Model\nHow could this be funded, sold, maintained, or supported?\n\n### Pricing Or Funding Hypothesis\nWho might pay, sponsor, or contribute?\n\n### Channels\nHow would first users find it?\n\n### Partnerships\nWho could make distribution or delivery easier?"],
  ["Evolution", "### Open Questions\nWhat decisions are still unresolved?\n\n### Contribution Prompts\nWhat help should researchers, builders, designers, operators, or critics add?\n\n### Next Decisions\nWhat should happen after the next evidence pass?\n\n### ProIdeaStore Readiness\nWhat is missing before this deserves serious diligence?"],
] as const;

export const IDEA_SKILLS = CATALOG_IDEA_SKILLS as IdeaSkill[];

export function skillSummary(skill: IdeaSkill) {
  return {
    id: skill.id,
    title: skill.title,
    purpose: skill.purpose,
    whenToUse: skill.whenToUse,
    suggestedTools: skill.suggestedTools,
  };
}

export function applyIdeaSkill(skill: IdeaSkill, context: string, mode: "questions" | "checklist" | "tool_plan") {
  const base = {
    skill: skillSummary(skill),
    context,
    rule: "Ask before publishing when important facts are missing. Use contributions for history and publish_idea_update only for owner-approved canonical document changes.",
  };
  if (mode === "questions") {
    return {
      ...base,
      questions: skill.questions,
      stopCondition: "Stop asking when the agent has enough detail to satisfy the output contract without inventing facts.",
    };
  }
  if (mode === "tool_plan") {
    return {
      ...base,
      toolPlan: skill.suggestedTools.map((tool, index) => ({ step: index + 1, tool })),
      outputContract: skill.outputContract,
    };
  }
  return {
    ...base,
    checklist: skill.outputContract,
    qualityGate: [
      "No fake sources, fake users, fake metrics, or fake contributor names.",
      "Named products, companies, services, datasets, regulators, and important public sources are clickable Markdown links when credible URLs are known.",
      "Use the universal publication spine for serious canonical updates: Overview, People And Problem, Context And Evidence, Proposed Solution, Risks And Constraints, Validation, Prototype Or Pilot, Model And Distribution, Evolution.",
      "Main risk is visible.",
      "Next validation step is cheap and concrete.",
      "Public document is understandable without reading the chat.",
    ],
  };
}
