import type { Question } from "./types";

/** Second batch: programming craft, DSA and system design. */
export const PROGRAMMING_EXTRA: Question[] = [
  {
    id: "prog2-deadlock-conditions",
    topic: "programming",
    subtopic: "Concurrency",
    level: "advanced",
    question: "What are the four conditions for deadlock, and how do you break them?",
    answer: `All four must hold simultaneously:

1. **Mutual exclusion** — a resource is held exclusively.
2. **Hold and wait** — a holder requests another resource.
3. **No preemption** — a resource cannot be taken away.
4. **Circular wait** — a cycle of waiting.

Break any one and deadlock is impossible. In practice you break **circular wait** by imposing a global lock order, and **hold and wait** by acquiring everything at once or using timeouts (\`Monitor.TryEnter\`, \`SemaphoreSlim.WaitAsync(timeout)\`).

The database version is the same problem: two transactions updating the same rows in different orders. The engine detects the cycle and kills a victim; the application retries.`,
    language: "csharp",
    code: `// Deadlock: thread A takes _a then _b, thread B takes _b then _a
lock (_a) { lock (_b) { } }
lock (_b) { lock (_a) { } }

// Fixed by a consistent order — here, by object identity
static void LockBoth(object x, object y, Action body)
{
    var (first, second) = RuntimeHelpers.GetHashCode(x) < RuntimeHelpers.GetHashCode(y) ? (x, y) : (y, x);
    lock (first) lock (second) body();
}`,
    tags: ["deadlock", "lock ordering", "concurrency", "timeout"],
  },
  {
    id: "prog2-tdd",
    topic: "programming",
    subtopic: "Testing",
    level: "intermediate",
    question: "Do you practise TDD, and what does it actually give you?",
    answer: `Red → green → refactor. Write the failing test, make it pass simply, then improve the design with the test as a safety net.

What it genuinely gives: testable design (you cannot write an untestable class if the test comes first), a definition of done, and the confidence to refactor. What it does not: correctness (your tests encode your assumptions) or speed on exploratory work.

An honest interview answer: "TDD for logic with clear rules — parsers, calculations, state machines. Test-after for UI and exploratory spikes. The design pressure is the real benefit; the tests are a side effect."`,
    tags: ["tdd", "testing", "design", "refactoring"],
  },
  {
    id: "prog2-api-versioning",
    topic: "programming",
    subtopic: "Web",
    level: "intermediate",
    question: "How do you version an API in practice?",
    answer: `Options, with the trade you should state:

- **URL path** (\`/v1/orders\`) — obvious, cacheable, easy to route. Purists dislike it; everyone uses it.
- **Header** (\`api-version: 2\`) — clean URLs, harder to test in a browser and easy for a client to forget.
- **Media type** (\`Accept: application/vnd.acme.v2+json\`) — most RESTful, least used.

More important than the mechanism: **avoid needing a new version.** Additive changes are safe; removing or repurposing a field is not. When you must break, run both versions, instrument usage of the old one, and retire it when usage reaches zero — not on a date you announced.`,
    language: "csharp",
    code: `builder.Services.AddApiVersioning(o =>
{
    o.DefaultApiVersion = new ApiVersion(1, 0);
    o.AssumeDefaultVersionWhenUnspecified = true;
    o.ReportApiVersions = true;                    // advertises supported versions in headers
    o.ApiVersionReader = ApiVersionReader.Combine(
        new UrlSegmentApiVersionReader(),
        new HeaderApiVersionReader("api-version"));
});`,
    tags: ["versioning", "api", "breaking change", "deprecation"],
  },
  {
    id: "prog2-feature-flags",
    topic: "programming",
    subtopic: "Craft",
    level: "intermediate",
    question: "How do you use feature flags well?",
    answer: `They decouple **deploy** from **release**: ship code dark, enable for a cohort, ramp up, and turn off instantly if metrics degrade — a kill switch faster than any rollback.

Discipline that keeps them from becoming debt:

- **Name and own each flag**, with a removal date. Flags that outlive their purpose multiply code paths exponentially.
- **Keep them shallow** — check at one boundary, not scattered through the domain.
- **Test both states**, at least for critical paths.
- **Distinguish kinds**: release toggles (short-lived), ops toggles (kill switches, long-lived), permission toggles (permanent, really entitlements).`,
    language: "csharp",
    code: `if (await _flags.IsEnabledAsync("new-pricing-engine", user))
    return await _newPricing.QuoteAsync(cart);

return await _legacyPricing.QuoteAsync(cart);
// Removal ticket created with the flag, not "later"`,
    tags: ["feature flags", "release", "kill switch", "technical debt"],
  },
  {
    id: "prog2-tech-debt",
    topic: "programming",
    subtopic: "Craft",
    level: "intermediate",
    question: "How do you argue for paying down technical debt?",
    answer: `In the language of the business, not of the codebase.

- **Quantify** — "this module causes 40% of our incidents", "deploys take 2 hours because of manual steps", "every change here takes three days instead of half a day".
- **Tie to an upcoming feature** — "the roadmap item needs this area; refactoring first makes it two weeks instead of six".
- **Propose increments**, not a rewrite. A six-month rewrite is a bet nobody sane approves; a boy-scout rule plus a fixed capacity allocation is.
- **Distinguish deliberate from accidental debt** — a conscious shortcut with a ticket is a decision; the rest is neglect.

Rewrites almost always lose: the old system encodes years of edge cases you cannot see.`,
    tags: ["technical debt", "refactoring", "communication", "rewrite"],
  },
  {
    id: "prog2-logging-levels",
    topic: "programming",
    subtopic: "Diagnostics",
    level: "basic",
    question: "What belongs at each log level?",
    answer: `- **Trace** — extremely detailed, off in production.
- **Debug** — developer diagnostics; enabled temporarily to investigate.
- **Information** — significant business events: order placed, payment captured. Should read like a story of what the system did.
- **Warning** — something unexpected but handled: a retry, a fallback, a deprecated path being used.
- **Error** — an operation failed and a user or process is affected. Someone should be able to act on it.
- **Critical** — the application cannot continue.

Two rules that matter more than the levels: log **structured fields**, not interpolated strings, and never log secrets, tokens, card numbers or full personal data. Redact at the logging boundary so it cannot leak by accident.`,
    tags: ["logging", "levels", "structured logging", "pii"],
  },
  {
    id: "prog2-encoding",
    topic: "programming",
    subtopic: "Fundamentals",
    level: "intermediate",
    question: "Explain character encoding problems and how to avoid them.",
    answer: `A string is characters; a file or socket carries **bytes**. Encoding is the mapping, and a mismatch is the source of "Ã©" and "�".

- **UTF-8** — variable width, ASCII-compatible, the default for the web and for .NET Core. Use it everywhere.
- **UTF-16** — what .NET \`string\` uses in memory; a \`char\` is a UTF-16 code unit, so an emoji is *two* chars.
- **BOM** — optional in UTF-8 and often harmful: it breaks naive parsers and shell scripts.

Practical rules: specify the encoding explicitly on every read/write, never assume the platform default, and use \`StringInfo\`/rune enumeration when counting or truncating user-visible characters.`,
    language: "csharp",
    code: `// "👍" is one grapheme, two chars, four UTF-8 bytes
var s = "👍";
Console.WriteLine(s.Length);                                   // 2  (UTF-16 code units)
Console.WriteLine(new StringInfo(s).LengthInTextElements);     // 1  (what a user sees)
Console.WriteLine(Encoding.UTF8.GetByteCount(s));              // 4

// Truncating by Length can split a surrogate pair and corrupt the text
await File.WriteAllTextAsync(path, s, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));`,
    tags: ["encoding", "utf-8", "unicode", "surrogate pair", "bom"],
  },
  {
    id: "prog2-rest-graphql-grpc",
    topic: "programming",
    subtopic: "Web",
    level: "intermediate",
    question: "REST, GraphQL or gRPC?",
    answer: `- **REST/JSON** — universal, cacheable, debuggable with a browser. The default for public and partner APIs.
- **GraphQL** — the client asks for exactly the fields it needs, which solves over- and under-fetching for varied clients. Costs: caching is harder, a malicious query can be expensive (depth/complexity limits required), and the server work is real.
- **gRPC** — HTTP/2, binary protobuf, generated clients, streaming, low latency. Excellent **between services**; awkward from browsers (needs gRPC-Web), harder to debug by hand.

Typical architecture: gRPC internally, REST at the edge, GraphQL only if several very different clients are fighting over the same endpoints.`,
    tags: ["rest", "graphql", "grpc", "protobuf", "api"],
  },
  {
    id: "prog2-docker",
    topic: "programming",
    subtopic: "Tooling",
    level: "intermediate",
    question: "What makes a good Dockerfile for a .NET service?",
    answer: `- **Multi-stage build** — SDK image to build, runtime image to ship. The final image should not contain the compiler or your source.
- **Layer order for caching** — copy \`.csproj\` and restore *before* copying the rest of the source, so a code change does not invalidate the restore layer.
- **Small base** — \`aspnet\` runtime, or \`alpine\`/\`chiseled\` for a much smaller surface.
- **Non-root user** — containers running as root are an unnecessary risk.
- **No secrets in the image** — they persist in layers forever.
- **\`.dockerignore\`** — keep \`bin\`, \`obj\`, \`.git\` out; they slow builds and bloat context.`,
    language: "text",
    code: `FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY ["Orders.Api/Orders.Api.csproj", "Orders.Api/"]
RUN dotnet restore "Orders.Api/Orders.Api.csproj"      # cached unless the csproj changes
COPY . .
RUN dotnet publish "Orders.Api/Orders.Api.csproj" -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0-jammy-chiseled AS final
WORKDIR /app
COPY --from=build /app .
USER $APP_UID                                          # non-root
ENTRYPOINT ["dotnet", "Orders.Api.dll"]`,
    tags: ["docker", "multi-stage", "layer caching", "security", "image size"],
  },
  {
    id: "prog2-estimation",
    topic: "programming",
    subtopic: "Craft",
    level: "intermediate",
    question: "How do you estimate work, and what do you do when you are wrong?",
    answer: `- **Break it down** until each piece is a day or less; anything bigger is a guess wearing a number.
- **Estimate ranges, not points** — "3 to 5 days" communicates uncertainty honestly.
- **Include the invisible work**: tests, code review, deployment, migration, monitoring, documentation.
- **Identify unknowns explicitly** and timebox a spike to remove them before committing.
- **Communicate early when it slips** — a warning on day two is manageable; a surprise on the deadline is not.

The failure mode interviewers probe for: quietly working late to hide a bad estimate. The right move is to renegotiate scope or date as soon as you know.`,
    tags: ["estimation", "planning", "communication", "spike"],
  },
];

