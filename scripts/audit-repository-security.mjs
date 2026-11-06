// Read-only audit. No deployments, Git mutations, or access to account secrets.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean).map((path) => path.replaceAll("\\", "/"));
const errors = [];

function isPrivateFile(path) {
  const name = path.split("/").at(-1).toLowerCase();
  if (name === ".env.example" || name === ".dev.vars.example") return false;
  return (
    /^\.env(?:\..+)?$/.test(name)
    || /^\.dev\.vars(?:\..+)?$/.test(name)
    || name === ".npmrc"
    || /^gha-creds-.*\.json$/.test(name)
    || /^(?:service-account[^/]*|[^/]*credentials[^/]*)\.json$/.test(name)
    || /\.(?:pem|p12|pfx|key)$/.test(name)
    || /^firebase-debug(?:\..*)?\.log$/.test(name)
  );
}

const textTypes = new Set([".js", ".mjs", ".cjs", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".html", ".md", ".txt", ".rules", ".css", ".env"]);
const signatureRules = [
  { name: "private-key header", re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: "GitHub personal access token", re: /gh(?:p|o|u|s|r)_[a-zA-Z0-9_]{30,}|github_pat_[a-zA-Z0-9_]{55,}/ },
  { name: "live payment secret", re: /sk_live_[a-zA-Z0-9]{16,}/ }
];

for (const path of tracked) {
  if (isPrivateFile(path)) {
    errors.push(`Tracked private filename: ${path}`);
    continue;
  }
  if (!textTypes.has(extname(path).toLowerCase())) continue;
  let content;
  try { content = readFileSync(path, "utf8"); } catch { continue; }
  for (const rule of signatureRules) {
    if (rule.re.test(content)) errors.push(`Possible ${rule.name} in ${path}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`SECURITY AUDIT FAILED: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Security filename/signature audit passed (${tracked.length} tracked files checked).`);
  console.log("Note: this is not a historical Git secret scan or a replacement for service-side access reviews.");
}
