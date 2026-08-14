/**
 * Docker and Kubernetes cards.
 *
 * Aimed at the level these are actually tested at: you will be asked to reason
 * about an image and about why a pod is restarting, not to write a Dockerfile
 * from memory. So the cards spend their space on the mental model and on the
 * failures — the ones that cost an afternoon the first time you meet them.
 */

import type { Question } from "./types";

export const DEVOPS_QUESTIONS: Question[] = [
  {
    id: "do-image-layers",
    topic: "devops",
    subtopic: "Docker",
    level: "basic",
    mustKnow: true,
    question: "What is an image layer, and why does instruction order decide your build time?",
    answer:
      "An image is a stack of read-only **layers**, one per instruction. Each layer is cached and keyed by the instruction plus the content it brings in. A container adds one thin writable layer on top, which is why containers start instantly and why anything written inside them dies with them.\n\nThe rule that follows: **order instructions from least to most frequently changed.** Once a layer's cache is invalidated, every layer after it is rebuilt too.\n\nThat is why every good Dockerfile copies the project or lock file, restores dependencies, and only *then* copies the source. Source changes every commit; dependencies change monthly. Copy the source first and you re-download every package on every build.\n\nTwo consequences people miss:\n\n- **A deleted file is still in the image.** Removing a secret in a later layer leaves it readable in the earlier one. Never let it in.\n- **Layers are shared between images**, so a common base is downloaded once per host.",
    language: "dockerfile",
    code:
      "# Dependencies first — they change monthly\nCOPY [\"Lab.Api/Lab.Api.csproj\", \"Lab.Api/\"]\nRUN dotnet restore \"Lab.Api/Lab.Api.csproj\"\n\n# Source last — it changes every commit\nCOPY . .\nRUN dotnet publish \"Lab.Api/Lab.Api.csproj\" -c Release -o /app/publish",
    followUps: [
      { question: "How do you check what is in a layer?", answer: "`docker history <image>` shows each layer with its size and the instruction that made it. It is usually enough to find the one that added 400 MB." },
    ],
    tags: ["docker", "layers", "cache", "dockerfile", "build"],
    relatedTools: ["docker"],
  },
  {
    id: "do-multistage",
    topic: "devops",
    subtopic: "Docker",
    level: "intermediate",
    mustKnow: true,
    question: "What does a multi-stage build achieve?",
    answer:
      "It separates **building** from **running**, so the shipped image contains the compiled output and nothing else — no SDK, no compiler, no source, no build-time secret.\n\nThe difference is not cosmetic. A .NET SDK image is over a gigabyte; the ASP.NET runtime image is a couple of hundred megabytes, and `runtime-deps` with a self-contained trimmed build is far less. That is pull time on every node, storage in every registry, and — the part that matters most — attack surface. A compiler in a production image is a tool for whoever gets in.\n\nThe pattern: one stage with the SDK that restores, builds and publishes; a final stage on the runtime image that copies only the publish output.\n\nWhile you are there: run as a **non-root user**, because the default is root and a container escape is much worse from root.",
    language: "dockerfile",
    code:
      "FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build\nWORKDIR /src\nCOPY [\"Lab.Api/Lab.Api.csproj\", \"Lab.Api/\"]\nRUN dotnet restore \"Lab.Api/Lab.Api.csproj\"\nCOPY . .\nRUN dotnet publish \"Lab.Api/Lab.Api.csproj\" -c Release -o /app/publish /p:UseAppHost=false\n\nFROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final\nWORKDIR /app\nCOPY --from=build /app/publish .\nUSER $APP_UID                      # non-root; the image already defines it\nEXPOSE 8080\nENTRYPOINT [\"dotnet\", \"Lab.Api.dll\"]",
    followUps: [
      { question: "Why not use a build-time ARG for a secret?", answer: "Because ARG values are visible in the image history. Use BuildKit secret mounts (`--mount=type=secret`), which are never written to a layer." },
      { question: "Alpine or Debian base?", answer: "Debian-slim by default for .NET — Alpine uses musl, and some native dependencies and globalisation behaviour differ. Choose Alpine deliberately, not by habit." },
    ],
    tags: ["docker", "multi-stage", "image-size", "security", "dotnet"],
    relatedTools: ["docker"],
  },
  {
    id: "do-container-config",
    topic: "devops",
    subtopic: "Docker",
    level: "intermediate",
    question: "How should a containerised application be configured and observed?",
    answer:
      "- **Configuration by environment variable**, not by baked-in file. The same image must run in dev, test and production; if it cannot, it is not a deployable artefact. In .NET, `Logging__LogLevel__Default` maps straight onto the configuration tree.\n- **Secrets are mounted or injected**, never in the image and never in `docker history`.\n- **Log to stdout/stderr.** The platform collects them. A container writing to a log file inside itself is writing to a disk that disappears.\n- **One process per container.** If you need two, you need two containers — the platform's restart, health and scaling all assume one.\n- **Handle SIGTERM.** On stop you get SIGTERM, then SIGKILL after a grace period. Finish in-flight work and close connections in that window, or you drop requests on every deployment.\n- **A health endpoint** the platform can call, which checks what you cannot serve without — and not more.\n- **Resource limits**, so one container cannot starve the host. In .NET, the runtime reads the cgroup limit and sizes the GC heap accordingly, which is why setting a memory limit is a correctness matter, not only a courtesy.",
    language: "csharp",
    code:
      "// Graceful shutdown: the difference between a clean deployment and dropped requests\nbuilder.Services.AddHostedService<ResultIngestService>();\nbuilder.WebHost.ConfigureKestrel(o => o.AddServerHeader = false);\n\napp.Lifetime.ApplicationStopping.Register(() =>\n{\n    // Stop accepting, drain what is in flight. SIGKILL follows the grace period.\n    _logger.LogInformation(\"SIGTERM received, draining\");\n});\n\napp.MapHealthChecks(\"/health/live\");   // is the process alive?\napp.MapHealthChecks(\"/health/ready\");  // can it serve? checks DB and broker",
    followUps: [
      { question: "Why does .NET care about the memory limit?", answer: "The GC sizes its heap from the cgroup limit. Without one it assumes the whole host, grows accordingly, and gets OOM-killed at a limit it never knew about." },
    ],
    tags: ["docker", "configuration", "logging", "sigterm", "health"],
    relatedTools: ["docker"],
  },
  {
    id: "do-compose",
    topic: "devops",
    subtopic: "Docker",
    level: "basic",
    question: "What is Docker Compose good for, and where does it stop?",
    answer:
      "Compose describes a set of containers, their networks and their volumes in one file. Its real value is **a working local environment in one command** — the API, SQL Server, Redis and a broker, on a shared network where each is reachable by service name.\n\nWhat it gives you: service discovery by name, `depends_on` with health conditions so the API waits for the database to be *ready* rather than merely started, named volumes so data survives a restart, and per-environment overrides.\n\nWhere it stops: no scheduling across machines, no rolling deployment, no self-healing beyond restart policies, no horizontal scaling worth the name. It is a development and single-host tool. Reaching for Swarm is not the answer either; the step up is Container Apps or Kubernetes.\n\nOne practical warning: `depends_on` without `condition: service_healthy` waits only for the container to *start*, which for a database means your app connects before it can accept connections — and the failure looks intermittent.",
    language: "yaml",
    code:
      "services:\n  api:\n    build: .\n    environment:\n      ConnectionStrings__Lab: \"Server=sql;Database=Lab;User Id=sa;Password=${SA_PASSWORD};TrustServerCertificate=true\"\n    depends_on:\n      sql:\n        condition: service_healthy      # not just \"started\"\n    ports: [\"8080:8080\"]\n\n  sql:\n    image: mcr.microsoft.com/mssql/server:2022-latest\n    environment:\n      ACCEPT_EULA: \"Y\"\n      MSSQL_SA_PASSWORD: ${SA_PASSWORD}\n    healthcheck:\n      test: [\"CMD-SHELL\", \"/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P $$MSSQL_SA_PASSWORD -Q 'SELECT 1'\"]\n      interval: 10s\n      retries: 10\n    volumes: [\"labdata:/var/opt/mssql\"]\n\nvolumes:\n  labdata:",
    followUps: [
      { question: "Should Compose be used in production?", answer: "On a single on-premises box — a hospital device gateway, say — it is defensible and often right. For anything that must survive a host failure, it is not." },
    ],
    tags: ["docker-compose", "local-dev", "healthcheck", "volumes"],
    relatedTools: ["docker"],
  },
  {
    id: "do-k8s-objects",
    topic: "devops",
    subtopic: "Kubernetes",
    level: "intermediate",
    mustKnow: true,
    question: "Pod, Deployment, Service, Ingress — what does each do?",
    answer:
      "- **Pod** — one or more containers sharing a network namespace and storage. The unit of scheduling. Pods are cattle: they are created and destroyed, and their IPs change.\n- **ReplicaSet** — keeps N identical pods running. You rarely touch it directly.\n- **Deployment** — manages ReplicaSets to give you rolling updates and rollback. This is what you actually write for a stateless service.\n- **Service** — a stable virtual IP and DNS name in front of a changing set of pods, selected by label. Without it nothing can reliably address anything, because pod IPs move.\n- **Ingress** — HTTP routing from outside the cluster to Services, with hostnames, paths and TLS.\n- **StatefulSet** — for pods that need stable identity and storage (a database). Different from a Deployment in that pod-0 stays pod-0.\n- **Job / CronJob** — run to completion, once or on a schedule.\n- **ConfigMap / Secret** — configuration and credentials, mounted as files or environment variables. A Secret is base64, not encrypted, unless you enable encryption at rest.\n\nThe mental model: you declare the desired state, and controllers work continuously to make reality match. Nothing is imperative, which is why `kubectl apply` twice is harmless and why a manual change gets reverted.",
    diagram:
      "  Ingress (host/path, TLS)\n     │\n  Service (stable IP + DNS, selects by label)\n     │\n  Deployment ──▶ ReplicaSet ──▶ Pod  Pod  Pod\n                                 └ container(s)",
    followUps: [
      { question: "Why can a Service find pods at all?", answer: "Label selectors. The Service selects `app=lab-api`, and any pod with that label joins the endpoint list. A typo in a label is the classic 'service returns nothing' bug." },
    ],
    tags: ["kubernetes", "pods", "deployment", "service", "ingress"],
  },
  {
    id: "do-k8s-probes",
    topic: "devops",
    subtopic: "Kubernetes",
    level: "intermediate",
    mustKnow: true,
    question: "Liveness, readiness and startup probes — what is the difference, and what goes wrong?",
    answer:
      "- **Liveness** — \"is this process wedged?\" Failing it **restarts the container**.\n- **Readiness** — \"can this pod serve traffic right now?\" Failing it **removes the pod from the Service**, without restarting it.\n- **Startup** — \"has it finished booting?\" Suppresses the other two until it passes, which is how a slow-starting application avoids a restart loop.\n\nThe mistakes, in order of how often they happen:\n\n1. **Liveness checks a dependency.** The database has a blip, every pod fails liveness, the whole deployment restarts — and now nothing is warm and the database gets a thundering herd. **Liveness must check only the process itself.** Dependencies belong in readiness.\n2. **Readiness checks nothing**, so pods take traffic before they can serve it. Every deployment produces a burst of errors.\n3. **No startup probe** on a slow starter, so `initialDelaySeconds` is guessed, and a cold start on a busy node crosses it and restarts for ever.\n4. **The probe is expensive**, so the health endpoint itself becomes load — it runs on every pod, every few seconds, for ever.",
    language: "yaml",
    code:
      "livenessProbe:                  # process only — never the database\n  httpGet: { path: /health/live, port: 8080 }\n  periodSeconds: 10\n  failureThreshold: 3\n\nreadinessProbe:                 # dependencies belong here\n  httpGet: { path: /health/ready, port: 8080 }\n  periodSeconds: 5\n  failureThreshold: 2\n\nstartupProbe:                   # up to 60s to boot, then the others take over\n  httpGet: { path: /health/live, port: 8080 }\n  periodSeconds: 5\n  failureThreshold: 12",
    followUps: [
      { question: "How does this interact with a rolling update?", answer: "The rollout waits for new pods to be ready before removing old ones. If readiness is missing or always true, the rollout completes while nothing can serve — the deployment 'succeeds' and the service is down." },
    ],
    tags: ["kubernetes", "probes", "liveness", "readiness", "health"],
  },
  {
    id: "do-k8s-resources",
    topic: "devops",
    subtopic: "Kubernetes",
    level: "advanced",
    question: "What do requests and limits actually do, and why is a CPU limit often a mistake?",
    answer:
      "- **Requests** are what the scheduler reserves. They decide *where* a pod can be placed, and they are what you are effectively paying for.\n- **Limits** are the ceiling the runtime enforces.\n\nThe two behave completely differently:\n\n- **Memory over the limit → the container is OOM-killed.** Immediate, and it looks like a crash with no log.\n- **CPU over the limit → the container is throttled.** Not killed; just slowed, in 100 ms accounting periods. Latency spikes appear with no error anywhere and no obvious cause.\n\nThat is why a **CPU limit is often harmful**: a pod that could safely use spare capacity is throttled instead, and the symptom is p99 latency rather than a failure. The common guidance is to set CPU *requests* (so scheduling is sane) and leave CPU limits off, while always setting a **memory limit** — memory is not compressible, and without a limit one leak takes the whole node.\n\n**QoS class** follows from this: `Guaranteed` when requests equal limits, `Burstable` when they differ, `BestEffort` when neither is set. Under node pressure, BestEffort is evicted first — which is where an unconfigured workload goes to die.",
    followUps: [
      { question: "How do you find throttling?", answer: "`container_cpu_cfs_throttled_seconds_total`. If it is climbing while CPU usage sits below the limit, throttling is your latency." },
      { question: "What should .NET see?", answer: "The cgroup limit. The GC and ThreadPool size themselves from it, so a memory limit makes the runtime behave, and its absence makes it assume the whole node." },
    ],
    tags: ["kubernetes", "resources", "limits", "throttling", "qos"],
  },
  {
    id: "do-k8s-debug",
    topic: "devops",
    subtopic: "Kubernetes",
    level: "intermediate",
    mustKnow: true,
    question: "A pod is in CrashLoopBackOff. How do you diagnose it?",
    answer:
      "In this order, because each step rules out a class of cause:\n\n1. **`kubectl describe pod`** — the Events at the bottom are the answer more often than the logs. `ImagePullBackOff`, `FailedScheduling` (nothing has room), `CreateContainerConfigError` (a missing ConfigMap or Secret), `OOMKilled` in the last state.\n2. **`kubectl logs <pod> --previous`** — the *previous* container's logs. The current one may have died before writing anything; `--previous` is the flag people forget and it is where the exception is.\n3. **Check the exit code.** 0 means it finished and the platform restarted it — usually a Deployment running something that was meant to be a Job. 137 is SIGKILL, almost always OOM. 143 is SIGTERM.\n4. **`kubectl get events --sort-by=.lastTimestamp`** for the wider picture: node pressure, evictions, failed mounts.\n5. **Probe misconfiguration** — a liveness probe failing during a slow start restarts the container repeatedly, and the logs show a healthy application being killed mid-boot.\n6. **`kubectl exec` or an ephemeral debug container** to look from inside, if it stays up long enough.\n\nThe distinction that saves the most time: *did it fail to start, or did it start and then get killed?* Events answer the first, `--previous` logs and the exit code answer the second.",
    language: "bash",
    code:
      "kubectl describe pod lab-api-7d9f -n lab | tail -30      # Events first\nkubectl logs lab-api-7d9f -n lab --previous               # the crash that mattered\nkubectl get pod lab-api-7d9f -n lab -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}{\"\\n\"}'\nkubectl get events -n lab --sort-by=.lastTimestamp | tail -20",
    followUps: [
      { question: "What does OOMKilled really mean?", answer: "The container exceeded its memory limit. Either the limit is too low or something leaks — check the working set over time before raising it, or you will raise it again next month." },
    ],
    tags: ["kubernetes", "debugging", "crashloop", "oomkilled", "operations"],
    relatedTools: ["log-viewer"],
  },
  {
    id: "do-k8s-config",
    topic: "devops",
    subtopic: "Kubernetes",
    level: "intermediate",
    question: "How do configuration and secrets reach a pod, and what is wrong with Secrets?",
    answer:
      "**ConfigMap** and **Secret** are both key-value objects, consumed either as environment variables or as mounted files.\n\nThe practical differences:\n\n- **Environment variables are read once at start.** Changing the ConfigMap does not change a running pod; you must restart it. Deployments usually annotate the pod template with a hash of the config so a change rolls the pods automatically.\n- **Mounted files are updated in place** (eventually, within a sync period), so an application that re-reads the file picks up a change without a restart.\n\nWhat is wrong with Secrets: **they are base64, not encrypted.** Anyone who can read the object, or the etcd backup, has the value. Fixes, in increasing order of seriousness:\n\n1. Enable **encryption at rest** for secrets in etcd.\n2. Lock down RBAC — most people who can `get pods` should not be able to `get secrets`.\n3. Use an external store: **Key Vault via the Secrets Store CSI driver** or workload identity, so the credential is never a Kubernetes object at all. This is the right answer for anything protecting PHI.\n\nAnd never commit a Secret manifest. Sealed Secrets or SOPS exist precisely so the repository holds something useless without the key.",
    followUps: [
      { question: "How do you force a rollout when config changes?", answer: "Put a checksum of the ConfigMap in the pod template annotations. The template changes, so the Deployment rolls — which is the behaviour people expect and do not get by default." },
    ],
    tags: ["kubernetes", "configmap", "secrets", "csi", "security"],
  },
  {
    id: "do-k8s-scaling",
    topic: "devops",
    subtopic: "Kubernetes",
    level: "advanced",
    question: "How does autoscaling work, and why is CPU usually the wrong metric?",
    answer:
      "- **HPA** (Horizontal Pod Autoscaler) adds and removes pods based on a metric.\n- **VPA** adjusts requests and limits — useful for right-sizing, awkward with HPA on the same metric.\n- **Cluster Autoscaler** adds nodes when pods cannot be scheduled.\n- **KEDA** scales on *external* signals: queue length, Kafka lag, a cron schedule — and can scale to zero, which HPA on CPU cannot.\n\nWhy CPU is usually wrong: for an I/O-bound service — which most of these are — CPU stays low while every request waits on a database or a broker. The service is saturated, the CPU says 20%, and the HPA does nothing.\n\nBetter signals: **queue length or consumer lag** for a worker (this is the strongest one — it is the actual backlog), **requests in flight** or **p95 latency** for an API, or a business metric such as unfiled results.\n\nAnd know when scaling out will not help. If the bottleneck is a database connection pool, more pods make it worse: each new pod opens more connections to the same overloaded database.",
    followUps: [
      { question: "Why does scaling out sometimes make things slower?", answer: "Shared bottleneck. More consumers on a saturated database, a rate-limited API or a partition-count ceiling add contention without adding throughput." },
    ],
    tags: ["kubernetes", "hpa", "keda", "autoscaling", "metrics"],
  },
  {
    id: "do-k8s-networking",
    topic: "devops",
    subtopic: "Kubernetes",
    level: "intermediate",
    question: "How do services find each other in Kubernetes, and what is a NetworkPolicy for?",
    answer:
      "**Every pod gets an IP** and can reach every other pod by default — the whole cluster is one flat network. That default is the thing a NetworkPolicy exists to remove.\n\n**Discovery is DNS.** A Service called `lab-api` in namespace `lab` resolves as:\n\n- `lab-api` from inside the same namespace,\n- `lab-api.lab` from another namespace,\n- `lab-api.lab.svc.cluster.local` fully qualified.\n\nService types:\n\n- **ClusterIP** — internal only. The default, and correct for almost everything.\n- **NodePort** — a port on every node. Mostly a building block.\n- **LoadBalancer** — provisions a cloud load balancer. One per service gets expensive; Ingress in front of ClusterIP services is usually cheaper.\n- **Headless** (`clusterIP: None`) — DNS returns the pod IPs directly, for clients that do their own balancing or need stable per-pod addresses.\n\n**NetworkPolicy** restricts which pods may talk to which, by label. Two things surprise people: policies are *additive allow* rules with **deny-by-default once any policy selects a pod**, and they do nothing at all unless the CNI plugin implements them — a policy on a cluster without support is silently ignored, which is a dangerous way to be wrong about isolation.",
    language: "yaml",
    code:
      "# Only the API may reach the database, and only on 1433.\napiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata: { name: sql-ingress, namespace: lab }\nspec:\n  podSelector:\n    matchLabels: { app: sql }\n  policyTypes: [Ingress]\n  ingress:\n    - from:\n        - podSelector:\n            matchLabels: { app: lab-api }\n      ports:\n        - protocol: TCP\n          port: 1433",
    followUps: [
      { question: "Why does a Service sometimes return nothing?", answer: "Its selector matches no pods — usually a label typo, or pods that are running but not ready. `kubectl get endpoints <service>` shows an empty list and settles it immediately." },
    ],
    tags: ["kubernetes", "dns", "service", "networkpolicy", "networking"],
  },
  {
    id: "do-deploy-strategies",
    topic: "devops",
    subtopic: "Delivery",
    level: "intermediate",
    mustKnow: true,
    question: "Compare rolling, blue-green and canary deployments.",
    answer:
      "- **Rolling** — replace instances a few at a time. No extra infrastructure, but both versions run simultaneously, so the new one must be backwards-compatible with the old one's data and messages. This is the Kubernetes default.\n- **Blue-green** — run the new version alongside, switch all traffic at once, keep the old one warm. Instant rollback (switch back), at the cost of double the resources during the change. Azure App Service slot swaps are exactly this.\n- **Canary** — send a small percentage to the new version, watch the metrics, increase gradually. Catches problems that only appear under real traffic, and needs traffic splitting plus per-version metrics to be worth anything.\n\nAll three depend on the same discipline: **the new version must be compatible with the old version's data**, because for a while both are live. That means expand-migrate-contract for schemas and additive-only changes for event schemas.\n\nAnd separate **deploy** from **release**: ship the code dark behind a feature flag, then turn it on. Rollback becomes a flag flip rather than a redeployment, which is a much faster and much safer thing to do at 3 a.m.",
    diagram:
      "  rolling   [old][old][new] → [old][new][new] → [new][new][new]\n  blue-green  blue(100%) ──switch──▶ green(100%)     rollback = switch back\n  canary      old 95% / new 5% → 50/50 → 100%        watch metrics between steps",
    followUps: [
      { question: "What makes a rollback impossible?", answer: "A destructive migration. Once a column is dropped or a message format changes irreversibly, the old version cannot run. That is why contraction is a separate, later deployment." },
    ],
    tags: ["deployment", "blue-green", "canary", "feature-flags", "delivery"],
  },
  {
    id: "do-cicd",
    topic: "devops",
    subtopic: "Delivery",
    level: "intermediate",
    question: "What should a CI/CD pipeline do, in order?",
    answer:
      "**CI, on every push:**\n\n1. Restore and build with warnings as errors.\n2. Unit tests, fast, always.\n3. Integration tests against real dependencies in containers (Testcontainers), not mocks of them.\n4. Static analysis and dependency scanning for known vulnerabilities.\n5. Build the image **once**, tag it with the commit sha, push it.\n\n**CD, per environment:**\n\n6. Deploy **that same image** to dev, then test, then production. Rebuilding per environment means you never shipped what you tested.\n7. Run migrations as a separate, ordered step — expand before deploy, contract after.\n8. Smoke test after deployment, and roll back automatically if it fails.\n9. Approval gate before production, if the organisation requires one.\n\nThe principles worth stating: **build once, deploy many**; the pipeline is the only path to production; secrets come from a vault via a workload identity, never from pipeline variables typed by hand; and every artefact is traceable to a commit.\n\nFor a regulated environment add: an immutable record of who approved what, and evidence that the tests passed for the exact artefact deployed. That is usually the difference between a pipeline and an auditable pipeline.",
    followUps: [
      { question: "Why not rebuild per environment?", answer: "Because a rebuild can differ — a floating dependency, a different base image tag, a different build agent. Promoting one artefact is the only way to know production runs what test approved." },
      { question: "Where do migrations belong?", answer: "In their own step, run once, before the code that needs them — and additive, so the previous version still runs while the rollout completes." },
    ],
    tags: ["ci-cd", "pipeline", "artefacts", "migrations", "delivery"],
  },
  {
    id: "do-image-security",
    topic: "devops",
    subtopic: "Docker",
    level: "advanced",
    question: "How do you keep a container image secure?",
    answer:
      "- **Minimal base.** `aspnet` rather than `sdk`; `runtime-deps` with a self-contained build if you can; chiselled or distroless images where the tooling supports them. Fewer packages means fewer CVEs to answer for.\n- **Non-root.** `USER $APP_UID`. Root inside a container is closer to root outside it than people assume.\n- **Read-only root filesystem**, with a writable volume only where genuinely needed.\n- **Drop capabilities**, no privileged containers, and `allowPrivilegeEscalation: false`.\n- **Pin base images by digest**, not by a moving tag. `:8.0` changes underneath you; a digest does not.\n- **Scan on every build** (Trivy, Defender for Containers) and fail on high severity — then actually rebuild regularly, because a base image accrues CVEs while your code is unchanged.\n- **No secrets in the image**, ever. They persist in layers even when a later instruction deletes them.\n- **Sign and verify** images if the environment supports it, so only what your pipeline built can run.\n\nThe operational half matters as much: an image built six months ago and never rebuilt is a known-vulnerable image, whatever the scan said on the day it was made.",
    followUps: [
      { question: "How often should you rebuild an unchanged service?", answer: "On a schedule — weekly or monthly — precisely because nothing changed in your code while the base image accumulated fixes." },
    ],
    tags: ["docker", "security", "cve", "non-root", "scanning"],
    relatedTools: ["docker"],
  },
  {
    id: "do-onprem",
    topic: "devops",
    subtopic: "Delivery",
    level: "advanced",
    question: "What is different about deploying inside a hospital rather than to the cloud?",
    answer:
      "This is the deployment that actually applies to a device gateway, and almost none of the cloud assumptions hold:\n\n- **No inbound access.** Their firewall will not open a port for you. Everything is outbound-initiated: an agent that polls, or a persistent outbound connection.\n- **Updates are scheduled, not continuous.** A change window, a change request, and someone on site. Design for infrequent, atomic, reversible updates — not a pipeline that deploys ten times a day.\n- **The machine is not yours.** It may be a shared server, an old OS, and a domain policy you do not control.\n- **Offline operation is a requirement**, not a nice-to-have. The link to the cloud will drop, and results must keep flowing to the local LIS regardless.\n- **Observability has to work without your monitoring stack.** Local logs with rotation, a local health page, and a way for their IT staff to see status without your portal.\n- **Physical constraints are real.** Disk fills, and nobody is watching it. Cap and rotate everything, and alert locally.\n\nThe usual shape: a container (or a Windows service) on a small box, configured once, buffering to local disk, pushing outbound to the cloud when it can. Azure IoT Edge and Arc exist to manage exactly this, and they are worth using rather than inventing an updater.",
    followUps: [
      { question: "How do you update software you cannot reach?", answer: "The device pulls: it checks for a new version, downloads it, verifies a signature, and switches with a rollback path if the new version fails its own health check." },
    ],
    tags: ["on-premises", "edge", "iot-edge", "deployment", "healthcare"],
    relatedTools: ["device-link"],
  },
];