export const DSA_EXTRA: Question[] = [
  {
    id: "dsa2-heap-priority",
    topic: "dsa",
    subtopic: "Data structures",
    level: "intermediate",
    question: "What is a heap and when do you use one?",
    answer: `A binary heap is a complete tree where every parent beats its children (min-heap: smaller). It gives O(1) peek, O(log n) insert and extract, in a flat array with no pointers.

Use it for:

- **Top-K** — keep a min-heap of size k; anything smaller than the root cannot be in the answer. O(n log k) with O(k) memory, versus O(n log n) for sorting everything.
- **Priority queues** — task scheduling, Dijkstra's frontier.
- **Merging k sorted lists** — heap of the current heads.
- **Streaming median** — two heaps, one min and one max.

.NET has \`PriorityQueue<TElement, TPriority>\` since .NET 6.`,
    language: "csharp",
    code: `// Top 10 largest from a stream, using O(k) memory
var heap = new PriorityQueue<int, int>();          // min-heap by priority
foreach (var n in stream)
{
    heap.Enqueue(n, n);
    if (heap.Count > 10) heap.Dequeue();           // drop the smallest
}
var top10 = new List<int>();
while (heap.TryDequeue(out var v, out _)) top10.Add(v);`,
    diagram: `Min-heap as an array: parent i, children 2i+1 and 2i+2

        1
      /   \\
     3     5          array: [1, 3, 5, 7, 9, 6]
    / \\   /
   7   9 6            no pointers, perfect cache locality`,
    tags: ["heap", "priority queue", "top k", "dijkstra"],
  },
  {
    id: "dsa2-trie",
    topic: "dsa",
    subtopic: "Data structures",
    level: "advanced",
    question: "What is a trie and when is it better than a hash map?",
    answer: `A prefix tree: each node is a character, each path a prefix. Lookup is O(L) in the key length, independent of how many keys are stored.

Better than a hash map when you need **prefix operations**: autocomplete, "all words starting with…", longest-prefix match (IP routing tables), and dictionary/word-game problems.

Not better for plain key lookup — a hash map is faster in practice and uses far less memory, since a trie allocates a node per character.

Compressed variants (radix tree / Patricia trie) merge single-child chains to cut that memory cost.`,
    language: "csharp",
    code: `public class Trie
{
    private readonly Node _root = new();
    private class Node
    {
        public Dictionary<char, Node> Children { get; } = new();
        public bool IsWord;
    }

    public void Add(string word)
    {
        var node = _root;
        foreach (var c in word)
        {
            if (!node.Children.TryGetValue(c, out var next)) node.Children[c] = next = new Node();
            node = next;
        }
        node.IsWord = true;
    }

    public IEnumerable<string> StartingWith(string prefix)
    {
        var node = _root;
        foreach (var c in prefix)
            if (!node.Children.TryGetValue(c, out node!)) yield break;

        foreach (var word in Collect(node, prefix)) yield return word;
    }

    private static IEnumerable<string> Collect(Node node, string sofar)
    {
        if (node.IsWord) yield return sofar;
        foreach (var (c, child) in node.Children)
            foreach (var w in Collect(child, sofar + c)) yield return w;
    }
}`,
    tags: ["trie", "prefix tree", "autocomplete", "radix"],
  },
  {
    id: "dsa2-backtracking",
    topic: "dsa",
    subtopic: "Algorithms",
    level: "advanced",
    question: "What is backtracking and how do you recognise it?",
    answer: `Build a candidate incrementally; when it cannot lead to a solution, undo the last choice and try the next. It is DFS over the space of partial solutions with **pruning**.

Signals in the problem: "all permutations", "all combinations", "all valid arrangements", Sudoku, N-Queens, word search, subset sum.

The template is always the same: choose → explore → **un-choose**. Forgetting the un-choose is the classic bug. Pruning early — checking validity before recursing — is what turns an impossible search into a fast one.`,
    language: "csharp",
    code: `public static IList<IList<int>> Permutations(int[] nums)
{
    var results = new List<IList<int>>();
    var current = new List<int>();
    var used = new bool[nums.Length];

    void Backtrack()
    {
        if (current.Count == nums.Length) { results.Add(new List<int>(current)); return; }

        for (int i = 0; i < nums.Length; i++)
        {
            if (used[i]) continue;              // prune

            used[i] = true; current.Add(nums[i]);      // choose
            Backtrack();                               // explore
            current.RemoveAt(current.Count - 1); used[i] = false;   // un-choose
        }
    }

    Backtrack();
    return results;
}`,
    tags: ["backtracking", "permutations", "pruning", "dfs", "n-queens"],
  },
  {
    id: "dsa2-bit-manipulation",
    topic: "dsa",
    subtopic: "Techniques",
    level: "intermediate",
    question: "Which bit tricks are worth knowing?",
    answer: `- \`x & 1\` — odd/even. \`x >> 1\` — divide by two.
- \`x & (x - 1)\` — clears the lowest set bit; loop to count set bits (Brian Kernighan).
- \`x & -x\` — isolates the lowest set bit.
- \`x ^ y\` — XOR: a value XORed with itself is 0, so XORing an array finds the single unpaired element in O(1) space.
- \`x & (x - 1) == 0\` — power of two check.
- **Bitmask as a set** — subsets of ≤ 32 elements, used in bitmask DP.

.NET has intrinsics: \`BitOperations.PopCount\`, \`LeadingZeroCount\`, \`IsPow2\` — they map to single CPU instructions.`,
    language: "csharp",
    code: `// The one number that appears once, everything else twice
static int SingleNumber(int[] nums)
{
    int result = 0;
    foreach (var n in nums) result ^= n;    // pairs cancel out
    return result;
}

// Iterate every subset of a set of n items
for (int mask = 0; mask < (1 << n); mask++)
    for (int i = 0; i < n; i++)
        if ((mask & (1 << i)) != 0) { /* item i is in this subset */ }`,
    tags: ["bit manipulation", "xor", "bitmask", "popcount"],
  },
  {
    id: "dsa2-matrix",
    topic: "dsa",
    subtopic: "Patterns",
    level: "intermediate",
    question: "What are the common matrix/grid interview problems?",
    answer: `Nearly all reduce to a traversal with bookkeeping:

- **Island counting / flood fill** — DFS or BFS from each unvisited land cell, marking as you go.
- **Shortest path in a grid** — BFS, because every step costs the same.
- **Rotate in place** — transpose, then reverse each row.
- **Spiral order** — four boundaries, shrink after each pass.
- **Set matrix zeroes** — use the first row and column as the marker to get O(1) space.

The recurring detail: bounds checking and a \`visited\` structure (or mutating the input, which you should call out as a trade).`,
    language: "csharp",
    code: `// Count islands: BFS from each unvisited '1'
public static int NumIslands(char[][] grid)
{
    int rows = grid.Length, cols = grid[0].Length, count = 0;
    int[] dr = [-1, 1, 0, 0], dc = [0, 0, -1, 1];

    for (int r = 0; r < rows; r++)
    for (int c = 0; c < cols; c++)
    {
        if (grid[r][c] != '1') continue;
        count++;

        var queue = new Queue<(int r, int c)>();
        queue.Enqueue((r, c));
        grid[r][c] = '0';                       // mark visited by mutating

        while (queue.Count > 0)
        {
            var (cr, cc) = queue.Dequeue();
            for (int d = 0; d < 4; d++)
            {
                int nr = cr + dr[d], nc = cc + dc[d];
                if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || grid[nr][nc] != '1') continue;
                grid[nr][nc] = '0';
                queue.Enqueue((nr, nc));
            }
        }
    }
    return count;
}`,
    tags: ["matrix", "grid", "islands", "bfs", "flood fill"],
  },
  {
    id: "dsa2-stack-problems",
    topic: "dsa",
    subtopic: "Patterns",
    level: "intermediate",
    question: "Which problems does a stack solve elegantly?",
    answer: `- **Balanced brackets** — push openers, pop and match on closers.
- **Monotonic stack** — "next greater element", "largest rectangle in a histogram", "daily temperatures". Keep the stack increasing or decreasing and pop while the invariant breaks; each element is pushed and popped once, so O(n).
- **Expression evaluation** — infix to postfix, then evaluate.
- **Undo** and iterative DFS.
- **Min stack** — a second stack of running minima gives O(1) \`Min()\`.

The monotonic stack is the one worth practising: it converts an obvious O(n²) scan into O(n) and appears often.`,
    language: "csharp",
    code: `// Next greater element for each position, in one pass
public static int[] NextGreater(int[] nums)
{
    var result = new int[nums.Length];
    Array.Fill(result, -1);
    var stack = new Stack<int>();               // holds indices, values decreasing

    for (int i = 0; i < nums.Length; i++)
    {
        while (stack.Count > 0 && nums[i] > nums[stack.Peek()])
            result[stack.Pop()] = nums[i];      // i is the answer for that index

        stack.Push(i);
    }
    return result;
}`,
    tags: ["stack", "monotonic stack", "brackets", "next greater"],
  },
  {
    id: "dsa2-interview-approach",
    topic: "dsa",
    subtopic: "Method",
    level: "basic",
    mustKnow: true,
    question: "How should you work through a coding problem in an interview?",
    answer: `The process is assessed as much as the answer.

1. **Restate the problem** and confirm you understood it.
2. **Ask about constraints** — input size, value ranges, duplicates, empty input, memory limits. These decide the algorithm.
3. **Give a brute force first** with its complexity, so there is always something on the table.
4. **Improve it out loud** — "the repeated scan is the cost; a hash map removes it".
5. **Agree the approach before coding.**
6. **Write it**, narrating decisions but not every keystroke.
7. **Test with examples**: normal, empty, single element, duplicates, maximum size.
8. **State the final complexity**, time and space.

Silence is the worst failure mode. A wrong idea explained clearly scores better than a right idea produced mutely.`,
    tags: ["interview", "method", "communication", "complexity"],
  },
  {
    id: "dsa2-space-time-tradeoff",
    topic: "dsa",
    subtopic: "Complexity",
    level: "intermediate",
    question: "Give examples of trading space for time, and when it is wrong.",
    answer: `Classic trades:

- **Hash map** — O(n) memory to remove a nested loop.
- **Memoisation** — store subproblem results instead of recomputing.
- **Precomputed prefix sums** — O(n) memory for O(1) range queries.
- **Index** in a database — storage and write cost for read speed.
- **Cache** — memory and staleness for latency.

When it is wrong: when the data does not fit (streaming, embedded, huge inputs), when the extra structure costs more cache misses than it saves work, or when the "slow" version is already fast enough and the memory version adds a consistency problem.

Say the constraint that decides it — that is the point of the question.`,
    language: "csharp",
    code: `// O(n) precompute, then O(1) per range query
var prefix = new long[nums.Length + 1];
for (int i = 0; i < nums.Length; i++) prefix[i + 1] = prefix[i] + nums[i];

long RangeSum(int from, int toExclusive) => prefix[toExclusive] - prefix[from];`,
    tags: ["trade-off", "memory", "prefix sum", "memoisation", "cache"],
  },
];

