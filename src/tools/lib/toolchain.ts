/**
 * Toolchain Manager — catalog of the developer tools this machine is expected to have,
 * plus the pure logic for detection specs, filtering and version display.
 *
 * The catalog is deliberately declarative: the native side (`toolchain_probe`) only
 * knows how to run three kinds of check (CLI version command, Windows uninstall-registry
 * name match, filesystem path), so adding a tool here needs no Rust change.
 *
 * Nothing in this file executes anything — the UI decides when to probe or install.
 */

export type ToolGroup =
  | "runtime"
  | "ide"
  | "database"
  | "messaging"
  | "cloud"
  | "api"
  | "ai"
  | "vcs"
  | "cli";

export const GROUP_LABELS: Record<ToolGroup, string> = {
  runtime: "Runtimes & SDKs",
  ide: "IDEs & Editors",
  database: "Databases & Data Tools",
  messaging: "Messaging & Cache",
  cloud: "Cloud & DevOps",
  api: "API & Testing",
  ai: "AI & Assistants",
  vcs: "Source Control",
  cli: "CLI Utilities",
};

export const GROUP_ORDER: ToolGroup[] = [
  "runtime",
  "ide",
  "database",
  "messaging",
  "cloud",
  "api",
  "ai",
  "vcs",
  "cli",
];

/** One way of detecting a tool. Checks run in order; the first hit wins. */
export type Check =
  /** Run `bin args…` and read the version out of the first line of output. */
  | { kind: "cli"; bin: string; args: string[] }
  /** Match a DisplayName in the Windows uninstall registry (lowercase substring, `|` = alternatives). */
  | { kind: "registry"; match: string }
  /** Existence of a file or directory. `%VAR%` is expanded from the environment. */
  | { kind: "path"; path: string };

export interface ToolDef {
  id: string;
  name: string;
  group: ToolGroup;
  /** What this tool actually does for you — shown as chips in the UI. */
  capabilities: string[];
  checks: Check[];
  /** winget package id, enables one-click install of the latest version. */
  wingetId?: string;
  /** Vendor download page, used when there is no winget package (or install fails). */
  downloadUrl?: string;
  /** Command to run by hand (npm globals, etc.) — shown as copyable text. */
  manualCmd?: string;
  /** Caveat worth knowing even when the tool is installed. */
  note?: string;
  /** Core to this machine's stack — surfaced first and counted in the headline score. */
  essential?: boolean;
}

