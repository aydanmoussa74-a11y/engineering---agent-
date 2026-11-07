import { createHash } from "node:crypto";

export type SkillValidationInput = {
  content: string;
  requestedPermissions?: string[];
  dependencies?: string[];
};

const KNOWN_PERMISSION_SCOPES = new Set([
  "repository.read",
  "memory.read",
  "memory.write",
  "web.read",
  "terminal.execute",
  "repository.write",
  "dependency.install",
  "deployment.create"
]);

function scalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function validateSkillPackage(input: SkillValidationInput) {
  const errors: string[] = [];
  const content = input.content;
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const metadata: Record<string, string> = {};

  if (!frontmatter) {
    errors.push("SKILL.md must begin with a YAML frontmatter block.");
  } else {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^([a-z][a-z0-9_-]*):\s*(.*)$/i);
      if (match?.[1]) metadata[match[1].toLowerCase()] = scalar(match[2] ?? "");
    }
  }

  const name = metadata.name ?? "";
  const version = metadata.version ?? "";
  const description = metadata.description ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    errors.push("Skill name must be lowercase kebab-case.");
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    errors.push("Skill version must use semantic versioning.");
  }
  if (!description || description.length > 500) {
    errors.push("Skill description is required and must be 500 characters or fewer.");
  }
  if (!frontmatter || !content.slice(frontmatter[0].length).trim()) {
    errors.push("Skill package must include non-empty instruction content after frontmatter.");
  }

  const requestedPermissions = [...new Set(input.requestedPermissions ?? [])].sort();
  const unknownPermissions = requestedPermissions.filter((permission) => !KNOWN_PERMISSION_SCOPES.has(permission));
  const dependencies = [...new Set(input.dependencies ?? [])].sort();
  const invalidDependencies = dependencies.filter((dependency) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dependency));

  if (unknownPermissions.length) errors.push("One or more requested permission scopes are unknown.");
  if (invalidDependencies.length) errors.push("Dependency names must use lowercase kebab-case.");

  return {
    valid: errors.length === 0,
    status: errors.length === 0 ? "validated_metadata_only" : "rejected",
    manifest: {
      name: name || null,
      version: version || null,
      description: description || null
    },
    contentSha256: hash,
    contentBytes: Buffer.byteLength(content, "utf8"),
    dependencies,
    requestedPermissions,
    unknownPermissions,
    invalidDependencies,
    permissionsGranted: [],
    executionEnabled: false,
    errors,
    limitations: [
      "Only a deliberately small flat YAML frontmatter subset is parsed; nested YAML is not supported.",
      "Validation does not install, enable, execute or grant authority to a skill.",
      "Content integrity is represented by SHA-256; provenance and publisher authenticity require a separate trust check."
    ]
  };
}
