/**
 * Inline SVG diagrams for idea pages.
 * Each diagram is a hand-crafted SVG — no external dependencies.
 * Returns empty string if no diagram exists for the idea.
 */

const diagrams: Record<string, { label: string; svg: string }> = {
  'asx-filings-analyst': {
    label: 'How it works',
    svg: `<svg viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">
  <defs>
    <marker id="a1" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#0e7490"/></marker>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ecfeff"/><stop offset="100%" stop-color="#cffafe"/></linearGradient>
    <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f0fdf4"/><stop offset="100%" stop-color="#dcfce7"/></linearGradient>
    <linearGradient id="g3" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fffbeb"/><stop offset="100%" stop-color="#fef3c7"/></linearGradient>
    <linearGradient id="g4" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fdf2f8"/><stop offset="100%" stop-color="#fce7f3"/></linearGradient>
  </defs>
  <!-- Step 1: Sources -->
  <rect x="10" y="30" width="150" height="140" rx="12" fill="url(#g1)" stroke="#0e7490" stroke-width="1.5"/>
  <text x="85" y="58" text-anchor="middle" font-size="11" font-weight="800" fill="#0f4c5c">PUBLIC SOURCES</text>
  <text x="85" y="80" text-anchor="middle" font-size="10" fill="#334155">ASX Announcements</text>
  <text x="85" y="96" text-anchor="middle" font-size="10" fill="#334155">Annual Reports</text>
  <text x="85" y="112" text-anchor="middle" font-size="10" fill="#334155">Half-Year Results</text>
  <text x="85" y="128" text-anchor="middle" font-size="10" fill="#334155">Investor Presentations</text>
  <text x="85" y="144" text-anchor="middle" font-size="10" fill="#334155">Quarterly Activities</text>
  <!-- Arrow 1 -->
  <line x1="168" y1="100" x2="198" y2="100" stroke="#0e7490" stroke-width="2" marker-end="url(#a1)"/>
  <!-- Step 2: Extract -->
  <rect x="206" y="50" width="140" height="100" rx="12" fill="url(#g2)" stroke="#16a34a" stroke-width="1.5"/>
  <text x="276" y="78" text-anchor="middle" font-size="11" font-weight="800" fill="#14532d">EXTRACT</text>
  <text x="276" y="98" text-anchor="middle" font-size="10" fill="#334155">Financial facts</text>
  <text x="276" y="114" text-anchor="middle" font-size="10" fill="#334155">Valuation signals</text>
  <text x="276" y="130" text-anchor="middle" font-size="10" fill="#334155">Risk flags</text>
  <!-- Arrow 2 -->
  <line x1="354" y1="100" x2="384" y2="100" stroke="#0e7490" stroke-width="2" marker-end="url(#a1)"/>
  <!-- Step 3: Score -->
  <rect x="392" y="50" width="140" height="100" rx="12" fill="url(#g3)" stroke="#d97706" stroke-width="1.5"/>
  <text x="462" y="78" text-anchor="middle" font-size="11" font-weight="800" fill="#78350f">SCORE</text>
  <text x="462" y="98" text-anchor="middle" font-size="10" fill="#334155">Deterministic rules</text>
  <text x="462" y="114" text-anchor="middle" font-size="10" fill="#334155">Peer comparison</text>
  <text x="462" y="130" text-anchor="middle" font-size="10" fill="#334155">Source citations</text>
  <!-- Arrow 3 -->
  <line x1="540" y1="100" x2="570" y2="100" stroke="#0e7490" stroke-width="2" marker-end="url(#a1)"/>
  <!-- Step 4: Output -->
  <rect x="578" y="30" width="170" height="140" rx="12" fill="url(#g4)" stroke="#db2777" stroke-width="1.5"/>
  <text x="663" y="58" text-anchor="middle" font-size="11" font-weight="800" fill="#831843">WEEKLY WATCHLIST</text>
  <text x="663" y="80" text-anchor="middle" font-size="10" fill="#334155">What changed</text>
  <text x="663" y="96" text-anchor="middle" font-size="10" fill="#334155">What looks cheap</text>
  <text x="663" y="112" text-anchor="middle" font-size="10" fill="#334155">Why (with sources)</text>
  <text x="663" y="128" text-anchor="middle" font-size="10" fill="#334155">What to be careful of</text>
  <text x="663" y="148" text-anchor="middle" font-size="10" font-weight="700" fill="#db2777">User saves / dismisses</text>
</svg>`,
  },

  'slowdown-personal-reset': {
    label: 'Core reset flow',
    svg: `<svg viewBox="0 0 760 180" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">
  <defs>
    <marker id="a2" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#7c3aed"/></marker>
    <linearGradient id="s1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f5f3ff"/><stop offset="100%" stop-color="#ede9fe"/></linearGradient>
    <linearGradient id="s2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ecfeff"/><stop offset="100%" stop-color="#cffafe"/></linearGradient>
    <linearGradient id="s3" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fefce8"/><stop offset="100%" stop-color="#fef9c3"/></linearGradient>
    <linearGradient id="s4" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f0fdf4"/><stop offset="100%" stop-color="#dcfce7"/></linearGradient>
    <linearGradient id="s5" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fdf2f8"/><stop offset="100%" stop-color="#fce7f3"/></linearGradient>
  </defs>
  <!-- Step 1 -->
  <rect x="10" y="30" width="120" height="120" rx="60" fill="url(#s1)" stroke="#7c3aed" stroke-width="1.5"/>
  <text x="70" y="78" text-anchor="middle" font-size="22" fill="#7c3aed">1</text>
  <text x="70" y="98" text-anchor="middle" font-size="10" font-weight="800" fill="#4c1d95">CHECK IN</text>
  <text x="70" y="114" text-anchor="middle" font-size="9" fill="#334155">Mood, energy,</text>
  <text x="70" y="126" text-anchor="middle" font-size="9" fill="#334155">speed, tension</text>
  <line x1="134" y1="90" x2="158" y2="90" stroke="#7c3aed" stroke-width="2" marker-end="url(#a2)"/>
  <!-- Step 2 -->
  <rect x="164" y="40" width="120" height="100" rx="12" fill="url(#s2)" stroke="#0891b2" stroke-width="1.5"/>
  <text x="224" y="72" text-anchor="middle" font-size="22" fill="#0891b2">2</text>
  <text x="224" y="92" text-anchor="middle" font-size="10" font-weight="800" fill="#164e63">PAUSE</text>
  <text x="224" y="108" text-anchor="middle" font-size="9" fill="#334155">Short guided</text>
  <text x="224" y="120" text-anchor="middle" font-size="9" fill="#334155">breathing</text>
  <line x1="288" y1="90" x2="312" y2="90" stroke="#7c3aed" stroke-width="2" marker-end="url(#a2)"/>
  <!-- Step 3 -->
  <rect x="318" y="40" width="120" height="100" rx="12" fill="url(#s3)" stroke="#ca8a04" stroke-width="1.5"/>
  <text x="378" y="72" text-anchor="middle" font-size="22" fill="#ca8a04">3</text>
  <text x="378" y="92" text-anchor="middle" font-size="10" font-weight="800" fill="#713f12">REFLECT</text>
  <text x="378" y="108" text-anchor="middle" font-size="9" fill="#334155">Write one</text>
  <text x="378" y="120" text-anchor="middle" font-size="9" fill="#334155">sentence</text>
  <line x1="442" y1="90" x2="466" y2="90" stroke="#7c3aed" stroke-width="2" marker-end="url(#a2)"/>
  <!-- Step 4 -->
  <rect x="472" y="40" width="120" height="100" rx="12" fill="url(#s4)" stroke="#16a34a" stroke-width="1.5"/>
  <text x="532" y="72" text-anchor="middle" font-size="22" fill="#16a34a">4</text>
  <text x="532" y="92" text-anchor="middle" font-size="10" font-weight="800" fill="#14532d">ACT</text>
  <text x="532" y="108" text-anchor="middle" font-size="9" fill="#334155">Pick one tiny</text>
  <text x="532" y="120" text-anchor="middle" font-size="9" fill="#334155">next action</text>
  <line x1="596" y1="90" x2="620" y2="90" stroke="#7c3aed" stroke-width="2" marker-end="url(#a2)"/>
  <!-- Step 5 -->
  <rect x="626" y="30" width="120" height="120" rx="60" fill="url(#s5)" stroke="#db2777" stroke-width="1.5"/>
  <text x="686" y="78" text-anchor="middle" font-size="22" fill="#db2777">5</text>
  <text x="686" y="98" text-anchor="middle" font-size="10" font-weight="800" fill="#831843">REVIEW</text>
  <text x="686" y="114" text-anchor="middle" font-size="9" fill="#334155">Patterns &amp;</text>
  <text x="686" y="126" text-anchor="middle" font-size="9" fill="#334155">streaks</text>
</svg>`,
  },

  'parent-volleyball-community': {
    label: 'Validation roadmap',
    svg: `<svg viewBox="0 0 760 200" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">
  <defs>
    <marker id="a3" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#0e7490"/></marker>
    <linearGradient id="v1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#dbeafe"/><stop offset="100%" stop-color="#bfdbfe"/></linearGradient>
    <linearGradient id="v2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fef3c7"/><stop offset="100%" stop-color="#fde68a"/></linearGradient>
    <linearGradient id="v3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d1fae5"/><stop offset="100%" stop-color="#a7f3d0"/></linearGradient>
  </defs>
  <!-- Timeline line -->
  <line x1="40" y1="100" x2="720" y2="100" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6,4"/>
  <!-- Phase 1 -->
  <rect x="20" y="30" width="220" height="130" rx="12" fill="url(#v1)" stroke="#3b82f6" stroke-width="1.5"/>
  <text x="130" y="54" text-anchor="middle" font-size="11" font-weight="900" fill="#1e3a5f">PHASE 1: EXISTING TOOLS</text>
  <text x="130" y="72" text-anchor="middle" font-size="10" fill="#334155">Run BAND or Spond</text>
  <text x="130" y="88" text-anchor="middle" font-size="10" fill="#334155">for 6-8 Saturdays</text>
  <line x1="40" y1="108" x2="220" y2="108" stroke="#3b82f6" stroke-width=".5" opacity=".4"/>
  <text x="38" y="124" font-size="9" fill="#334155">QR invite at park</text>
  <text x="38" y="138" font-size="9" fill="#334155">Recurring event + RSVP</text>
  <text x="38" y="152" font-size="9" fill="#334155">Manual appreciation posts</text>
  <line x1="244" y1="100" x2="274" y2="100" stroke="#0e7490" stroke-width="2" marker-end="url(#a3)"/>
  <!-- Phase 2 -->
  <rect x="280" y="30" width="200" height="130" rx="12" fill="url(#v2)" stroke="#d97706" stroke-width="1.5"/>
  <text x="380" y="54" text-anchor="middle" font-size="11" font-weight="900" fill="#78350f">PHASE 2: VALIDATE</text>
  <text x="380" y="72" text-anchor="middle" font-size="10" fill="#334155">Interview 10 parents</text>
  <text x="380" y="88" text-anchor="middle" font-size="10" fill="#334155">Measure retention</text>
  <line x1="298" y1="108" x2="462" y2="108" stroke="#d97706" stroke-width=".5" opacity=".4"/>
  <text x="298" y="124" font-size="9" fill="#334155">25+ families joined?</text>
  <text x="298" y="138" font-size="9" fill="#334155">60%+ RSVP rate?</text>
  <text x="298" y="152" font-size="9" fill="#334155">New families returning?</text>
  <line x1="484" y1="100" x2="514" y2="100" stroke="#0e7490" stroke-width="2" marker-end="url(#a3)"/>
  <!-- Phase 3 -->
  <rect x="520" y="30" width="220" height="130" rx="12" fill="url(#v3)" stroke="#16a34a" stroke-width="1.5"/>
  <text x="630" y="54" text-anchor="middle" font-size="11" font-weight="900" fill="#14532d">PHASE 3: BUILD IF PROVEN</text>
  <text x="630" y="72" text-anchor="middle" font-size="10" fill="#334155">Custom app only if gaps</text>
  <text x="630" y="88" text-anchor="middle" font-size="10" fill="#334155">found in existing tools</text>
  <line x1="538" y1="108" x2="722" y2="108" stroke="#16a34a" stroke-width=".5" opacity=".4"/>
  <text x="538" y="124" font-size="9" fill="#334155">Family profiles</text>
  <text x="538" y="138" font-size="9" fill="#334155">Birthday + photo consent</text>
  <text x="538" y="152" font-size="9" fill="#334155">Attendance appreciation</text>
</svg>`,
  },

  'school-transport-options': {
    label: 'Decision tree for parents',
    svg: `<svg viewBox="0 0 760 240" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">
  <defs>
    <marker id="a4" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#0e7490"/></marker>
    <marker id="a4d" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#64748b"/></marker>
  </defs>
  <!-- Start -->
  <rect x="280" y="8" width="200" height="40" rx="20" fill="#0f4c5c" stroke="none"/>
  <text x="380" y="33" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">CHILD AGED 5-10 NEEDS RIDE</text>
  <!-- Arrow down -->
  <line x1="380" y1="48" x2="380" y2="68" stroke="#0e7490" stroke-width="2" marker-end="url(#a4)"/>
  <!-- Q1 -->
  <rect x="280" y="72" width="200" height="36" rx="8" fill="#ecfeff" stroke="#0e7490" stroke-width="1.5"/>
  <text x="380" y="95" text-anchor="middle" font-size="10" font-weight="800" fill="#0f4c5c">School has managed bus?</text>
  <!-- Yes left -->
  <line x1="280" y1="90" x2="200" y2="90" stroke="#16a34a" stroke-width="1.5"/>
  <line x1="200" y1="90" x2="200" y2="130" stroke="#16a34a" stroke-width="1.5" marker-end="url(#a4)"/>
  <text x="234" y="84" font-size="9" font-weight="700" fill="#16a34a">YES</text>
  <rect x="120" y="134" width="160" height="36" rx="8" fill="#d1fae5" stroke="#16a34a" stroke-width="1.5"/>
  <text x="200" y="157" text-anchor="middle" font-size="10" font-weight="700" fill="#14532d">Use StudentRide</text>
  <!-- No right -->
  <line x1="480" y1="90" x2="560" y2="90" stroke="#dc2626" stroke-width="1.5"/>
  <line x1="560" y1="90" x2="560" y2="130" stroke="#64748b" stroke-width="1.5" marker-end="url(#a4d)"/>
  <text x="500" y="84" font-size="9" font-weight="700" fill="#dc2626">NO</text>
  <!-- Q2 -->
  <rect x="460" y="134" width="200" height="36" rx="8" fill="#ecfeff" stroke="#0e7490" stroke-width="1.5"/>
  <text x="560" y="157" text-anchor="middle" font-size="10" font-weight="800" fill="#0f4c5c">Shebah available nearby?</text>
  <!-- Yes -->
  <line x1="460" y1="152" x2="400" y2="152" stroke="#16a34a" stroke-width="1.5"/>
  <line x1="400" y1="152" x2="400" y2="192" stroke="#16a34a" stroke-width="1.5" marker-end="url(#a4)"/>
  <text x="424" y="146" font-size="9" font-weight="700" fill="#16a34a">YES</text>
  <rect x="320" y="196" width="160" height="36" rx="8" fill="#d1fae5" stroke="#16a34a" stroke-width="1.5"/>
  <text x="400" y="219" text-anchor="middle" font-size="10" font-weight="700" fill="#14532d">Book Shebah</text>
  <!-- No -->
  <line x1="660" y1="152" x2="700" y2="152" stroke="#dc2626" stroke-width="1.5"/>
  <line x1="700" y1="152" x2="700" y2="192" stroke="#64748b" stroke-width="1.5" marker-end="url(#a4d)"/>
  <text x="672" y="146" font-size="9" font-weight="700" fill="#dc2626">NO</text>
  <rect x="620" y="196" width="130" height="36" rx="8" fill="#fef3c7" stroke="#d97706" stroke-width="1.5"/>
  <text x="685" y="212" text-anchor="middle" font-size="9" font-weight="700" fill="#78350f">Kabs4Kids / Kiddo</text>
  <text x="685" y="224" text-anchor="middle" font-size="8" fill="#78350f">(verify availability)</text>
  <!-- Warning -->
  <rect x="10" y="196" width="180" height="36" rx="8" fill="#fef2f2" stroke="#dc2626" stroke-width="1.5"/>
  <text x="100" y="212" text-anchor="middle" font-size="9" font-weight="700" fill="#991b1b">Standard Uber/rideshare</text>
  <text x="100" y="224" text-anchor="middle" font-size="9" font-weight="700" fill="#dc2626">NOT for under-13s</text>
</svg>`,
  },
};

export function ideaDiagram(ideaId: string): string {
  const entry = diagrams[ideaId];
  if (!entry) return '';
  return `<div class="idea-diagram"><div class="idea-diagram-label">${entry.label}</div>${entry.svg}</div>`;
}