export const TOOL_CATALOG: ToolDef[] = [
  // ── Runtimes & SDKs ───────────────────────────────────────────────────────
  {
    id: "dotnet-sdk",
    name: ".NET SDK",
    group: "runtime",
    capabilities: ["C# / ASP.NET Core build + run", "Web API & microservices", "EF Core migrations", "dotnet CLI templates"],
    checks: [{ kind: "cli", bin: "dotnet", args: ["--version"] }],
    wingetId: "Microsoft.DotNet.SDK.10",
    downloadUrl: "https://dotnet.microsoft.com/download",
    note: "winget ids are version-pinned (Microsoft.DotNet.SDK.8 / .10) — if install fails, the exact id has moved.",
    essential: true,
  },
  {
    id: "dotnet-fx-devpack",
    name: ".NET Framework 4.8 Dev Pack",
    group: "runtime",
    capabilities: ["Legacy ASP.NET MVC / WinForms builds", "HL7 / ASTM legacy integrations", "Targeting packs for old solutions"],
    checks: [{ kind: "registry", match: "microsoft .net framework 4.8 sdk|.net framework 4.8 targeting pack" }],
    wingetId: "Microsoft.DotNet.Framework.DeveloperPack_4",
    downloadUrl: "https://dotnet.microsoft.com/download/dotnet-framework/net48",
    essential: true,
  },
  {
    id: "aspnet-hosting",
    name: "ASP.NET Core Hosting Bundle",
    group: "runtime",
    capabilities: ["Host ASP.NET Core apps on IIS", "ANCM module", "Required on deploy targets"],
    checks: [{ kind: "registry", match: "windows server hosting|asp.net core module v2" }],
    downloadUrl: "https://dotnet.microsoft.com/download/dotnet",
  },
  {
    id: "node",
    name: "Node.js",
    group: "runtime",
    capabilities: ["Angular / React builds", "npm tooling", "Local dev servers"],
    checks: [{ kind: "cli", bin: "node", args: ["--version"] }],
    wingetId: "OpenJS.NodeJS.LTS",
    downloadUrl: "https://nodejs.org",
    essential: true,
  },
  {
    id: "npm",
    name: "npm",
    group: "runtime",
    capabilities: ["Package install", "Global CLI tools", "Workspace scripts"],
    checks: [{ kind: "cli", bin: "npm", args: ["--version"] }],
    downloadUrl: "https://nodejs.org",
  },
  {
    id: "nvm",
    name: "nvm for Windows",
    group: "runtime",
    capabilities: ["Switch Node versions per project", "Isolate legacy Angular builds"],
    checks: [{ kind: "cli", bin: "nvm", args: ["version"] }],
    wingetId: "CoreyButler.NVMforWindows",
    downloadUrl: "https://github.com/coreybutler/nvm-windows/releases",
    note: "Global npm packages live per Node version — reinstall CLIs after switching.",
  },
  {
    id: "angular-cli",
    name: "Angular CLI",
    group: "runtime",
    capabilities: ["ng generate / build / serve", "Schematics", "Production bundles"],
    checks: [{ kind: "cli", bin: "ng", args: ["version"] }],
    manualCmd: "npm install -g @angular/cli",
    downloadUrl: "https://angular.dev/tools/cli",
    essential: true,
  },
  {
    id: "typescript",
    name: "TypeScript (tsc)",
    group: "runtime",
    capabilities: ["Type-check outside an IDE", "Standalone compiles", "CI type gates"],
    checks: [{ kind: "cli", bin: "tsc", args: ["--version"] }],
    manualCmd: "npm install -g typescript",
    downloadUrl: "https://www.typescriptlang.org",
  },
  {
    id: "python",
    name: "Python 3",
    group: "runtime",
    capabilities: ["AsyncIO / WebSocket services", "Market-data feeders", "AI & RAG scripts"],
    checks: [{ kind: "cli", bin: "python", args: ["--version"] }],
    wingetId: "Python.Python.3.12",
    downloadUrl: "https://www.python.org/downloads/",
    essential: true,
  },
  {
    id: "pip",
    name: "pip",
    group: "runtime",
    capabilities: ["Install Python packages", "Freeze requirements"],
    checks: [{ kind: "cli", bin: "pip", args: ["--version"] }],
    downloadUrl: "https://pip.pypa.io",
  },
  {
    id: "uv",
    name: "uv",
    group: "runtime",
    capabilities: ["Fast venv + dependency resolve", "Replaces pip/virtualenv for new services"],
    checks: [{ kind: "cli", bin: "uv", args: ["--version"] }],
    wingetId: "astral-sh.uv",
    downloadUrl: "https://docs.astral.sh/uv/",
  },
  {
    id: "java",
    name: "Java JDK",
    group: "runtime",
    capabilities: ["Runs Oracle SQL Developer", "Runs Elasticsearch / Kafka tooling"],
    checks: [
      { kind: "cli", bin: "java", args: ["-version"] },
      { kind: "path", path: "C:\\Program Files\\Java" },
    ],
    wingetId: "Microsoft.OpenJDK.21",
    downloadUrl: "https://learn.microsoft.com/java/openjdk/download",
    note: "Set JAVA_HOME and add %JAVA_HOME%\\bin to PATH or JDK-based tools will not find it.",
  },
  {
    id: "go",
    name: "Go",
    group: "runtime",
    capabilities: ["Build small services / CLIs", "Cross-compile static binaries"],
    checks: [{ kind: "cli", bin: "go", args: ["version"] }],
    wingetId: "GoLang.Go",
    downloadUrl: "https://go.dev/dl/",
  },
  {
    id: "rust",
    name: "Rust (rustup)",
    group: "runtime",
    capabilities: ["Native Tauri layer of DevHelper", "cargo build / test"],
    checks: [{ kind: "cli", bin: "rustc", args: ["--version"] }],
    wingetId: "Rustlang.Rustup",
    downloadUrl: "https://rustup.rs",
  },
  {
    id: "powershell7",
    name: "PowerShell 7",
    group: "runtime",
    capabilities: ["Automation scripts", "Cross-platform pwsh", "CI local runs"],
    checks: [{ kind: "cli", bin: "pwsh", args: ["--version"] }],
    wingetId: "Microsoft.PowerShell",
    downloadUrl: "https://github.com/PowerShell/PowerShell/releases",
    essential: true,
  },
  {
    id: "pnpm",
    name: "pnpm",
    group: "runtime",
    capabilities: ["Fast, disk-efficient installs", "Monorepo workspaces"],
    checks: [{ kind: "cli", bin: "pnpm", args: ["--version"] }],
    wingetId: "pnpm.pnpm",
    downloadUrl: "https://pnpm.io",
  },

  // ── IDEs & Editors ────────────────────────────────────────────────────────
  {
    id: "visual-studio",
    name: "Visual Studio",
    group: "ide",
    capabilities: ["Full .NET / C# IDE", "Debugger + profiler", "SQL Server Data Tools", "EF designer"],
    checks: [{ kind: "registry", match: "visual studio community|visual studio professional|visual studio enterprise" }],
    downloadUrl: "https://visualstudio.microsoft.com/downloads/",
    note: "Install / modify workloads through the Visual Studio Installer, not winget.",
    essential: true,
  },
  {
    id: "vs-build-tools",
    name: "Visual Studio Build Tools",
    group: "ide",
    capabilities: ["MSBuild without the IDE", "C++ toolchain for native crates", "CI-style local builds"],
    checks: [{ kind: "registry", match: "visual studio build tools" }],
    downloadUrl: "https://visualstudio.microsoft.com/downloads/",
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    group: "ide",
    capabilities: ["Editor for TS / Python / SQL", "Integrated terminal + debugger", "Extension ecosystem"],
    checks: [{ kind: "cli", bin: "code", args: ["--version"] }, { kind: "registry", match: "visual studio code" }],
    wingetId: "Microsoft.VisualStudioCode",
    downloadUrl: "https://code.visualstudio.com",
    essential: true,
  },
  {
    id: "cursor",
    name: "Cursor",
    group: "ide",
    capabilities: ["AI-native editor", "Repo-wide edits", "Inline model chat"],
    checks: [{ kind: "registry", match: "cursor" }],
    wingetId: "Anysphere.Cursor",
    downloadUrl: "https://cursor.com",
  },
  {
    id: "windows-terminal",
    name: "Windows Terminal",
    group: "ide",
    capabilities: ["Tabs / panes for pwsh, WSL, cmd", "Profile per environment"],
    // `wt` launches a window instead of printing a version, and MSIX apps are not in the
    // uninstall registry — detect the execution alias instead.
    checks: [
      { kind: "path", path: "%LOCALAPPDATA%\\Microsoft\\WindowsApps\\wt.exe" },
      { kind: "registry", match: "windows terminal" },
    ],
    wingetId: "Microsoft.WindowsTerminal",
    downloadUrl: "https://aka.ms/terminal",
  },

  // ── Databases & Data Tools ────────────────────────────────────────────────
  {
    id: "mssql-server",
    name: "SQL Server (Engine)",
    group: "database",
    capabilities: ["Local dev database", "T-SQL procs / jobs", "Backup + restore testing"],
    checks: [{ kind: "registry", match: "sql server 2025 database engine services|sql server 2022 database engine services|sql server 2019 database engine services" }],
    wingetId: "Microsoft.SQLServer.2022.Developer",
    downloadUrl: "https://www.microsoft.com/sql-server/sql-server-downloads",
    essential: true,
  },
  {
    id: "ssms",
    name: "SQL Server Management Studio",
    group: "database",
    capabilities: ["Query + tune T-SQL", "Execution plans", "Agent jobs, security, backups"],
    checks: [{ kind: "registry", match: "sql server management studio" }],
    wingetId: "Microsoft.SQLServerManagementStudio",
    downloadUrl: "https://aka.ms/ssmsfullsetup",
    essential: true,
  },
  {
    id: "sqlcmd",
    name: "sqlcmd / SQL CLI",
    group: "database",
    capabilities: ["Scripted T-SQL from CI", "Quick smoke queries", "BCP-style data loads"],
    checks: [{ kind: "cli", bin: "sqlcmd", args: ["-?"] }],
    wingetId: "Microsoft.Sqlcmd",
    downloadUrl: "https://learn.microsoft.com/sql/tools/sqlcmd/sqlcmd-utility",
  },
  {
    id: "mssql-odbc",
    name: "ODBC Driver for SQL Server",
    group: "database",
    capabilities: ["pyodbc / Python connectivity", "Legacy app data access"],
    checks: [{ kind: "registry", match: "odbc driver 18 for sql server|odbc driver 17 for sql server" }],
    downloadUrl: "https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server",
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    group: "database",
    capabilities: ["Relational store for services", "psql scripting", "Logical replication tests"],
    checks: [{ kind: "cli", bin: "psql", args: ["--version"] }, { kind: "registry", match: "postgresql" }],
    wingetId: "PostgreSQL.PostgreSQL.18",
    downloadUrl: "https://www.postgresql.org/download/windows/",
    note: "Add C:\\Program Files\\PostgreSQL\\<ver>\\bin to PATH to get psql on the command line.",
    essential: true,
  },
  {
    id: "oracle-instant-client",
    name: "Oracle Instant Client",
    group: "database",
    capabilities: ["sqlplus", "ODP.NET / oracledb drivers", "Needed for ERP/HRMS Oracle work"],
    checks: [{ kind: "cli", bin: "sqlplus", args: ["-v"] }],
    downloadUrl: "https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html",
  },
  {
    id: "oracle-sql-developer",
    name: "Oracle SQL Developer",
    group: "database",
    capabilities: ["Browse Oracle schemas", "PL/SQL debugging", "Data export"],
    checks: [{ kind: "path", path: "C:\\Program Files\\sqldeveloper" }, { kind: "registry", match: "sql developer" }],
    wingetId: "Oracle.SQLDeveloper",
    downloadUrl: "https://www.oracle.com/database/sqldeveloper/technologies/download/",
  },
  {
    id: "toad",
    name: "Toad for Oracle",
    group: "database",
    capabilities: ["Oracle schema browser", "SQL tuning advisor", "Session monitoring"],
    checks: [{ kind: "registry", match: "toad" }],
    downloadUrl: "https://www.quest.com/products/toad-for-oracle/",
    note: "Commercial license — no unattended install.",
  },
  {
    id: "dbeaver",
    name: "DBeaver",
    group: "database",
    capabilities: ["One client for MSSQL / PG / Oracle / MySQL", "ER diagrams", "Data transfer between engines"],
    checks: [{ kind: "registry", match: "dbeaver" }],
    wingetId: "DBeaver.DBeaver.Community",
    downloadUrl: "https://dbeaver.io/download/",
  },
  {
    id: "azure-data-studio",
    name: "Azure Data Studio",
    group: "database",
    capabilities: ["Notebook-style SQL", "Cross-platform MSSQL client"],
    checks: [
      { kind: "registry", match: "azure data studio" },
      { kind: "path", path: "%LOCALAPPDATA%\\Programs\\Azure Data Studio\\azuredatastudio.exe" },
    ],
    wingetId: "Microsoft.AzureDataStudio",
    downloadUrl: "https://learn.microsoft.com/azure-data-studio/download-azure-data-studio",
    note: "Retired by Microsoft (Feb 2026) — prefer VS Code + the MSSQL extension: code --install-extension ms-mssql.mssql",
  },

  // ── Messaging & Cache ─────────────────────────────────────────────────────
  {
    id: "redis",
    name: "Redis Server",
    group: "messaging",
    capabilities: ["Distributed cache", "Pub/Sub fan-out", "Market-data key store"],
    // "redis" alone would also match Redis Insight, so match the server products only.
    checks: [
      { kind: "cli", bin: "redis-cli", args: ["--version"] },
      { kind: "registry", match: "redis on windows|redis server|memurai" },
    ],
    downloadUrl: "https://github.com/redis-windows/redis-windows/releases",
    note: "The old MSOpenTech Windows build is stuck at 5.0 (2018). For 7.x use Docker (docker run -p 6379:6379 redis:7) or WSL2.",
    essential: true,
  },
  {
    id: "redis-insight",
    name: "Redis Insight",
    group: "messaging",
    capabilities: ["Browse keys / TTLs", "Inspect streams and Pub/Sub", "Slowlog analysis"],
    checks: [
      { kind: "registry", match: "redis insight|redisinsight" },
      { kind: "path", path: "%LOCALAPPDATA%\\Programs\\redisinsight\\RedisInsight.exe" },
    ],
    wingetId: "Redis.RedisInsight",
    downloadUrl: "https://redis.io/insight/",
  },
  {
    id: "rabbitmq",
    name: "RabbitMQ Server",
    group: "messaging",
    capabilities: ["Work queues + topic exchanges", "Retry / DLQ patterns", "Management UI on :15672"],
    checks: [{ kind: "registry", match: "rabbitmq" }, { kind: "path", path: "C:\\Program Files\\RabbitMQ Server" }],
    wingetId: "RabbitMQ.Server",
    downloadUrl: "https://www.rabbitmq.com/install-windows.html",
    note: "Needs Erlang/OTP installed first.",
    essential: true,
  },
  {
    id: "erlang",
    name: "Erlang/OTP",
    group: "messaging",
    capabilities: ["Runtime RabbitMQ depends on"],
    checks: [{ kind: "registry", match: "erlang" }, { kind: "path", path: "C:\\Program Files\\Erlang OTP" }],
    wingetId: "Erlang.ErlangOTP",
    downloadUrl: "https://www.erlang.org/downloads",
  },
  {
    id: "nats-server",
    name: "NATS Server",
    group: "messaging",
    capabilities: ["Low-latency pub/sub", "JetStream persistence", "Tick fan-out to consumers"],
    checks: [{ kind: "registry", match: "nats server" }, { kind: "cli", bin: "nats-server", args: ["--version"] }],
    downloadUrl: "https://github.com/nats-io/nats-server/releases",
    essential: true,
  },
  {
    id: "nats-cli",
    name: "NATS CLI",
    group: "messaging",
    capabilities: ["Publish / subscribe from terminal", "Stream + consumer admin", "Latency benchmarks"],
    checks: [{ kind: "cli", bin: "nats", args: ["--version"] }, { kind: "registry", match: "nats command line" }],
    downloadUrl: "https://github.com/nats-io/natscli/releases",
  },
  {
    id: "elasticsearch",
    name: "Elasticsearch",
    group: "messaging",
    capabilities: ["Log / trade search", "Aggregations for diagnostics", "Kibana backend"],
    checks: [{ kind: "registry", match: "elasticsearch" }, { kind: "path", path: "C:\\Program Files\\Elastic" }],
    wingetId: "Elastic.Elasticsearch",
    downloadUrl: "https://www.elastic.co/downloads/elasticsearch",
    note: "Docker is usually simpler: docker run -p 9200:9200 -e discovery.type=single-node elasticsearch:8",
  },

  // ── Cloud & DevOps ────────────────────────────────────────────────────────
  {
    id: "docker",
    name: "Docker Desktop",
    group: "cloud",
    capabilities: ["Run Redis / PG / ES locally", "Build service images", "Compose multi-service stacks"],
    checks: [{ kind: "cli", bin: "docker", args: ["--version"] }, { kind: "registry", match: "docker desktop" }],
    wingetId: "Docker.DockerDesktop",
    downloadUrl: "https://www.docker.com/products/docker-desktop/",
    essential: true,
  },
  {
    id: "azure-cli",
    name: "Azure CLI",
    group: "cloud",
    capabilities: ["Manage App Services", "Azure SQL / Storage admin", "Deploy from scripts + pipelines"],
    checks: [{ kind: "cli", bin: "az", args: ["version"] }],
    wingetId: "Microsoft.AzureCLI",
    downloadUrl: "https://learn.microsoft.com/cli/azure/install-azure-cli-windows",
    essential: true,
  },
  {
    id: "azure-storage-explorer",
    name: "Azure Storage Explorer",
    group: "cloud",
    capabilities: ["Browse blobs / queues / tables", "Upload test payloads"],
    checks: [{ kind: "registry", match: "storage explorer" }],
    wingetId: "Microsoft.AzureStorageExplorer",
    downloadUrl: "https://azure.microsoft.com/products/storage/storage-explorer/",
  },
  {
    id: "aws-cli",
    name: "AWS CLI v2",
    group: "cloud",
    capabilities: ["Amazon SQS queue admin", "S3 transfers", "Credential profiles"],
    checks: [{ kind: "cli", bin: "aws", args: ["--version"] }],
    wingetId: "Amazon.AWSCLI",
    downloadUrl: "https://aws.amazon.com/cli/",
    essential: true,
  },
  {
    id: "kubectl",
    name: "kubectl",
    group: "cloud",
    capabilities: ["Inspect pods / logs", "Port-forward to services", "Apply manifests"],
    checks: [{ kind: "cli", bin: "kubectl", args: ["version", "--client"] }],
    wingetId: "Kubernetes.kubectl",
    downloadUrl: "https://kubernetes.io/docs/tasks/tools/",
  },
  {
    id: "helm",
    name: "Helm",
    group: "cloud",
    capabilities: ["Chart-based deploys", "Values per environment", "Release rollback"],
    checks: [{ kind: "cli", bin: "helm", args: ["version", "--short"] }],
    wingetId: "Helm.Helm",
    downloadUrl: "https://helm.sh/docs/intro/install/",
  },
  {
    id: "terraform",
    name: "Terraform",
    group: "cloud",
    capabilities: ["Declarative Azure/AWS infra", "Plan / apply review", "State-tracked changes"],
    checks: [{ kind: "cli", bin: "terraform", args: ["--version"] }],
    wingetId: "Hashicorp.Terraform",
    downloadUrl: "https://developer.hashicorp.com/terraform/downloads",
  },

  // ── API & Testing ─────────────────────────────────────────────────────────
  {
    id: "postman",
    name: "Postman",
    group: "api",
    capabilities: ["REST / WebSocket collections", "Environment variables", "Share API tests with the team"],
    checks: [{ kind: "registry", match: "postman" }],
    wingetId: "Postman.Postman",
    downloadUrl: "https://www.postman.com/downloads/",
    essential: true,
  },
  {
    id: "curl",
    name: "curl",
    group: "api",
    capabilities: ["One-shot HTTP calls", "Reproducible repro commands", "Header / TLS debugging"],
    checks: [{ kind: "cli", bin: "curl", args: ["--version"] }],
    wingetId: "curl.curl",
    downloadUrl: "https://curl.se/windows/",
  },
  {
    id: "wireshark",
    name: "Wireshark",
    group: "api",
    capabilities: ["Packet capture for feed drops", "TLS handshake analysis", "WebSocket frame inspection"],
    checks: [{ kind: "registry", match: "wireshark" }],
    wingetId: "WiresharkFoundation.Wireshark",
    downloadUrl: "https://www.wireshark.org/download.html",
  },

  // ── AI & Assistants ───────────────────────────────────────────────────────
  {
    id: "claude-code",
    name: "Claude Code CLI",
    group: "ai",
    capabilities: ["Agentic coding in the terminal", "Repo-wide refactors", "Runs your build / tests"],
    checks: [{ kind: "cli", bin: "claude", args: ["--version"] }],
    manualCmd: "npm install -g @anthropic-ai/claude-code",
    downloadUrl: "https://docs.claude.com/en/docs/claude-code",
    essential: true,
  },
  {
    id: "ollama",
    name: "Ollama",
    group: "ai",
    capabilities: ["Local inference for DeepSeek / Qwen / Phi-3", "OpenAI-compatible endpoint", "Offline RAG backends"],
    checks: [{ kind: "cli", bin: "ollama", args: ["--version"] }, { kind: "registry", match: "ollama" }],
    wingetId: "Ollama.Ollama",
    downloadUrl: "https://ollama.com/download",
    essential: true,
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    group: "ai",
    capabilities: ["Inline completions in VS / VS Code", "Chat over the open file"],
    // Matching bare "copilot" would hit the Windows Copilot app, so require the full name.
    checks: [{ kind: "registry", match: "github copilot" }],
    downloadUrl: "https://github.com/features/copilot",
    note: "Usually installed as an IDE extension, which is not in the registry — verify with: code --list-extensions",
  },

  // ── Source Control ────────────────────────────────────────────────────────
  {
    id: "git",
    name: "Git",
    group: "vcs",
    capabilities: ["Branch / merge / rebase", "Works with GitLab + Azure Repos", "Bisect production regressions"],
    checks: [{ kind: "cli", bin: "git", args: ["--version"] }],
    wingetId: "Git.Git",
    downloadUrl: "https://git-scm.com/download/win",
    essential: true,
  },
  {
    id: "gh",
    name: "GitHub CLI",
    group: "vcs",
    capabilities: ["PRs from the terminal", "Trigger / watch Actions runs", "Release management"],
    checks: [{ kind: "cli", bin: "gh", args: ["--version"] }],
    wingetId: "GitHub.cli",
    downloadUrl: "https://cli.github.com",
  },
  {
    id: "winmerge",
    name: "WinMerge",
    group: "vcs",
    capabilities: ["3-way merge conflicts", "Folder diff between deploys"],
    checks: [{ kind: "registry", match: "winmerge" }],
    wingetId: "WinMerge.WinMerge",
    downloadUrl: "https://winmerge.org",
  },

  // ── CLI Utilities ─────────────────────────────────────────────────────────
  {
    id: "winget",
    name: "winget",
    group: "cli",
    capabilities: ["One-click installs used by this screen", "Upgrade all packages"],
    checks: [{ kind: "cli", bin: "winget", args: ["--version"] }],
    downloadUrl: "https://learn.microsoft.com/windows/package-manager/winget/",
    essential: true,
  },
  {
    id: "jq",
    name: "jq",
    group: "cli",
    capabilities: ["Filter API / log JSON", "Reshape payloads in pipelines"],
    checks: [{ kind: "cli", bin: "jq", args: ["--version"] }],
    wingetId: "jqlang.jq",
    downloadUrl: "https://jqlang.github.io/jq/",
  },
  {
    id: "7zip",
    name: "7-Zip",
    group: "cli",
    capabilities: ["Unpack vendor archives", "Compress log bundles"],
    checks: [{ kind: "registry", match: "7-zip" }],
    wingetId: "7zip.7zip",
    downloadUrl: "https://www.7-zip.org",
  },
  {
    id: "cmake",
    name: "CMake",
    group: "cli",
    capabilities: ["Build native deps of Rust / Python packages"],
    checks: [{ kind: "cli", bin: "cmake", args: ["--version"] }],
    wingetId: "Kitware.CMake",
    downloadUrl: "https://cmake.org/download/",
  },
  {
    id: "process-explorer",
    name: "Process Explorer",
    group: "cli",
    capabilities: ["Find the process holding a port / file", "Handle + DLL inspection"],
    // procexp has no version flag — running it would open the GUI, so detect by install only.
    checks: [
      { kind: "path", path: "%LOCALAPPDATA%\\Microsoft\\WindowsApps\\procexp.exe" },
      { kind: "registry", match: "process explorer" },
    ],
    wingetId: "Microsoft.Sysinternals.ProcessExplorer",
    downloadUrl: "https://learn.microsoft.com/sysinternals/downloads/process-explorer",
  },
];

