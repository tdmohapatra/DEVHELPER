/**
 * Troubleshooting content for every tool.
 *
 * Each entry earned its place by being a real dead end: an error whose message does not
 * name its own cause. Keep them specific — a tip that says "check your settings" is worse
 * than no tip, because it costs the reader time without narrowing anything.
 */

import type { Tip } from "./tips";

// ---- SQL Server ------------------------------------------------------------

const MSSQL: Tip[] = [
  {
    id: "mssql-tcp-disabled",
    domain: "mssql",
    title: "TCP/IP is disabled on the instance",
    cause:
      "SQL Server accepts Shared Memory connections from the same machine, which is how SSMS connects, but every TCP driver (this app, JDBC, Go, Python) is refused with 'connection refused'. A running service listening only on loopback port 1434 is the Dedicated Admin Connection, not a usable endpoint.",
    steps: [
      "Open SQL Server Configuration Manager → SQL Server Network Configuration → Protocols for <instance>.",
      "Set TCP/IP to Enabled.",
      "In TCP/IP → Properties → IP Addresses → IPAll, set TCP Port to 1433.",
      "Restart the SQL Server service, then test again.",
    ],
    command: `$tcp = "HKLM:\\SOFTWARE\\Microsoft\\Microsoft SQL Server\\<MSSQLnn.INSTANCE>\\MSSQLServer\\SuperSocketNetLib\\Tcp"
Set-ItemProperty $tcp -Name Enabled -Value 1
Set-ItemProperty "$tcp\\IPAll" -Name TcpPort -Value "1433"
Restart-Service MSSQLSERVER -Force`,
    warning:
      "Run in an Administrator PowerShell (Win+X → Terminal (Admin)); without elevation you get 'Cannot open service'. Restarting the service drops every open connection.",
    matches: ["10061", "actively refused", "connection refused"],
  },
  {
    id: "mssql-named-instance-port",
    domain: "mssql",
    title: "A named instance uses a dynamic port",
    cause:
      "SQLEXPRESS and other named instances pick a port at startup, so a fixed 1433 never reaches them. The SQL Browser service publishes the real port over UDP 1434.",
    steps: [
      "Write the instance into Host as HOST\\SQLEXPRESS and leave Port empty — the port is resolved at connect time.",
      "Or click 'Find instances' to list them with their current ports.",
      "If discovery fails, start the SQL Server Browser service so the lookup can answer.",
    ],
    command: "Start-Service SQLBrowser\nSet-Service SQLBrowser -StartupType Automatic",
    warning: "Run in an Administrator PowerShell (Win+X → Terminal (Admin)).",
    matches: ["sql browser", "was not found on"],
  },
  {
    id: "mssql-service-stopped",
    domain: "mssql",
    title: "The SQL Server service is not running",
    cause: "Nothing is listening because the engine itself is stopped — common after a reboot when startup is set to Manual.",
    steps: ["Check the service state.", "Start it, and set it to start automatically if this keeps happening."],
    command: "Get-Service MSSQL* | Select-Object Name, Status\nStart-Service MSSQLSERVER",
    warning: "Run in an Administrator PowerShell (Win+X → Terminal (Admin)).",
    matches: ["10061", "actively refused"],
  },
  {
    id: "mssql-login-failed",
    domain: "mssql",
    title: "The login was rejected",
    cause:
      "A SQL login only works when the server runs in mixed mode (SQL Server and Windows Authentication). With Windows-only authentication, a SQL user always fails regardless of the password.",
    steps: [
      "For a domain or local account, tick 'Windows authentication' instead of entering a user.",
      "For a SQL login, switch the server to mixed mode: SSMS → Server Properties → Security → SQL Server and Windows Authentication mode, then restart the service.",
      "Check the login is enabled and not locked out.",
    ],
    matches: ["login failed", "18456"],
  },
  {
    id: "mssql-database-access",
    domain: "mssql",
    title: "The database cannot be opened",
    cause: "The login succeeded, so the network path is fine — the database name is wrong, or the login has no rights on it.",
    steps: [
      "Connect to master first to prove the credentials work.",
      "List what the login can see: SELECT name FROM sys.databases.",
      "Grant access, or correct the database name in the connection.",
    ],
    matches: ["cannot open database", "4060"],
  },
  {
    id: "mssql-certificate",
    domain: "mssql",
    title: "The server certificate is not trusted",
    cause: "Encryption is on and the server presents a self-signed certificate, which the driver refuses by default.",
    steps: [
      "For local development, tick 'Trust server certificate' on the connection.",
      "For production, install a certificate the client chain trusts rather than disabling the check.",
    ],
    matches: ["certificate"],
  },
];

