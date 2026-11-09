import { describe, expect, it } from "vitest";
import { validateSkillPackage } from "./skills.js";

describe("skill package validation", () => {
  it("validates metadata and hashes content without granting permissions", () => {
    const result = validateSkillPackage({
      content: "---\nname: repo-auditor\nversion: 1.2.0\ndescription: Read-only repository review\n---\n\nInspect source files and report evidence.",
      requestedPermissions: ["repository.read", "memory.write"],
      dependencies: ["typescript"]
    });

    expect(result).toMatchObject({
      valid: true,
      status: "validated_metadata_only",
      manifest: { name: "repo-auditor", version: "1.2.0" },
      permissionsGranted: [],
      executionEnabled: false,
      dependencies: ["typescript"]
    });
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects malformed metadata and unknown permission scopes", () => {
    const result = validateSkillPackage({
      content: "---\nname: Bad Name\nversion: latest\ndescription:\n---\n\n ",
      requestedPermissions: ["root.access"],
      dependencies: ["Bad Dependency"]
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.unknownPermissions).toEqual(["root.access"]);
    expect(result.permissionsGranted).toEqual([]);
    expect(result.executionEnabled).toBe(false);
  });

  it("rejects content without a frontmatter block", () => {
    const result = validateSkillPackage({ content: "# Skill\nDo something." });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("frontmatter");
  });
});
