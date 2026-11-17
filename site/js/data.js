/* Labels shared by the pages. The listings themselves come from /api/projects (BC.load in common.js).
   kind: "Game" | "Mod" | "App"; status: adopt | help | test | active | archived */
window.BC_DATA = {
  statuses: {
    adopt:    { label: "Up for adoption",      cta: "Adopt" },
    help:     { label: "Open for collaboration", cta: "Join in" },
    test:     { label: "Needs testers",        cta: "Test it" },
    active:   { label: "Active",               cta: "Follow" },
    archived: { label: "Archived",             cta: "Revive" }
  },
  statusOrder: ["adopt", "help", "test", "active", "archived"],
  genres: ["Puzzle", "Platformer", "Racing", "Roguelite", "Narrative", "Sandbox", "Simulation", "Strategy", "Tactics", "Productivity", "Utility", "Creative tools"],
  items: [] // filled from /api/projects by BC.load
};