// ---- PostgreSQL ------------------------------------------------------------

const POSTGRES: Tip[] = [
  {
    id: "pg-auth-failed",
    domain: "postgres",
    title: "Password authentication failed (28P01)",
    cause:
      "The server was reached and the role exists, but the password did not match. On Windows installers the postgres superuser password is set during setup and is not recoverable — it can only be reset.",
    steps: [
      "Re-enter the password; it is session-only here and never stored.",
      "Verify the role from a working session: SELECT rolname FROM pg_roles.",
      "If the password is lost, set pg_hba.conf to 'trust' temporarily, reload, then ALTER USER postgres PASSWORD '…' and put the original method back.",
    ],
    command: 'psql -U postgres -h <host> -p <port> -c "SELECT current_user, version()"',
    matches: ["28p01", "password authentication failed"],
  },
  {
    id: "pg-role-missing",
    domain: "postgres",
    title: "The role does not exist (28000)",
    cause:
      "The user name in the connection has no matching role. 'postgres' is the conventional superuser, but Homebrew and some container images create a role named after the OS user instead.",
    steps: ["List the roles that exist on the server.", "Use one of them, or create the role you expected."],
    command: 'psql -h <host> -p <port> -c "\\du"',
    matches: ["28000", "role", "does not exist"],
  },
  {
    id: "pg-database-missing",
    domain: "postgres",
    title: "The database does not exist (3D000)",
    cause: "Authentication succeeded, so host, port and credentials are all correct — only the database name is wrong.",
    steps: ["Connect to the 'postgres' maintenance database first.", "List the databases and use the right name."],
    command: 'psql -U postgres -h <host> -p <port> -l',
    matches: ["3d000", "database", "does not exist"],
  },
  {
    id: "pg-hba",
    domain: "postgres",
    title: "No pg_hba.conf entry for this client (28000)",
    cause:
      "The server refuses the connection before authentication because no rule in pg_hba.conf covers this combination of host, user and database. Default installs only allow local connections.",
    steps: [
      "Open pg_hba.conf (SHOW hba_file; from a local session prints its path).",
      "Add a line for your client network, e.g. host all all 127.0.0.1/32 scram-sha-256.",
      "Reload the server — a restart is not needed.",
    ],
    command: 'psql -U postgres -c "SELECT pg_reload_conf()"',
    warning: "Widening pg_hba.conf grants network access. Use the narrowest CIDR that works.",
    matches: ["pg_hba", "no encryption", "no pg_hba.conf entry"],
  },
  {
    id: "pg-listen-addresses",
    domain: "postgres",
    title: "The server only listens on localhost",
    cause:
      "listen_addresses defaults to 'localhost', so remote clients are refused at the TCP layer even though the service is healthy.",
    steps: [
      "Set listen_addresses = '*' in postgresql.conf (or the specific interface).",
      "Restart the server — this setting is not reloadable.",
      "Open the port in the firewall as well.",
    ],
    command: 'psql -U postgres -c "SHOW listen_addresses"',
    matches: ["connection refused", "econnrefused", "10061"],
  },
  {
    id: "pg-ssl-required",
    domain: "postgres",
    title: "The server requires SSL",
    cause: "This client connects without TLS. A server configured with hostssl rules rejects the plaintext attempt.",
    steps: [
      "Connect to a server that allows non-SSL for local development, or",
      "Add a 'host' (non-ssl) rule in pg_hba.conf for your development network.",
    ],
    matches: ["ssl", "sslmode"],
  },
];

// ---- MySQL / MariaDB -------------------------------------------------------