// ── Probe wire types (must mirror src-tauri/src/commands/toolchain.rs) ───────

export interface ProbeSpec {
  id: string;
  checks: Check[];
}

export interface ProbeResult {
  id: string;
  installed: boolean;
  /** Raw first line of version output, or the registry DisplayVersion. */
  version: string;
  /** "cli" | "registry" | "path" — how it was found. */
  source: string;
  /** Extra context: the command / DisplayName / path that matched. */
  detail: string;
}

/** Native probe payload for a set of tools. */
export function probeSpecs(tools: ToolDef[] = TOOL_CATALOG): ProbeSpec[] {
  return tools.map((t) => ({ id: t.id, checks: t.checks }));
}

/**
 * Pull a human-friendly version out of raw command output.
 * `git version 2.52.0.windows.1` → `2.52.0.windows.1`, `v25.8.1` → `25.8.1`.
 */
export function cleanVersion(raw: string): string {
  const text = (raw || "").replace(/\r/g, "").split("\n")[0].trim();
  if (!text) return "";
  const m = text.match(/\d+(?:\.\d+)+(?:[.-][0-9A-Za-z]+)*/);
  if (m) return m[0];
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

export type StatusFilter = "all" | "installed" | "missing";

export interface ToolRow extends ToolDef {
  installed: boolean;
  version: string;
  source: string;
  detail: string;
  /** True when the tool can be installed by this screen without a browser. */
  installable: boolean;
}

/** Merge catalog + probe results into rows for the UI. */
export function buildRows(tools: ToolDef[], results: ProbeResult[]): ToolRow[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return tools.map((t) => {
    const r = byId.get(t.id);
    return {
      ...t,
      installed: r?.installed ?? false,
      version: cleanVersion(r?.version ?? ""),
      source: r?.source ?? "",
      detail: r?.detail ?? "",
      installable: Boolean(t.wingetId),
    };
  });
}

/** Search + group + status filtering, all case-insensitive. */
export function filterRows(
  rows: ToolRow[],
  opts: { query?: string; group?: ToolGroup | "all"; status?: StatusFilter } = {},
): ToolRow[] {
  const q = (opts.query || "").trim().toLowerCase();
  const group = opts.group ?? "all";
  const status = opts.status ?? "all";
  return rows.filter((r) => {
    if (group !== "all" && r.group !== group) return false;
    if (status === "installed" && !r.installed) return false;
    if (status === "missing" && r.installed) return false;
    if (!q) return true;
    const hay = `${r.name} ${r.id} ${r.capabilities.join(" ")} ${GROUP_LABELS[r.group]}`.toLowerCase();
    return hay.includes(q);
  });
}

export interface ToolchainSummary {
  total: number;
  installed: number;
  missing: number;
  essentialTotal: number;
  essentialInstalled: number;
  /** Missing tools that can be installed with one click. */
  installableMissing: number;
}

export function summarize(rows: ToolRow[]): ToolchainSummary {
  const installed = rows.filter((r) => r.installed);
  const essential = rows.filter((r) => r.essential);
  return {
    total: rows.length,
    installed: installed.length,
    missing: rows.length - installed.length,
    essentialTotal: essential.length,
    essentialInstalled: essential.filter((r) => r.installed).length,
    installableMissing: rows.filter((r) => !r.installed && r.installable).length,
  };
}

/** Rows bucketed by group, in display order, empty groups dropped. */
export function byGroup(rows: ToolRow[]): { group: ToolGroup; label: string; rows: ToolRow[] }[] {
  return GROUP_ORDER.map((g) => ({
    group: g,
    label: GROUP_LABELS[g],
    rows: rows.filter((r) => r.group === g),
  })).filter((b) => b.rows.length > 0);
}

/** winget ids are constrained — mirror the native validation so the UI can pre-check. */
export function isValidWingetId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(id) && id.length <= 128;
}

/** The exact command the native side will run — shown to the user before they confirm. */
export function installCommand(wingetId: string): string {
  return `winget install --id ${wingetId} --exact --source winget --accept-package-agreements --accept-source-agreements`;
}
