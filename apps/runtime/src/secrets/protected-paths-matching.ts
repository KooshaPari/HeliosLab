import type { ProtectedPathPattern } from "./protected-paths-types.js";

export const DEFAULT_PATTERNS: ProtectedPathPattern[] = [
  {
    id: "dotenv",
    pattern: ".env",
    description: ".env files (exact and variants like .env.local, .env.production)",
    enabled: true,
    isDefault: true,
  },
  {
    id: "credentials-json",
    pattern: "credentials.json",
    description: "Generic credentials.json files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "credentials-yaml",
    pattern: "credentials.yaml",
    description: "Generic credentials.yaml files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "credentials-yml",
    pattern: "credentials.yml",
    description: "Generic credentials.yml files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "secrets-dir",
    pattern: "**/secrets/**",
    description: "Any path containing a secrets directory",
    enabled: true,
    isDefault: true,
  },
  {
    id: "ssh-private-key",
    pattern: "~/.ssh/id_*",
    description: "SSH private key files",
    enabled: true,
    isDefault: true,
  },
  {
    id: "aws-credentials",
    pattern: "~/.aws/credentials",
    description: "AWS credentials file",
    enabled: true,
    isDefault: true,
  },
  {
    id: "aws-config",
    pattern: "~/.aws/config",
    description: "AWS config file",
    enabled: true,
    isDefault: true,
  },
  {
    id: "gcloud-adc",
    pattern: "~/.config/gcloud/application_default_credentials.json",
    description: "GCP application default credentials",
    enabled: true,
    isDefault: true,
  },
  {
    id: "gcp-service-account",
    pattern: "**/service-account*.json",
    description: "GCP service account key files",
    enabled: true,
    isDefault: true,
  },
];

const FILE_ARG_COMMANDS = [
  "cat",
  "less",
  "more",
  "head",
  "tail",
  "vim",
  "vi",
  "nano",
  "emacs",
  "code",
  "cp",
  "mv",
  "scp",
  "rsync",
  "source",
  ".",
];

export function matchesPattern(filePath: string, pattern: string): boolean {
  const expandedPattern = pattern.replace(/^~\//, "");
  const expandedPath = filePath.replace(/^~\//, "").replace(/^\/home\/[^/]+\//, "");

  if (pattern === ".env") {
    const base = filePath.split("/").pop() ?? filePath;
    return base === ".env" || base.startsWith(".env.");
  }

  if (!pattern.includes("*") && !pattern.includes("?")) {
    const base = filePath.split("/").pop() ?? filePath;
    const patBase = pattern.split("/").pop() ?? pattern;
    if (base === patBase) return true;
    if (filePath.endsWith(pattern) || filePath === pattern) return true;
    if (expandedPath.endsWith(expandedPattern) || expandedPath === expandedPattern) return true;
    return false;
  }

  const regexSource = globToRegex(pattern);
  const regex = new RegExp(regexSource, "i");
  return regex.test(filePath) || regex.test(expandedPath);
}

function globToRegex(glob: string): string {
  let result = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      result += ".*";
      i += 2;
      if (glob[i] === "/") i++;
    } else if (ch === "*") {
      result += "[^/]*";
      i++;
    } else if (ch === "?") {
      result += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      result += "\\" + ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return "(^|/|^.*[/\\\\])" + result + "($|[/\\\\])";
}

export function extractFilePaths(command: string): string[] {
  const paths: string[] = [];
  const tokens = tokenizeCommand(command);

  if (tokens.length === 0) return paths;

  const cmd = tokens[0];

  if (cmd === "curl") {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if ((tok === "-d" || tok === "--data" || tok === "--data-binary") && i + 1 < tokens.length) {
        const next = tokens[i + 1];
        if (next.startsWith("@")) paths.push(next.slice(1));
        i++;
      } else if (tok.startsWith("@")) {
        paths.push(tok.slice(1));
      }
    }
    return paths;
  }

  if (cmd === "scp") {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.startsWith("-")) continue;
      if (tok.includes(":")) continue;
      paths.push(tok);
    }
    return paths;
  }

  if (FILE_ARG_COMMANDS.includes(cmd)) {
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.startsWith("-")) {
        paths.push(tok);
      }
    }
    return paths;
  }

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith("-") && looksLikeFilePath(tok)) {
      paths.push(tok);
    }
  }

  return paths;
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function looksLikeFilePath(tok: string): boolean {
  return (
    tok.startsWith("/") ||
    tok.startsWith("~/") ||
    tok.startsWith("./") ||
    tok.startsWith("../") ||
    tok.includes(".") ||
    tok.includes("/")
  );
}

export function redactCommandForAudit(command: string): string {
  return command
    .replace(/(?:AKIA[0-9A-Z]{16})/g, "[REDACTED:AWS_ACCESS_KEY]")
    .replace(/(?:AIza[0-9A-Za-z\-_]{35})/g, "[REDACTED:GCP_API_KEY]")
    .replace(/(?:sk-[A-Za-z0-9]{48,})/g, "[REDACTED:OPENAI_KEY]")
    .replace(/(?:gh[ps]_[A-Za-z0-9_]{36,})/g, "[REDACTED:GITHUB_TOKEN]")
    .replace(/(?:Bearer [A-Za-z0-9\-._~+/]+=*)/g, "Bearer [REDACTED:TOKEN]")
    .replace(
      /(?:(?:api_key|apikey|API_KEY)\s*[=:]\s*["']?)([A-Za-z0-9\-_]{16,})["']?/gi,
      () => "[REDACTED:API_KEY]"
    );
}