const MYSQL: Tip[] = [
  {
    id: "mysql-access-denied",
    domain: "mysql",
    title: "Access denied for this user (1045)",
    cause:
      "MySQL grants are per user AND host: 'root'@'localhost' and 'root'@'%' are different accounts. Connecting over TCP to 127.0.0.1 does not match a localhost-only grant on some configurations.",
    steps: [
      "Confirm which accounts exist: SELECT user, host FROM mysql.user.",
      "Use an account granted for the host you are connecting from, or create one.",
      "Check the password — MySQL 8 defaults to caching_sha2_password, which older clients cannot negotiate.",
    ],
    command: 'mysql -h <host> -P <port> -u root -p -e "SELECT user, host FROM mysql.user"',
    matches: ["1045", "access denied"],
  },
  {
    id: "mysql-unknown-database",
    domain: "mysql",
    title: "Unknown database (1049)",
    cause: "The credentials worked, so only the schema name is wrong or the user cannot see it.",
    steps: ["List the schemas the user can see: SHOW DATABASES.", "Correct the database name in the connection."],
    matches: ["1049", "unknown database"],
  },
  {
    id: "mysql-auth-plugin",
    domain: "mysql",
    title: "Authentication plugin not supported",
    cause:
      "MySQL 8 stores passwords with caching_sha2_password by default. A client that only speaks mysql_native_password cannot authenticate even with the right credentials.",
    steps: [
      "Either upgrade the client, or",
      "Change the account to the older plugin: ALTER USER 'user'@'host' IDENTIFIED WITH mysql_native_password BY '…'.",
    ],
    warning: "mysql_native_password is weaker. Prefer a client that supports caching_sha2_password.",
    matches: ["caching_sha2", "authentication plugin", "auth_plugin"],
  },
  {
    id: "mysql-bind-address",
    domain: "mysql",
    title: "The server only listens on localhost",
    cause: "bind-address defaults to 127.0.0.1 in most packages, so remote connections are refused at the TCP layer.",
    steps: ["Set bind-address = 0.0.0.0 in my.cnf / my.ini.", "Restart the service.", "Open the port in the firewall."],
    matches: ["connection refused", "econnrefused", "10061", "can't connect to mysql server"],
  },
];

// ---- SQLite ----------------------------------------------------------------

const SQLITE: Tip[] = [
  {
    id: "sqlite-locked",
    domain: "sqlite",
    title: "The database file is locked",
    cause:
      "SQLite allows one writer at a time. Another process — often a running application or an open DB browser — holds the write lock.",
    steps: [
      "Close other tools that have the file open.",
      "For an app that keeps it open, enable WAL mode so readers and one writer can coexist: PRAGMA journal_mode=WAL.",
    ],
    matches: ["database is locked", "database table is locked"],
  },
  {
    id: "sqlite-readonly",
    domain: "sqlite",
    title: "The database is read-only",
    cause:
      "SQLite needs write access to the directory as well as the file, because it creates journal and WAL files beside it.",
    steps: [
      "Check the file is not marked read-only and that the folder is writable.",
      "Avoid paths under Program Files or a synced folder that locks files.",
    ],
    matches: ["attempt to write a readonly database", "readonly database", "unable to open database file"],
  },
  {
    id: "sqlite-not-a-database",
    domain: "sqlite",
    title: "The file is not a database",
    cause: "The path points at something that is not SQLite — an encrypted file, a truncated copy, or the wrong file entirely.",
    steps: ["Confirm the path.", "A valid SQLite file begins with the text 'SQLite format 3'."],
    matches: ["file is not a database", "not a database"],
  },
];

// ---- Oracle ----------------------------------------------------------------

const ORACLE: Tip[] = [
  {
    id: "oracle-instant-client",
    domain: "oracle",
    title: "Oracle support is not compiled into this build",
    cause:
      "The oracle crate links ODPI-C, which requires Oracle Instant Client at build and run time. It is therefore feature-gated so the default build stays green on machines without it.",
    steps: [
      "Install Oracle Instant Client and put it on PATH.",
      "Rebuild with the feature enabled: cargo build --features oracle.",
    ],
    command: "cargo build --features oracle",
    matches: ["oracle", "not supported in this build", "instant client"],
  },
  {
    id: "oracle-listener",
    domain: "oracle",
    title: "The listener refused the service name (ORA-12514)",
    cause: "The listener is reachable but does not know the service you asked for — usually a PDB name versus the CDB.",
    steps: ["List what the listener serves: lsnrctl services.", "Use a service name from that list, e.g. XEPDB1."],
    command: "lsnrctl services",
    matches: ["ora-12514", "ora-12541", "listener"],
  },
];

// ---- Redis -----------------------------------------------------------------

