import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupingGranularity, groupingInstructions, groupSystemPrompt, stripContextPrefix } from "./classify.js";

describe("groupingGranularity", () => {
  it("defaults to balanced", () => {
    assert.equal(groupingGranularity({}), "balanced");
    assert.equal(groupingGranularity({ groupingGranularity: "nope" }), "balanced");
  });
  it("accepts known levels", () => {
    assert.equal(groupingGranularity({ groupingGranularity: "fine" }), "fine");
    assert.equal(groupingGranularity({ groupingGranularity: "coarse" }), "coarse");
  });
});

describe("groupSystemPrompt", () => {
  it("bans context prefixes at every level", () => {
    for (const level of ["coarse", "balanced", "fine"]) {
      assert.match(groupSystemPrompt(level), /Never prefix, suffix, or qualify a name with the company/);
    }
  });
  it("tells balanced not to use the company as the group", () => {
    const prompt = groupSystemPrompt("balanced");
    assert.match(prompt, /An employer or brand on its own is not a workstream/);
    assert.match(prompt, /umbrella brand/);
  });
  it("tells fine to split surfaces", () => {
    const prompt = groupSystemPrompt("fine");
    assert.match(prompt, /Different repos are separate groups/);
    assert.doesNotMatch(prompt, /An employer or brand on its own is not a workstream/);
  });
  it("lets coarse use a company-sized group", () => {
    const prompt = groupSystemPrompt("coarse");
    assert.match(prompt, /employer when the tabs really are about that one thing/);
    assert.doesNotMatch(prompt, /umbrella brand/);
  });
  it("rejects unknown levels", () => {
    assert.throws(() => groupSystemPrompt("mega"), /Unknown grouping granularity/);
  });
  it("does not strand a lone tab on an incremental run", () => {
    for (const level of ["coarse", "balanced", "fine"]) {
      const prompt = groupSystemPrompt(level);
      assert.doesNotMatch(prompt, /only when at least two tabs in this batch/);
      assert.match(prompt, /A batch of one or two tabs is normal on an incremental run/);
    }
    assert.match(groupSystemPrompt("balanced"), /a single tab may start that group/);
  });
});

describe("standing tools", () => {
  it("no longer treats admin as an ungroupable theme", () => {
    for (const level of ["coarse", "balanced", "fine"]) {
      const prompt = groupSystemPrompt(level);
      assert.doesNotMatch(prompt, /planning, research, work, admin, learning/);
      assert.doesNotMatch(prompt, /Personal, Admin, General/);
      assert.match(prompt, /Standing tools are the one exception/);
    }
  });
  it("bundles everything under Admin at coarse", () => {
    assert.match(groupSystemPrompt("coarse"), /one group called "Admin"/);
  });
  it("splits by function at balanced", () => {
    const prompt = groupSystemPrompt("balanced");
    assert.match(prompt, /"Meetings" \(calendar, invites, video calls\)/);
    assert.match(prompt, /"Admin" \(HR, expenses/);
  });
  it("splits by individual tool at fine", () => {
    assert.match(groupSystemPrompt("fine"), /"Calendar", "Invites", "Email", "Expenses"/);
  });
  it("keeps project work out of the tools groups", () => {
    assert.match(groupSystemPrompt("balanced"), /never sweep real project work into a standing-tools group/);
  });
});

describe("groupingInstructions", () => {
  it("trims and tolerates blanks", () => {
    assert.equal(groupingInstructions({ groupingInstructions: "  Keep Tickets  " }), "Keep Tickets");
    assert.equal(groupingInstructions({ groupingInstructions: "   " }), "");
    assert.equal(groupingInstructions({}), "");
    assert.equal(groupingInstructions(undefined), "");
  });
});

describe("user rules in the grouping prompt", () => {
  it("is absent when the user has written nothing", () => {
    const prompt = groupSystemPrompt("balanced", "");
    assert.doesNotMatch(prompt, /Rules from the user/);
  });
  it("appends the rules after the defaults", () => {
    const prompt = groupSystemPrompt("balanced", "Never group my banking tabs.");
    assert.match(prompt, /Rules from the user/);
    assert.match(prompt, /Never group my banking tabs\.$/);
    assert.ok(prompt.indexOf("Rules from the user") > prompt.indexOf("Naming:"));
  });
  it("gives the rules precedence but keeps the output contract", () => {
    const prompt = groupSystemPrompt("fine", "Prefix work groups with Acme.");
    assert.match(prompt, /they outrank everything above whenever they conflict/);
    assert.match(prompt, /exactly one assignment per tab/);
    assert.match(prompt, /colour from the allowed list/);
  });
});

describe("stripContextPrefix", () => {
  it("keeps the workstream half", () => {
    assert.equal(stripContextPrefix("Acme · Code Review"), "Code Review");
    assert.equal(stripContextPrefix("Acme | Payroll"), "Payroll");
    assert.equal(stripContextPrefix("Acme: Palette"), "Acme: Palette");
    assert.equal(stripContextPrefix("Acme : Palette"), "Palette");
    assert.equal(stripContextPrefix("Acme - Infra"), "Infra");
  });
  it("leaves plain names alone", () => {
    assert.equal(stripContextPrefix("Kitchen Reno"), "Kitchen Reno");
    assert.equal(stripContextPrefix("Tax Return"), "Tax Return");
    assert.equal(stripContextPrefix("E-Bike"), "E-Bike");
    assert.equal(stripContextPrefix(""), "");
    assert.equal(stripContextPrefix(undefined), "");
  });
});
