import type { Question } from "./types";

/** Data structures, algorithms and complexity — with C# implementations. */
export const DSA_QUESTIONS: Question[] = [
  {
    id: "dsa-big-o",
    topic: "dsa",
    subtopic: "Complexity",
    level: "basic",
    mustKnow: true,
    question: "Explain Big-O, and give the complexity of the operations you use daily.",
    answer: `Big-O describes how cost **grows** with input size, ignoring constants. O(n/2) and O(2n) are both O(n) — what matters is the shape.

| Structure | Access | Search | Insert | Delete |
|---|---|---|---|---|
| Array / \`List<T>\` | O(1) | O(n) | O(n) (O(1) at end) | O(n) |
| \`Dictionary\`/\`HashSet\` | — | O(1) avg, O(n) worst | O(1) avg | O(1) avg |
| Sorted array | O(1) | O(log n) binary search | O(n) | O(n) |
| Linked list | O(n) | O(n) | O(1) at a known node | O(1) at a known node |
| Balanced BST | O(log n) | O(log n) | O(log n) | O(log n) |
| Heap | O(1) peek | O(n) | O(log n) | O(log n) |

Say **space** complexity too — interviewers usually follow up, and recursion's O(n) stack space is the common miss.`,
    diagram: `Growth (n = 1,000,000)

O(1)        1
O(log n)    20
O(n)        1,000,000
O(n log n)  20,000,000
O(n^2)      1,000,000,000,000     <- unusable
O(2^n)      beyond counting`,
    followUps: [
      {
        question: "Why is a hash lookup O(n) in the worst case?",
        answer:
          "If every key collides into one bucket the lookup degenerates to a scan. Real implementations resize and, in .NET, randomise string hashing to make adversarial collisions impractical.",
      },
      {
        question: "What is amortised complexity?",
        answer:
          "Cost averaged over a sequence. `List<T>.Add` is O(1) amortised: most adds are O(1), and the occasional doubling resize is O(n), which spreads out to a constant per add.",
      },
    ],
    tags: ["big-o", "complexity", "data structures"],
  },
  {
    id: "dsa-array-vs-linkedlist",
    topic: "dsa",
    subtopic: "Data structures",
    level: "basic",
    question: "Array vs linked list — which is faster in practice?",
    answer: `On paper a linked list wins at insertion and deletion. In practice arrays win almost always, because of **cache locality**: array elements are contiguous, so a single cache line fetch brings several of them. A linked list chases pointers all over the heap, missing cache on nearly every step.

Choose a linked list only when you hold a reference to the node and insert/remove there frequently, or you need stable references to elements while the collection changes.

For interviews, the honest answer is: "\`List<T>\` unless I can demonstrate a specific need — the constant factor from cache behaviour usually beats the asymptotic advantage at realistic sizes."`,
    diagram: `Array in memory                 Linked list in memory
[a][b][c][d][e]                 [a]->      [d]->
 one cache line                      [c]->      [b]
                                 scattered: cache miss per hop`,
    followUps: [
      {
        question: "When does `LinkedList<T>` actually appear in .NET code?",
        answer:
          "LRU caches, where you hold the node and move it to the front in O(1), and intrusive lists in low-level libraries. Elsewhere it is rarely justified.",
      },
    ],
    tags: ["array", "linked list", "cache", "performance"],
  },
  {
    id: "dsa-hashmap-patterns",
    topic: "dsa",
    subtopic: "Patterns",
    level: "intermediate",
    mustKnow: true,
    question: "Which problems does a hash map turn from O(n²) into O(n)?",
    answer: `The single most productive interview pattern: replace a nested scan with one pass plus a lookup.

Recognise it when the question involves *"find a pair/duplicate/count/group"*:

- **Two Sum** — remember complements as you go.
- **Duplicates / first unique** — count or record indices.
- **Anagram grouping** — key by sorted letters or a character-count signature.
- **Subarray sum equals k** — remember prefix sums seen so far.
- **Intersection of collections** — build a set of one, scan the other.`,
    language: "csharp",
    code: `// Two Sum: one pass, O(n) time, O(n) space
public static (int, int)? TwoSum(int[] nums, int target)
{
    var seen = new Dictionary<int, int>();          // value -> index
    for (int i = 0; i < nums.Length; i++)
    {
        if (seen.TryGetValue(target - nums[i], out var j)) return (j, i);
        seen[nums[i]] = i;                          // after the check: handles x + x
    }
    return null;
}

// Subarray sum equals k: prefix sums
public static int SubarraysWithSum(int[] nums, int k)
{
    var counts = new Dictionary<long, int> { [0] = 1 };   // empty prefix
    long sum = 0; int total = 0;
    foreach (var n in nums)
    {
        sum += n;
        if (counts.TryGetValue(sum - k, out var c)) total += c;
        counts[sum] = counts.GetValueOrDefault(sum) + 1;
    }
    return total;
}`,
    followUps: [
      {
        question: "What is the trade you are making?",
        answer:
          "Memory for time — O(n) extra space. Say so explicitly; interviewers want to hear that you noticed, and sometimes the constraint is memory, which changes the answer to sorting plus two pointers.",
      },
    ],
    tags: ["hashmap", "two sum", "prefix sum", "patterns"],
  },
  {
    id: "dsa-two-pointer-sliding",
    topic: "dsa",
    subtopic: "Patterns",
    level: "intermediate",
    mustKnow: true,
    question: "When do you use two pointers or a sliding window?",
    answer: `**Two pointers** — a sorted array, and you are looking for a pair or partition. Move the pointer that can improve the answer. O(n) after sorting.

**Sliding window** — contiguous subarray or substring with a constraint ("longest without repeats", "smallest sum ≥ target"). Expand the right edge; while the constraint is violated, shrink the left. Each element enters and leaves once, so O(n).

The signal in the question is the word **contiguous** or **sorted**. Without one of those, reach for a hash map instead.`,
    language: "csharp",
    code: `// Longest substring without repeating characters
public static int LongestUnique(string s)
{
    var lastSeen = new Dictionary<char, int>();
    int best = 0, start = 0;

    for (int i = 0; i < s.Length; i++)
    {
        // Only move start forward, never back
        if (lastSeen.TryGetValue(s[i], out var prev) && prev >= start)
            start = prev + 1;

        lastSeen[s[i]] = i;
        best = Math.Max(best, i - start + 1);
    }
    return best;
}

// Two pointers on a sorted array: pair summing to target
public static (int, int)? PairSum(int[] sorted, int target)
{
    int lo = 0, hi = sorted.Length - 1;
    while (lo < hi)
    {
        var sum = sorted[lo] + sorted[hi];
        if (sum == target) return (lo, hi);
        if (sum < target) lo++; else hi--;
    }
    return null;
}`,
    diagram: `Sliding window: "abcabcbb"

 a b c a b c b b
 ^     ^                 window "abc", length 3
   ^     ^               'a' repeats -> shrink from the left
     ^     ^             each index enters once, leaves once -> O(n)`,
    followUps: [
      {
        question: "How do you know the window is O(n) and not O(n²)?",
        answer:
          "Because `start` only ever moves forward. Both pointers traverse the array at most once each, so the total work is linear even though the inner loop looks nested.",
      },
    ],
    tags: ["two pointers", "sliding window", "string", "array"],
  },
  {
    id: "dsa-sorting",
    topic: "dsa",
    subtopic: "Algorithms",
    level: "intermediate",
    question: "Compare the sorting algorithms and say which .NET uses.",
    answer: `| Algorithm | Average | Worst | Space | Stable |
|---|---|---|---|---|
| Quick sort | O(n log n) | O(n²) | O(log n) | no |
| Merge sort | O(n log n) | O(n log n) | O(n) | yes |
| Heap sort | O(n log n) | O(n log n) | O(1) | no |
| Insertion sort | O(n²) | O(n²) | O(1) | yes |
| Counting/radix | O(n + k) | O(n + k) | O(k) | yes |

.NET's \`Array.Sort\`/\`List.Sort\` use **introsort**: quicksort, switching to heapsort when recursion goes too deep (avoiding the O(n²) worst case) and to insertion sort for small partitions (where its low constant wins). It is **not stable** — \`OrderBy\` in LINQ is stable, which is the practical difference to remember.

Comparison sorts cannot beat O(n log n); counting/radix do better only by not comparing.`,
    followUps: [
      {
        question: "What does 'stable' mean and when does it matter?",
        answer:
          "Equal elements keep their original relative order. It matters when sorting by one key after another — sort by name, then stably by department, and names stay ordered within each department.",
      },
      {
        question: "Why is quicksort O(n²) in the worst case?",
        answer:
          "A pivot that always splits off one element — an already-sorted array with a naive first-element pivot. Randomised or median-of-three pivots make it improbable; introsort's depth limit makes it impossible.",
      },
    ],
    tags: ["sorting", "quicksort", "introsort", "stability", "complexity"],
  },
  {
    id: "dsa-binary-search",
    topic: "dsa",
    subtopic: "Algorithms",
    level: "intermediate",
    question: "Write binary search correctly, and name the traps.",
    answer: `Traps interviewers watch for:

1. **Overflow** — \`(lo + hi) / 2\` overflows for large indices; use \`lo + (hi - lo) / 2\`.
2. **Loop bounds** — mixing \`hi = length\` with \`hi = length - 1\` causes off-by-one or infinite loops. Pick one convention and keep it.
3. **Infinite loop** — failing to move a pointer past mid.
4. **Duplicates** — plain binary search finds *a* match, not the first. Lower/upper bound variants are the usual follow-up.

Binary search generalises beyond arrays: any monotonic predicate can be searched — "smallest capacity that finishes in time", "first version that fails".`,
    language: "csharp",
    code: `// Classic: exact match
public static int BinarySearch(int[] a, int target)
{
    int lo = 0, hi = a.Length - 1;
    while (lo <= hi)
    {
        int mid = lo + (hi - lo) / 2;          // overflow-safe
        if (a[mid] == target) return mid;
        if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
}

// Lower bound: first index with a[i] >= target (handles duplicates)
public static int LowerBound(int[] a, int target)
{
    int lo = 0, hi = a.Length;                 // note: hi is exclusive here
    while (lo < hi)
    {
        int mid = lo + (hi - lo) / 2;
        if (a[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo;
}

// Binary search on the answer: smallest speed that finishes within h hours
static bool Feasible(int speed) => /* monotonic check */ true;`,
    followUps: [
      {
        question: "How do you search a rotated sorted array?",
        answer:
          "At each step one half is still sorted — determine which by comparing `a[lo]` with `a[mid]`, check whether the target lies in that sorted half, and discard the other. Still O(log n).",
      },
    ],
    tags: ["binary search", "lower bound", "overflow", "monotonic"],
  },
  {
    id: "dsa-recursion-dp",
    topic: "dsa",
    subtopic: "Algorithms",
    level: "advanced",
    mustKnow: true,
    question: "How do you recognise and solve a dynamic programming problem?",
    answer: `Two signals: **overlapping subproblems** (the same input recurs) and **optimal substructure** (the best answer is built from best answers to smaller inputs).

Method that works under pressure:

1. Write the brute-force recursion and its state — "what arguments fully describe a subproblem?"
2. Add **memoisation** (top-down). This alone usually turns exponential into polynomial.
3. Optionally convert to **tabulation** (bottom-up) to remove recursion.
4. Reduce space if only the previous row is needed.

Complexity is *states × work per state* — say it that way and the analysis is immediate.`,
    language: "csharp",
    code: `// Fibonacci: exponential -> linear, purely by remembering
static long Fib(int n, Dictionary<int, long> memo)
{
    if (n <= 1) return n;
    if (memo.TryGetValue(n, out var cached)) return cached;
    return memo[n] = Fib(n - 1, memo) + Fib(n - 2, memo);
}

// 0/1 knapsack, bottom-up. States: n * capacity; work per state: O(1)
public static int Knapsack(int[] weight, int[] value, int capacity)
{
    var dp = new int[capacity + 1];              // space reduced to one row
    for (int i = 0; i < weight.Length; i++)
        for (int c = capacity; c >= weight[i]; c--)      // descending: each item once
            dp[c] = Math.Max(dp[c], dp[c - weight[i]] + value[i]);
    return dp[capacity];
}`,
    diagram: `Overlapping subproblems — fib(5)

              fib(5)
           /         \\
       fib(4)        fib(3)      <- fib(3) computed twice
      /     \\        /    \\
  fib(3)  fib(2)  fib(2) fib(1)  <- fib(2) three times
  Memoisation computes each state once: O(n) instead of O(2^n)`,
    followUps: [
      {
        question: "Top-down or bottom-up?",
        answer:
          "Top-down is easier to derive from the recursion and only computes reachable states. Bottom-up avoids stack depth and is usually faster by a constant. Start top-down in an interview; convert if asked.",
      },
      {
        question: "Greedy or DP?",
        answer:
          "Greedy works only when a locally optimal choice is provably globally optimal (interval scheduling by earliest finish). If you cannot prove it, a counterexample usually exists — use DP.",
      },
    ],
    tags: ["dynamic programming", "memoisation", "recursion", "knapsack"],
  },
  {
    id: "dsa-trees",
    topic: "dsa",
    subtopic: "Data structures",
    level: "intermediate",
    question: "Explain tree traversals and when each is used.",
    answer: `**Depth-first**, all O(n):

- **Pre-order** (node, left, right) — copying or serialising a tree.
- **In-order** (left, node, right) — a BST yields sorted order. The classic "validate a BST" answer.
- **Post-order** (left, right, node) — deleting, or computing a value from children (folder sizes).

**Breadth-first** (level order) — shortest path in an unweighted graph, level-by-level output. Uses a queue and O(width) memory.

Recursion depth is the trap: a skewed tree of 100,000 nodes overflows the stack. Say you would use an explicit stack for untrusted depth.`,
    language: "csharp",
    code: `// In-order, iterative — no recursion, no stack overflow
public static IEnumerable<int> InOrder(TreeNode? root)
{
    var stack = new Stack<TreeNode>();
    var current = root;
    while (current is not null || stack.Count > 0)
    {
        while (current is not null) { stack.Push(current); current = current.Left; }
        current = stack.Pop();
        yield return current.Value;
        current = current.Right;
    }
}

// Level order (BFS)
public static List<List<int>> Levels(TreeNode? root)
{
    var result = new List<List<int>>();
    if (root is null) return result;

    var queue = new Queue<TreeNode>();
    queue.Enqueue(root);
    while (queue.Count > 0)
    {
        int size = queue.Count;                       // freeze this level
        var level = new List<int>(size);
        for (int i = 0; i < size; i++)
        {
            var node = queue.Dequeue();
            level.Add(node.Value);
            if (node.Left is not null) queue.Enqueue(node.Left);
            if (node.Right is not null) queue.Enqueue(node.Right);
        }
        result.Add(level);
    }
    return result;
}`,
    followUps: [
      {
        question: "How do you validate a binary search tree?",
        answer:
          "Check that an in-order traversal is strictly increasing, or recurse carrying a (min, max) range. Comparing only with the immediate parent is the classic wrong answer.",
      },
      {
        question: "Why do balanced trees matter?",
        answer:
          "An unbalanced BST degrades to a linked list — O(n) instead of O(log n). AVL and red-black trees rebalance on insert to keep the height logarithmic.",
      },
    ],
    tags: ["tree", "traversal", "bst", "bfs", "dfs"],
  },
  {
    id: "dsa-graphs",
    topic: "dsa",
    subtopic: "Algorithms",
    level: "advanced",
    question: "BFS, DFS, Dijkstra, topological sort — which for which problem?",
    answer: `- **BFS** — shortest path when every edge costs the same; also level/degree-of-separation questions. Queue, O(V + E).
- **DFS** — connectivity, cycle detection, path existence, backtracking. Stack or recursion, O(V + E).
- **Dijkstra** — shortest path with non-negative weights. Priority queue, O((V + E) log V).
- **Bellman-Ford** — allows negative weights and detects negative cycles, O(V·E).
- **Topological sort** — ordering a DAG by dependency: build order, task scheduling, migration order. Kahn's algorithm also detects cycles.
- **Union-Find** — connected components, cycle detection in undirected graphs, Kruskal's MST. Near O(1) per operation with path compression.

Real-world framing wins points: dependency resolution is a topological sort, "who can approve this" is reachability, service dependency cycles are cycle detection.`,
    language: "csharp",
    code: `// Topological sort (Kahn) — also reports a cycle
public static List<string>? TopoSort(Dictionary<string, List<string>> graph)
{
    var indegree = graph.Keys.ToDictionary(k => k, _ => 0);
    foreach (var (_, targets) in graph)
        foreach (var t in targets) indegree[t]++;

    var queue = new Queue<string>(indegree.Where(kv => kv.Value == 0).Select(kv => kv.Key));
    var order = new List<string>();

    while (queue.Count > 0)
    {
        var node = queue.Dequeue();
        order.Add(node);
        foreach (var next in graph[node])
            if (--indegree[next] == 0) queue.Enqueue(next);
    }

    return order.Count == graph.Count ? order : null;   // null => cycle
}`,
    diagram: `Dependency graph -> build order

  api ---> core <--- worker
   |                   |
   +-----> contracts <-+

  topological order: contracts, core, api, worker
  (a cycle here would mean the build can never start)`,
    followUps: [
      {
        question: "Why does Dijkstra fail with negative edges?",
        answer:
          "It finalises a node's distance when it is popped, assuming no later path can be shorter. A negative edge can make one shorter afterwards. Bellman-Ford relaxes repeatedly instead.",
      },
    ],
    tags: ["graph", "bfs", "dfs", "dijkstra", "topological sort", "union find"],
  },
  {
    id: "dsa-lru-cache",
    topic: "dsa",
    subtopic: "Design",
    level: "advanced",
    question: "Design an LRU cache with O(1) get and put.",
    answer: `The standard answer: **hash map + doubly linked list**.

- The dictionary maps key → node, giving O(1) lookup.
- The list keeps usage order: most recently used at the head.
- On \`Get\`, move the node to the head. On \`Put\` beyond capacity, evict the tail.

Both structures are needed: the dictionary alone cannot tell you what was least recently used, and the list alone cannot find a key quickly.

In .NET, \`LinkedList<T>\` plus \`Dictionary<TKey, LinkedListNode<T>>\` implements it directly — this is the one place \`LinkedList<T>\` genuinely earns its place.`,
    language: "csharp",
    code: `public class LruCache<TKey, TValue> where TKey : notnull
{
    private readonly int _capacity;
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map = new();
    private readonly LinkedList<(TKey Key, TValue Value)> _order = new();

    public LruCache(int capacity) => _capacity = capacity;

    public bool TryGet(TKey key, out TValue value)
    {
        if (!_map.TryGetValue(key, out var node)) { value = default!; return false; }
        _order.Remove(node);                 // O(1): we hold the node
        _order.AddFirst(node);               // most recently used
        value = node.Value.Value;
        return true;
    }

    public void Put(TKey key, TValue value)
    {
        if (_map.TryGetValue(key, out var existing))
        {
            _order.Remove(existing);
            _map.Remove(key);
        }
        else if (_map.Count >= _capacity)
        {
            var lru = _order.Last!;          // evict from the tail
            _order.RemoveLast();
            _map.Remove(lru.Value.Key);
        }
        _map[key] = _order.AddFirst((key, value));
    }
}`,
    diagram: `head (most recent)                       tail (evict here)
 [ k3 ] <-> [ k1 ] <-> [ k7 ] <-> [ k2 ]
   ^          ^          ^          ^
 dictionary: key -> node  (O(1) find, then O(1) unlink/relink)`,
    followUps: [
      {
        question: "How would you make it thread-safe?",
        answer:
          "A lock around both structures, since every operation mutates both — they must move together. For high concurrency, shard by key hash into several independently locked caches.",
      },
      {
        question: "LRU vs LFU?",
        answer:
          "LRU evicts what was unused longest; LFU evicts what is used least often. LFU resists a one-off scan flushing the cache, but needs frequency counts and ageing so old popularity does not dominate forever.",
      },
    ],
    tags: ["lru", "cache", "linked list", "design", "o(1)"],
  },
  {
    id: "dsa-string-problems",
    topic: "dsa",
    subtopic: "Patterns",
    level: "intermediate",
    question: "What are the recurring string interview problems?",
    answer: `- **Palindrome check** — two pointers from both ends, skipping non-alphanumerics.
- **Anagrams** — compare character counts (O(n)) rather than sorting (O(n log n)).
- **Reverse words** — split/trim, or in-place reverse-whole-then-reverse-each-word.
- **Longest substring without repeating characters** — sliding window.
- **String compression / run-length** — single pass with a run counter.
- **First non-repeating character** — count, then scan again in order.

Watch for: Unicode (a "character" may be several \`char\` values — use \`StringInfo\` or rune enumeration), culture-sensitive comparison, and building strings in a loop without \`StringBuilder\`.`,
    language: "csharp",
    code: `// Anagram check in O(n) without sorting
public static bool IsAnagram(string a, string b)
{
    if (a.Length != b.Length) return false;

    var counts = new Dictionary<char, int>();
    foreach (var c in a) counts[c] = counts.GetValueOrDefault(c) + 1;

    foreach (var c in b)
    {
        if (!counts.TryGetValue(c, out var n) || n == 0) return false;
        counts[c] = n - 1;
    }
    return true;
}

// Palindrome, ignoring case and punctuation
public static bool IsPalindrome(string s)
{
    int lo = 0, hi = s.Length - 1;
    while (lo < hi)
    {
        while (lo < hi && !char.IsLetterOrDigit(s[lo])) lo++;
        while (lo < hi && !char.IsLetterOrDigit(s[hi])) hi--;
        if (char.ToLowerInvariant(s[lo]) != char.ToLowerInvariant(s[hi])) return false;
        lo++; hi--;
    }
    return true;
}`,
    followUps: [
      {
        question: "Why can `\"straße\".ToUpper()` surprise you?",
        answer:
          "Culture-dependent casing changes length or characters (ß → SS, and Turkish dotless i). Use `ToUpperInvariant`/`StringComparison.OrdinalIgnoreCase` for logic, and culture-aware comparison only for display and collation.",
      },
    ],
    tags: ["string", "palindrome", "anagram", "unicode", "patterns"],
  },
];