const REDIS: Tip[] = [
  {
    id: "redis-noauth",
    domain: "redis",
    title: "Authentication is required (NOAUTH)",
    cause: "The server has requirepass set, so every command is rejected until AUTH succeeds.",
    steps: ["Supply the password on the connection.", "For Redis 6+ with ACLs, supply the user name as well."],
    matches: ["noauth", "authentication required"],
  },
  {
    id: "redis-protected-mode",
    domain: "redis",
    title: "Protected mode is blocking the connection (DENIED)",
    cause:
      "Redis refuses non-loopback clients when it is bound to all interfaces without a password. This is a safety default, not a bug.",
    steps: [
      "Set a password (requirepass) — the correct fix.",
      "Or bind Redis to the specific interface you connect from.",
      "Disabling protected-mode without a password exposes the server to the network.",
    ],
    warning: "Never disable protected mode on a reachable network without setting a password.",
    matches: ["denied", "protected mode"],
  },
  {
    id: "redis-wrong-type",
    domain: "redis",
    title: "Wrong type for this key (WRONGTYPE)",
    cause: "The command does not match the key's type — for example GET on a hash, or LPUSH on a string.",
    steps: ["Check the type first: TYPE <key>.", "Use the command family that matches it."],
    matches: ["wrongtype"],
  },
];

// ---- Docker ----------------------------------------------------------------

const DOCKER: Tip[] = [
  {
    id: "docker-daemon",
    domain: "docker",
    title: "The Docker daemon is not reachable",
    cause:
      "The CLI talks to a daemon over a named pipe on Windows. If Docker Desktop is not running, or the current user is not in the docker-users group, every command fails at the connection step.",
    steps: [
      "Start Docker Desktop and wait for the whale icon to settle.",
      "Confirm the CLI can reach it.",
      "If it still fails, add your account to the docker-users local group and sign out and in.",
    ],
    command: "docker version\ndocker context ls",
    matches: [
      "cannot connect to the docker daemon",
      "docker daemon",
      "pipe/docker_engine",
      "is the docker daemon running",
    ],
  },
  {
    id: "docker-port-in-use",
    domain: "docker",
    title: "The published port is already in use",
    cause: "Another process — often a previous container or a locally installed service — already owns that port.",
    steps: ["Find the owner of the port.", "Stop it, or publish the container on a different host port."],
    command: "Get-NetTCPConnection -State Listen -LocalPort <port> | Select-Object OwningProcess",
    matches: ["port is already allocated", "address already in use", "bind: address"],
  },
];

// ---- HTTP / API ------------------------------------------------------------

const HTTP: Tip[] = [
  {
    id: "http-cors",
    domain: "http",
    title: "The request was blocked by CORS",
    cause:
      "A browser-context request is subject to CORS. The desktop app sends requests through the native HTTP layer precisely to avoid this, so seeing it means the request went through the webview instead.",
    steps: ["Use the API Tester in the desktop app rather than browser dev mode.", "Or add the origin to the server's allow-list."],
    matches: ["cors", "access-control-allow-origin", "preflight"],
  },
  {
    id: "http-tls",
    domain: "http",
    title: "The TLS certificate was rejected",
    cause: "A self-signed or expired certificate, or a chain the machine's trust store does not know.",
    steps: [
      "For an internal service, install its CA into the Windows certificate store.",
      "Check the certificate has not expired and that the host name matches.",
    ],
    command: "Test-NetConnection <host> -Port 443",
    matches: ["certificate", "tls", "ssl handshake", "self signed"],
  },
  {
    id: "http-refused",
    domain: "http",
    title: "The connection was refused",
    cause: "Nothing is listening on that host and port — the service is down, or the port is wrong.",
    steps: ["Check the port is open.", "Confirm the scheme and port match (https on 443, http on 80)."],
    command: "Test-NetConnection <host> -Port <port>",
    matches: ["econnrefused", "connection refused", "10061"],
  },
];

// ---- App -------------------------------------------------------------------

const APP: Tip[] = [
  {
    id: "app-native-unavailable",
    domain: "app",
    title: "This feature needs the desktop app",
    cause:
      "Native commands exist only inside the Tauri shell. Running the frontend with `npm run dev` in a browser leaves them undefined.",
    steps: ["Start the desktop shell instead: npm run tauri:dev.", "The packaged app has the same capability."],
    command: "npm run tauri:dev",
    matches: ["only available in the devhelper desktop app", "nativeunavailable"],
  },
  {
    id: "app-command-not-found",
    domain: "app",
    title: "The native command does not exist in this build",
    cause:
      "The running binary predates the command being called — typical after pulling changes without restarting the dev shell.",
    steps: ["Stop the running app and start it again so the Rust side is rebuilt."],
    command: "npm run tauri:dev",
    matches: ["not found", "unknown command", "command not allowed"],
  },
];

export const ALL_TIPS: Tip[] = [
  ...MSSQL,
  ...POSTGRES,
  ...MYSQL,
  ...SQLITE,
  ...ORACLE,
  ...REDIS,
  ...DOCKER,
  ...HTTP,
  ...APP,
];