export const SYSTEM_DESIGN_EXTRA: Question[] = [
  {
    id: "sd2-load-balancing",
    topic: "system-design",
    subtopic: "Infrastructure",
    level: "intermediate",
    question: "How do load balancers work, and which algorithm would you pick?",
    answer: `**Layer 4** balances on IP/port — fast, protocol-agnostic, no visibility into the request. **Layer 7** understands HTTP, so it can route by path or header, terminate TLS, retry and rewrite.

Algorithms:

- **Round robin** — simple, assumes equal capacity and equal request cost.
- **Least connections** — better when request durations vary widely.
- **Weighted** — heterogeneous instance sizes, or canary traffic splitting.
- **IP hash / consistent hashing** — sticky routing, needed for stateful connections and useful for cache locality.

Health checks are what make it work: an instance failing checks must be removed automatically, and re-added only after it passes consistently.`,
    diagram: `        [ Layer 7 LB ]  --path /api--> [ API pool ]
             |          --path /img--> [ static pool ]
      health checks every 5s: 3 failures -> remove, 2 passes -> restore`,
    tags: ["load balancer", "l4", "l7", "least connections", "health check"],
  },
  {
    id: "sd2-cdn",
    topic: "system-design",
    subtopic: "Infrastructure",
    level: "intermediate",
    question: "What does a CDN do beyond serving images faster?",
    answer: `- **Edge caching** — content served from a POP near the user; origin never sees the request.
- **TLS termination at the edge**, cutting handshake latency dramatically for distant users.
- **Absorbing spikes and DDoS** — the edge takes the volume, not your origin.
- **Compression and modern formats** — brotli, image transformation.
- **Dynamic acceleration** — even uncacheable requests benefit from optimised backbone routing and connection reuse.

The design questions: what is cacheable, what is the TTL, how do you **invalidate** (purge vs versioned URLs — versioning is safer), and how do you vary on cookies or headers without destroying the hit rate.`,
    tags: ["cdn", "edge", "cache invalidation", "ttl", "ddos"],
  },
  {
    id: "sd2-search-design",
    topic: "system-design",
    subtopic: "Designs",
    level: "advanced",
    question: "Design a search feature for a product catalogue.",
    answer: `**Do not use \`LIKE '%term%'\`** — it cannot use an index and does not rank.

- **Full-text search engine** (Elasticsearch, OpenSearch, Azure AI Search) with an **inverted index**: term → list of documents, so a query is a set intersection rather than a scan.
- **Indexing pipeline** — the database remains the source of truth; changes flow to the index asynchronously (outbox or CDC), so search is eventually consistent by design.
- **Relevance** — BM25 scoring, boosting fields (title over description), synonyms, stemming and analyzers per language.
- **Facets and filters** — aggregations for category, price range, availability.
- **Autocomplete** — a separate prefix/edge n-gram index or a trie.
- **Typos** — fuzzy matching with an edit-distance bound.

Deep pagination is the trap: \`from + size\` degrades badly, so use search-after cursors.`,
    diagram: `[ Catalogue DB ] --outbox/CDC--> [ indexer ] --> [ search index ]
      (truth)                                          (inverted index, replicas)
                                                             ^
 user query -> [ API ] -> analyze -> query + filters --------+
                       <- ranked ids + facets -> hydrate from DB or index`,
    tags: ["search", "inverted index", "elasticsearch", "relevance", "facets"],
  },
  {
    id: "sd2-file-upload",
    topic: "system-design",
    subtopic: "Designs",
    level: "intermediate",
    question: "Design a file upload service.",
    answer: `- **Do not proxy bytes through your API.** Issue a **pre-signed URL / SAS** so the client uploads straight to object storage. Your service stays small and cheap.
- **Large files** — multipart/chunked upload with resume, so a dropped connection does not restart 2 GB.
- **Validate after upload** — size, content type sniffed from the bytes (not the extension), virus scan, and image re-encoding to strip payloads.
- **Processing** — the storage event triggers a queue message; workers generate thumbnails and extract metadata. Never process inline in the request.
- **Serve** through a CDN with short-lived signed URLs for private content.
- **Lifecycle** — tier or delete old files; clean up incomplete uploads.`,
    diagram: `1. client -> [API] : "I want to upload"     -> returns pre-signed URL + id
2. client -> [Blob storage] : PUT bytes      (API not involved)
3. storage event -> [queue] -> [worker] : scan, thumbnail, metadata
4. worker -> [DB] : mark ready
5. client polls or receives a push when ready`,
    tags: ["upload", "pre-signed url", "multipart", "virus scan", "cdn"],
  },
  {
    id: "sd2-feed-design",
    topic: "system-design",
    subtopic: "Designs",
    level: "advanced",
    question: "Design a news feed / timeline.",
    answer: `The whole question is **fan-out on write vs on read**.

- **Fan-out on write (push)** — when a user posts, insert into every follower's feed list. Reads are a single fast lookup. Fails for celebrities: one post means millions of writes.
- **Fan-out on read (pull)** — build the feed at read time by merging the people you follow. Cheap writes, expensive reads, worse at scale.
- **Hybrid** — push for normal accounts, pull for high-follower accounts, merged at read time. This is what real systems do, and saying so is the expected answer.

Then: cache the top N of each feed in Redis, paginate with cursors (not offsets), and rank by a score rather than pure recency if the product requires it.`,
    diagram: `Normal user posts          Celebrity posts
      |                          |
 fan-out on write           store once
      |                          |
 [follower feeds]           [celebrity timeline]
      \\                        /
       +--- merge at read ----+  -> user's feed (cached top 200)`,
    tags: ["feed", "fan-out", "timeline", "hybrid", "celebrity problem"],
  },
  {
    id: "sd2-observability-design",
    topic: "system-design",
    subtopic: "Operations",
    level: "intermediate",
    question: "How do you design observability into a distributed system?",
    answer: `Decide it up front — retrofitting correlation is painful.

- **Correlation id** generated at the edge, propagated in W3C \`traceparent\` through every HTTP call and message header, and logged on every entry.
- **Three signals**: metrics (cheap, aggregated, alertable), logs (detailed, expensive, sampled), traces (causality across services).
- **RED/USE** — for services track Rate, Errors, Duration; for resources Utilisation, Saturation, Errors.
- **SLOs, not vanity metrics** — "99.9% of checkout requests under 500 ms" is actionable; average latency is not.
- **Alert on symptoms** users feel, with runbooks attached. Page only on things that need a human now.

The test: can you answer "why was this request slow" and "which deployment broke this" in minutes?`,
    tags: ["observability", "tracing", "slo", "red method", "alerting"],
  },
  {
    id: "sd2-api-gateway",
    topic: "system-design",
    subtopic: "Architecture",
    level: "intermediate",
    question: "What belongs in an API gateway, and what does not?",
    answer: `**Belongs**: TLS termination, authentication and token validation, rate limiting and quotas, routing and versioning, request/response logging and correlation, response caching, and aggregating a few calls for a client that cannot make several.

**Does not belong**: business logic, per-entity authorisation decisions, data transformation that encodes domain rules, and anything requiring domain state. Once business rules live in gateway policies, they are untested, unversioned with the service, and owned by nobody.

Also worth naming: the gateway is a single point of failure and a deployment bottleneck if every team must change it — which is the argument for **backend-for-frontend** services instead of one giant gateway.`,
    tags: ["api gateway", "bff", "cross-cutting", "single point of failure"],
  },
  {
    id: "sd2-migration-strategy",
    topic: "system-design",
    subtopic: "Architecture",
    level: "advanced",
    question: "How do you migrate a legacy monolith without a big-bang rewrite?",
    answer: `**Strangler fig**: put a facade in front, route one capability at a time to a new service, and let the old system shrink until it can be switched off.

Sequence that works:

1. **Put a proxy in front** so routing can change without clients noticing.
2. **Pick a seam with clear boundaries and real pain** — high change rate, low coupling. Not the hardest, not the most trivial.
3. **Move reads first**, then writes, then data ownership.
4. **Dual-write or sync data** during the overlap, and reconcile — this is the messiest part and needs a plan for divergence.
5. **Verify with shadow traffic** — run both, compare outputs, before switching.
6. **Delete the old path** as soon as it is unused. Skipping this leaves you permanently running two systems, which is the common failure.

Say explicitly that a big-bang rewrite loses because the old system encodes years of undocumented edge cases.`,
    diagram: `        +-----------+
client -> |  proxy    | --/orders--> [ new Orders service ]
        |  (facade)  | --/*-------> [ legacy monolith ]
        +-----------+
 move one route at a time; the monolith shrinks until it can be retired`,
    tags: ["strangler fig", "migration", "legacy", "shadow traffic", "dual write"],
  },
];
