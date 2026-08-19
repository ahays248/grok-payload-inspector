import { describe, expect, it } from "vitest";
import {
  extractSkills,
  isGenerationPath,
  isMcpName,
  parseResponseStream,
  parseTurnFromRequest,
  splitSystemPrompt,
} from "./parse";

describe("isGenerationPath", () => {
  it("logs Responses and chat completions POSTs", () => {
    expect(isGenerationPath("POST", "/v1/responses")).toBe(true);
    expect(isGenerationPath("POST", "/v1/chat/completions")).toBe(true);
    expect(isGenerationPath("GET", "/v1/models")).toBe(false);
    expect(isGenerationPath("POST", "/v1/settings")).toBe(false);
  });
});

describe("isMcpName", () => {
  it("treats qualified names as MCP", () => {
    expect(isMcpName("github__create_issue")).toBe(true);
    expect(isMcpName("mcp__slack__send")).toBe(true);
    expect(isMcpName("read_file")).toBe(false);
    expect(isMcpName("run_terminal_command")).toBe(false);
  });
});

describe("extractSkills", () => {
  it("pulls the skills catalogue out of the system prompt", () => {
    const system = `You are Grok.

The following skills are available for use:

- find-skills: Helps users discover skills.
  Absolute path: /tmp/skills/find-skills/SKILL.md
- pdf: Read and create PDF files.
  Absolute path: /tmp/skills/pdf/SKILL.md

MCP servers connected:
- github (89 tools)
`;
    const { skills, rest } = extractSkills(system);
    expect(skills.map((s) => s.name)).toEqual(["find-skills", "pdf"]);
    expect(skills[0].path).toMatch(/find-skills/);
    expect(rest).toContain("You are Grok.");
    expect(rest).not.toContain("find-skills:");
  });
});

describe("parseTurnFromRequest", () => {
  it("splits native tools from MCP and estimates tokens", () => {
    const body = {
      model: "grok-4.6",
      instructions: `You are Grok.\n\nThe following skills are available for use:\n\n- pdf: Read PDFs.\n  Absolute path: /pdf/SKILL.md\n`,
      tools: [
        {
          type: "function",
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
        {
          type: "function",
          name: "github__create_issue",
          description: "Create an issue",
          parameters: { type: "object", properties: { title: { type: "string" } } },
        },
      ],
      input: [{ type: "message", role: "user", content: "Hello!" }],
      stream: true,
    };
    const turn = parseTurnFromRequest({
      id: "t1",
      timestamp: "2026-08-19T00:00:00.000Z",
      method: "POST",
      path: "/v1/responses",
      requestText: JSON.stringify(body),
    });
    expect(turn.model).toBe("grok-4.6");
    expect(turn.tools.map((t) => t.name)).toEqual(["read_file"]);
    expect(turn.mcpTools.map((t) => t.name)).toEqual(["github__create_issue"]);
    expect(turn.skills.map((s) => s.name)).toEqual(["pdf"]);
    expect(turn.messages.some((m) => m.text.includes("Hello!"))).toBe(true);
    expect(turn.totals.tools).toBeGreaterThan(0);
    expect(turn.totals.mcp).toBeGreaterThan(0);
    expect(turn.totals.skills).toBeGreaterThan(0);
    expect(turn.totals.total).toBeGreaterThan(turn.totals.tools);
    expect(turn.lastUserText).toBe("Hello!");
    expect(turn.userMessageCount).toBe(1);
    expect(turn.groupKey).toBe("1::Hello!");
  });
});

describe("splitSystemPrompt", () => {
  it("breaks a headed prompt into named slices", () => {
    const slices = splitSystemPrompt(
      `# Environment\nOS Version: windows\n\n# Communication\nBe concise.\n`
    );
    expect(slices.map((s) => s.title)).toEqual(["Environment", "Communication"]);
  });
});

describe("parseResponseStream", () => {
  it("joins Responses API text deltas", () => {
    const raw = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      "",
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":" world"}',
      "",
    ].join("\n");
    const parsed = parseResponseStream(raw);
    expect(parsed.text).toBe("Hello world");
  });
});
