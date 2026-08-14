/**
 * Python, pandas, statistics and data engineering.
 *
 * Aimed at "fluent, not expert" — enough to read and write real analysis code,
 * hold a conversation with a data scientist, and know when a number is being
 * presented dishonestly. Written for someone whose first language is C#, so it
 * points out where the habits differ rather than teaching programming.
 */

import type { Question } from "./types";

export const PYTHON_DATA_QUESTIONS: Question[] = [
  {
    id: "py-idioms",
    topic: "python-data",
    subtopic: "Python",
    level: "basic",
    mustKnow: true,
    question: "What should a C# developer know about Python that is genuinely different?",
    answer:
      "- **Indentation is syntax.** Mixed tabs and spaces is a real error, not a style opinion.\n- **Everything is a reference, and default arguments are evaluated once.** `def f(items=[])` shares one list across every call — the classic Python bug.\n- **Comprehensions** replace most LINQ: `[x.value for x in results if x.status == \"F\"]`. Generator expressions with `()` are lazy, like `IEnumerable`.\n- **Duck typing.** Type hints (`def parse(raw: str) -> Result:`) are documentation checked by `mypy`, not by the runtime.\n- **Truthiness catches C# developers out**: empty list, empty string, `0` and `None` are all falsy. `if not results:` is idiomatic and `if results == None:` is not.\n- **`is` compares identity, `==` compares value.** Use `is None`, never `== None`.\n- **Virtual environments are not optional.** `python -m venv .venv` plus a pinned `requirements.txt` or `uv`/`poetry`. Global installs collide.\n- **The GIL** means threads do not give CPU parallelism — use `multiprocessing` for CPU work, threads or `asyncio` for I/O.",
    language: "python",
    code:
      "# The default-argument trap\ndef add(item, items=[]):        # one list, shared by every call, for ever\n    items.append(item)\n    return items\n\ndef add(item, items=None):      # the fix\n    items = [] if items is None else items\n    items.append(item)\n    return items\n\n# Comprehension instead of LINQ\nfinal = [r.value for r in results if r.status == \"F\"]\nby_code = {r.code: r.value for r in results}",
    followUps: [
      { question: "What is the equivalent of using/IDisposable?", answer: "`with open(path) as f:` — the context manager protocol. Write your own with `__enter__`/`__exit__` or `@contextmanager`." },
    ],
    tags: ["python", "idioms", "comprehensions", "gil", "venv"],
  },
  {
    id: "py-pandas",
    topic: "python-data",
    subtopic: "Pandas",
    level: "intermediate",
    mustKnow: true,
    question: "What are the pandas operations that cover most real work?",
    answer:
      "- **Load** — `read_csv`, `read_sql`, `read_parquet`. Set `dtype` explicitly for identifiers, or an MRN like `007123` silently becomes the number 7123.\n- **Select** — `df.loc[rows, cols]` by label, `df.iloc[...]` by position. Boolean masks for filtering: `df[df.status == \"F\"]`.\n- **`groupby().agg()`** — the workhorse. Multiple aggregations at once with a dict.\n- **`merge`** — a SQL join. Always pass `how=` explicitly and *check the row count afterwards*: a merge that multiplies rows because the key was not unique is the most common silent data bug in analysis.\n- **`pivot_table`** — long to wide, with an aggregation.\n- **`assign`** — add computed columns in a chain rather than mutating.\n- **Dates** — `pd.to_datetime`, then `.dt` accessors and `resample` for time buckets.\n\nTwo habits worth forming: **chain rather than mutate**, so each step is inspectable; and **check `.shape` after every join**, because pandas will not warn you that you just tripled your data.",
    language: "python",
    code:
      "import pandas as pd\n\nresults = pd.read_csv(\"results.csv\", dtype={\"mrn\": str})   # keep leading zeros\nresults[\"observed\"] = pd.to_datetime(results[\"observed\"], utc=True)\n\nsummary = (\n    results\n    .query(\"status == 'F'\")\n    .assign(month=lambda d: d[\"observed\"].dt.to_period(\"M\"))\n    .groupby([\"analyte\", \"month\"])\n    .agg(n=(\"value\", \"size\"), median=(\"value\", \"median\"), abnormal=(\"flag\", lambda s: (s != \"N\").mean()))\n    .reset_index()\n)\n\nbefore = len(results)\njoined = results.merge(orders, on=\"accession\", how=\"left\", validate=\"many_to_one\")\nassert len(joined) == before      # validate= catches the fan-out at the source",
    followUps: [
      { question: "What does validate= do?", answer: "Asserts the key relationship — one_to_one, many_to_one and so on — and raises if the data disagrees. It turns a silent row explosion into an error at the line that caused it." },
      { question: "When should you stop using pandas?", answer: "When the data no longer fits comfortably in memory. Polars is faster and lazier; DuckDB lets you write SQL over files; Spark when it is genuinely large." },
    ],
    tags: ["pandas", "dataframe", "groupby", "merge", "analysis"],
  },
  {
    id: "py-numpy",
    topic: "python-data",
    subtopic: "NumPy",
    level: "basic",
    question: "Why is a NumPy array not just a list, and what is broadcasting?",
    answer:
      "A Python list is an array of pointers to objects. A NumPy array is a contiguous block of one type, so operations run in compiled code over the whole block instead of looping in the interpreter — often 10–100× faster, and with far less memory.\n\nThat is why **vectorised code beats loops**: `arr * 2` does the work in C; `[x * 2 for x in arr]` does it one object at a time.\n\n**Broadcasting** lets arrays of different shapes combine without copying: a `(1000, 3)` array minus a `(3,)` array subtracts that vector from every row. The rule is that dimensions are compared from the right and must be equal or 1.\n\nWhat catches people:\n\n- **Slices are views, not copies.** Modifying a slice modifies the original. Use `.copy()` when you mean a copy.\n- **`nan` propagates and is never equal to itself.** Use `np.isnan` and the `nan`-aware functions (`np.nanmean`).\n- **Integer types overflow silently** rather than promoting, unlike Python ints.",
    language: "python",
    code:
      "import numpy as np\n\nvalues = np.array([13.2, 14.1, 11.8, np.nan])\n\nvalues.mean()                 # nan — one missing value poisons the result\nnp.nanmean(values)            # 13.03\n\n# Broadcasting: centre every column without a loop\nmatrix = np.random.default_rng(0).normal(size=(1000, 3))\ncentred = matrix - matrix.mean(axis=0)      # (1000,3) - (3,)\n\nview = matrix[:10]            # a view\nview[0, 0] = 99               # this changed `matrix` too",
    followUps: [
      { question: "How do you know an operation is vectorised?", answer: "If you wrote a `for` over elements, it is not. Time it: the difference on a million elements is unmissable." },
    ],
    tags: ["numpy", "vectorisation", "broadcasting", "nan", "arrays"],
  },
  {
    id: "py-sql-analytics",
    topic: "python-data",
    subtopic: "SQL",
    level: "intermediate",
    mustKnow: true,
    question: "Window functions and CTEs — the analytic half of SQL.",
    answer:
      "A **window function** computes across a set of rows *related to the current row*, without collapsing them the way `GROUP BY` does. That is the whole idea: you keep every row and add a computed column.\n\n- `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)` — the standard way to take the latest row per group. Filter on it in an outer query, because you cannot use a window function in `WHERE`.\n- `RANK` and `DENSE_RANK` — like `ROW_NUMBER` but ties share a rank.\n- `LAG` / `LEAD` — the previous or next row's value. Deltas between consecutive results without a self-join.\n- `SUM(...) OVER (ORDER BY ... ROWS BETWEEN ...)` — running totals and moving averages.\n\n**CTEs** (`WITH`) name a step so a query reads top to bottom instead of inside out. Recursive CTEs walk hierarchies — an organisation tree, a chain of amended results.\n\nThe pattern that comes up constantly in this domain: *the latest result per patient per analyte*, which is `ROW_NUMBER` partitioned by both, ordered by time descending, filtered to 1.",
    language: "sql",
    code:
      "-- Latest final result per patient per analyte, with the change since the previous one\nWITH ranked AS (\n    SELECT r.PatientId, r.Analyte, r.Value, r.ObservedAt,\n           ROW_NUMBER() OVER (PARTITION BY r.PatientId, r.Analyte\n                              ORDER BY r.ObservedAt DESC) AS rn,\n           LAG(r.Value)  OVER (PARTITION BY r.PatientId, r.Analyte\n                              ORDER BY r.ObservedAt)      AS PreviousValue\n    FROM Result r\n    WHERE r.Status = 'F'\n)\nSELECT PatientId, Analyte, Value, PreviousValue,\n       Value - PreviousValue AS Delta, ObservedAt\nFROM ranked\nWHERE rn = 1;",
    followUps: [
      { question: "Why can a window function not go in WHERE?", answer: "Because WHERE runs before windows are computed. Wrap it in a CTE or subquery and filter outside — that ordering is the whole reason the pattern looks like this." },
    ],
    tags: ["sql", "window-functions", "cte", "analytics", "row-number"],
    relatedTools: ["database-toolkit", "sql-formatter"],
  },
  {
    id: "py-statistics",
    topic: "python-data",
    subtopic: "Statistics",
    level: "intermediate",
    question: "Which statistics do you need to avoid being misled?",
    answer:
      "- **Mean versus median.** Lab values and durations are skewed; the mean of a distribution with a long tail describes nobody. Report the median and an interquartile range, and say which you used.\n- **Variance and standard deviation** — how spread out it is. A mean without a spread is half a number.\n- **Percentiles.** p50, p95, p99. Latency and turnaround time live in the tail, and the tail is what people complain about.\n- **Correlation is not causation**, and correlation only measures a *linear* relationship. Plot it; anscombe's quartet exists for a reason.\n- **Base rates.** The one that matters most in healthcare: a test that is 99% accurate for a disease affecting 1 in 10,000 produces about 100 false positives for every true one. A positive result changes the odds far less than the accuracy figure suggests.\n- **Simpson's paradox.** A trend in every subgroup can reverse when the groups are pooled. Always check whether an aggregate hides a confounder.\n- **p-values** say how surprising the data would be if nothing were happening. They do not say the effect is large or that it matters.\n- **Sample size.** Small samples produce extreme results in both directions. A 100% success rate over four cases is not a rate.",
    followUps: [
      { question: "Why is the base-rate point so important clinically?", answer: "Because it is the difference between 'this test is 99% accurate' and 'a positive result is probably wrong'. Screening a rare condition in a healthy population is dominated by the base rate." },
    ],
    tags: ["statistics", "median", "percentiles", "base-rate", "simpson"],
  },
  {
    id: "py-data-quality",
    topic: "python-data",
    subtopic: "Data engineering",
    level: "intermediate",
    mustKnow: true,
    question: "What does data quality mean in practice, and how do you enforce it?",
    answer:
      "Six dimensions, each checkable:\n\n- **Completeness** — are required fields present? What fraction is null, and is that changing?\n- **Validity** — does it match the rules? Dates in range, codes in the value set, numbers in a plausible interval.\n- **Consistency** — do related fields agree? A discharge before an admission, a paediatric range on an adult.\n- **Uniqueness** — duplicates by natural key.\n- **Timeliness** — how old is the newest record? A pipeline that stopped yesterday looks perfectly healthy if you only check for errors.\n- **Accuracy** — does it match reality? The only one you cannot check without an external reference.\n\nHow to enforce it: **checks that run with the pipeline and fail it**, not a dashboard someone might read. Great Expectations, dbt tests, or twenty lines of assertions — the tool matters much less than the failure being loud.\n\nAnd **quarantine rather than drop**. A record that fails validation goes to a table with the reason attached, where it can be counted, reviewed and reprocessed. Silently dropping bad rows makes the pipeline look healthy while data disappears.",
    language: "python",
    code:
      "def check(df: pd.DataFrame) -> pd.DataFrame:\n    problems = pd.Series(\"\", index=df.index)\n\n    problems += np.where(df[\"mrn\"].isna(),            \"missing mrn;\", \"\")\n    problems += np.where(~df[\"loinc\"].isin(value_set), \"unknown loinc;\", \"\")\n    problems += np.where(df[\"value\"].lt(0),           \"negative value;\", \"\")\n    problems += np.where(df[\"observed\"] > pd.Timestamp.utcnow(), \"future date;\", \"\")\n\n    quarantined = df[problems != \"\"].assign(reason=problems[problems != \"\"])\n    quarantined.to_sql(\"quarantine\", engine, if_exists=\"append\")   # kept, counted, reviewable\n\n    if len(quarantined) / max(len(df), 1) > 0.05:\n        raise DataQualityError(f\"{len(quarantined)} of {len(df)} rows failed validation\")\n\n    return df[problems == \"\"]",
    followUps: [
      { question: "Why alert on timeliness separately?", answer: "Because a stopped pipeline throws no errors. Freshness — 'newest record is older than an hour' — is the check that catches a silent stop." },
    ],
    tags: ["data-quality", "validation", "quarantine", "pipelines", "monitoring"],
  },
  {
    id: "py-pipelines",
    topic: "python-data",
    subtopic: "Data engineering",
    level: "intermediate",
    question: "ETL or ELT, batch or streaming — how do you choose?",
    answer:
      "**ETL** transforms before loading, so the warehouse only ever holds clean data — and you cannot re-derive anything you discarded. **ELT** loads raw and transforms in the warehouse, which is the modern default: storage is cheap, compute is elastic, and keeping the raw layer means a mapping bug can be fixed by re-running rather than by re-ingesting from a source that may no longer have the data.\n\nThe usual shape is medallion: **bronze** (raw, as received, immutable) → **silver** (cleaned, typed, deduplicated) → **gold** (aggregated for a purpose).\n\n**Batch versus streaming** is a latency question, and the honest answer is usually batch. Streaming costs more to build, far more to operate, and is much harder to reason about. Choose it when the value genuinely decays in seconds — device telemetry, alerting, live dashboards — not because it sounds modern. Micro-batching every few minutes covers most \"real-time\" requirements.\n\nWhatever you choose, make it **idempotent and re-runnable**: partition by ingestion date, overwrite a partition rather than appending blindly, and record the watermark you processed to. A pipeline you cannot safely re-run is a pipeline you cannot fix.",
    diagram:
      "  source ──▶ bronze (raw, immutable, partitioned by date)\n                 └──▶ silver (typed, deduplicated, validated)\n                          └──▶ gold (aggregates, one per question)\n\n  re-run = reprocess a partition, not re-ingest from a source that has moved on",
    followUps: [
      { question: "Why keep the raw layer at all?", answer: "Because every transformation has a bug eventually. With bronze you re-run; without it you go back to a source system that may have changed or purged the data." },
    ],
    tags: ["etl", "elt", "medallion", "batch", "streaming", "idempotency"],
  },
  {
    id: "py-notebooks",
    topic: "python-data",
    subtopic: "Practice",
    level: "basic",
    question: "When is a notebook the right tool, and when does it become a liability?",
    answer:
      "**Right** for exploration: looking at a new dataset, checking a hypothesis, producing a chart for a conversation. The tight loop is exactly what exploration needs.\n\n**A liability** the moment it becomes production. Notebooks have hidden state — cells run out of order leave variables that no fresh run reproduces — they diff badly in git, they are hard to test, and they invite copy-paste over functions.\n\nThe workable discipline:\n\n- **Explore in a notebook, then extract.** Anything worth keeping becomes a function in a module, imported back into the notebook. The notebook stays thin.\n- **Restart and run all before believing a result.** If it does not survive that, it was never real.\n- **Test the module, not the notebook.**\n- **Never let a notebook be the scheduled job.** Papermill exists and works, but the code inside should still be imported functions with tests.\n- **No credentials in cells**, and clear outputs before committing — outputs routinely contain patient data.\n\nThe last point is the healthcare-specific one: a committed notebook with rendered output is a committed dataset.",
    followUps: [
      { question: "How do you keep notebooks out of git diffs?", answer: "nbstripout as a pre-commit hook clears outputs automatically, or use jupytext to store the notebook as a plain .py file that diffs properly." },
    ],
    tags: ["notebooks", "jupyter", "reproducibility", "practice", "phi"],
  },
  {
    id: "py-ml-workflow",
    topic: "python-data",
    subtopic: "Machine learning",
    level: "intermediate",
    question: "What does a minimal, honest ML workflow look like?",
    answer:
      "1. **Frame the decision first.** What action changes because of this prediction? If nothing does, the model has no value however good it is.\n2. **Baseline.** The simplest thing — a rule, the majority class, last week's value. Any model must beat it, and a surprising number do not.\n3. **Split by the right axis.** Random splits leak when rows are related: split by *patient*, and for anything temporal split by *time*, training on the past and testing on the future. A random split on time-series data reports a score you will never see again.\n4. **A pipeline, not loose steps.** Scaling and encoding fitted on train only — fitting a scaler on all the data before splitting is leakage, and it is easy to do by accident.\n5. **Metrics that match the cost** of each error, plus calibration if the output is a probability.\n6. **Ship the threshold as a decision**, agreed with whoever bears the consequences.\n7. **Monitor drift** in inputs and outputs; retrain on a schedule and on a trigger.\n\nAnd be able to explain a prediction. In a clinical setting, a model nobody can interrogate will not be used — and should not be.",
    language: "python",
    code:
      "from sklearn.model_selection import GroupShuffleSplit\nfrom sklearn.pipeline import Pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.linear_model import LogisticRegression\n\n# Split by patient: the same person's rows must never span train and test\nsplitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=0)\ntrain_idx, test_idx = next(splitter.split(X, y, groups=df[\"patient_id\"]))\n\n# The scaler is fitted inside the pipeline, so only on training data\nmodel = Pipeline([(\"scale\", StandardScaler()), (\"clf\", LogisticRegression(max_iter=1000))])\nmodel.fit(X.iloc[train_idx], y.iloc[train_idx])",
    followUps: [
      { question: "What is the most common leak?", answer: "Fitting a scaler or an encoder before splitting, and splitting rows rather than patients. Both inflate the score and neither shows up as an error." },
    ],
    tags: ["machine-learning", "leakage", "splitting", "pipeline", "sklearn"],
  },
  {
    id: "py-api",
    topic: "python-data",
    subtopic: "Practice",
    level: "intermediate",
    question: "How do you put a Python model or analysis behind an API a .NET system can call?",
    answer:
      "**FastAPI** is the default: type hints become validation and an OpenAPI document, and it is async by nature.\n\nWhat matters when the caller is a .NET service:\n\n- **A contract both sides generate from.** FastAPI emits OpenAPI; generate the C# client from it rather than hand-writing a DTO that drifts.\n- **Load the model once at startup**, not per request. Use lifespan events, and remember each worker process holds its own copy — that is your memory budget multiplied.\n- **Workers, not threads.** The GIL means CPU-bound inference does not parallelise across threads. Run several workers (`uvicorn --workers`) and size them against memory.\n- **Bounded latency.** A timeout on the caller and a queue limit on the server, so a slow model produces a fast error rather than a pile-up.\n- **Health endpoints** that check the model is loaded, not just that the process is up.\n- **Pin every dependency.** `numpy` and `scikit-learn` versions change results; an unpinned rebuild is a silent model change.\n- **Version the model in the response.** When a prediction is questioned months later, you need to know which model produced it.\n\nAnd batch where you can: one call with 100 rows is far cheaper than 100 calls.",
    language: "python",
    code:
      "from contextlib import asynccontextmanager\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel, Field\n\nclass Request(BaseModel):\n    values: list[float] = Field(min_length=1, max_length=1000)\n\nclass Response(BaseModel):\n    scores: list[float]\n    model_version: str          # answerable months later\n\n@asynccontextmanager\nasync def lifespan(app: FastAPI):\n    app.state.model = load_model()      # once per worker, not per request\n    yield\n\napp = FastAPI(lifespan=lifespan)\n\n@app.post(\"/score\", response_model=Response)\ndef score(req: Request) -> Response:\n    return Response(scores=app.state.model.predict(req.values).tolist(),\n                    model_version=MODEL_VERSION)",
    followUps: [
      { question: "Python service or ONNX in .NET?", answer: "If the model exports cleanly to ONNX, running it in .NET removes a service, a deployment and a network hop. Keep Python where the ecosystem is genuinely needed." },
    ],
    tags: ["fastapi", "api", "deployment", "onnx", "integration"],
    relatedTools: ["api-tester", "openapi"],
  },
  {
    id: "py-dates",
    topic: "python-data",
    subtopic: "Practice",
    level: "intermediate",
    question: "What goes wrong with dates in data work?",
    answer:
      "Almost everything, and always quietly:\n\n- **Naive versus aware.** A datetime with no timezone is a string with ambitions. Store UTC, attach the zone, convert at the edge for display.\n- **Day-first versus month-first.** `03/04/2026` is two different dates, and pandas will guess — and guess differently for different rows in the same column if some are unambiguous. Pass an explicit `format=`.\n- **Excel round trips.** A CSV opened in Excel and saved turns dates into whatever the local settings say, and turns identifiers into numbers.\n- **Daylight saving.** One hour repeats and one does not exist each year. A local timestamp during the repeated hour is genuinely ambiguous.\n- **Age.** Computed from a date of birth, changes over time, and is a re-identification risk over 89. Store the date, derive the age, and bucket it in exports.\n- **Partial dates.** Healthcare data has \"1988\" and \"1988-04\" with no day. Model the precision rather than defaulting to the first of the month, which invents a fact.\n- **Duration crossing midnight** — a turnaround time computed as `end - start` on times without dates gives a negative number roughly once a night.\n\nThe rule: parse explicitly, store UTC with the original string when the source is ambiguous, and never let a library guess.",
    language: "python",
    code:
      "# Explicit beats convenient. Never let pandas infer a date format.\ndf[\"collected\"] = pd.to_datetime(df[\"collected\"], format=\"%d/%m/%Y %H:%M\", utc=True)\n\n# Partial dates: keep the precision instead of inventing a day\ndef parse_partial(value: str) -> tuple[pd.Timestamp, str]:\n    for fmt, precision in ((\"%Y-%m-%d\", \"day\"), (\"%Y-%m\", \"month\"), (\"%Y\", \"year\")):\n        try:\n            return pd.to_datetime(value, format=fmt), precision\n        except ValueError:\n            continue\n    raise ValueError(f\"unparseable date: {value!r}\")",
    followUps: [
      { question: "Why is age over 89 sensitive?", answer: "Because very old ages are rare enough to identify someone. HIPAA's safe-harbour rule groups everyone over 89 into one bucket for exactly that reason." },
    ],
    tags: ["dates", "timezones", "parsing", "pandas", "phi"],
    relatedTools: ["unix-timestamp"],
  },
  {
    id: "py-visualisation",
    topic: "python-data",
    subtopic: "Practice",
    level: "basic",
    question: "What makes a chart honest?",
    answer:
      "- **Show the distribution, not only the average.** A box plot or a histogram tells you what a mean hides. Two groups with identical means can be entirely different populations.\n- **Start bar charts at zero.** A truncated axis exaggerates a difference, and it is the most common way a chart misleads without lying.\n- **Say what N is.** A 30% improvement over seven cases is noise with a percentage sign.\n- **Label the axes and the units.** \"Value\" against \"time\" is not a chart, it is a decoration.\n- **Show uncertainty** where it exists — error bars, a confidence band, or at least an interquartile range.\n- **One message per chart.** If it needs a paragraph to explain, it is two charts.\n- **Do not use colour as the only encoding.** Around 8% of men have some colour-vision deficiency, and printouts are still a thing in hospitals.\n\nAnd for clinical audiences specifically: mark reference ranges, and never plot values from different units on one axis without saying so.",
    followUps: [
      { question: "Which chart type by default?", answer: "Line for a value over time, bar for comparing categories, histogram or box plot for a distribution, scatter for a relationship. Pie charts almost never — people compare angles badly." },
    ],
    tags: ["visualisation", "charts", "honesty", "communication"],
  },
  {
    id: "py-perf",
    topic: "python-data",
    subtopic: "Practice",
    level: "intermediate",
    question: "A Python script is too slow. What do you do, in order?",
    answer:
      "1. **Measure.** `cProfile` or `py-spy` on the real workload. Intuition about Python performance is wrong more often than not.\n2. **Fix the algorithm.** A dictionary lookup instead of a linear scan beats every micro-optimisation. Nested loops over a DataFrame are usually an accidental O(n²).\n3. **Vectorise.** Replace per-row loops and `.apply()` with column operations. This is normally the largest single win in data code.\n4. **Do less I/O.** Read only the columns you need — Parquet makes that cheap; CSV does not. Push filters into the query rather than filtering after loading everything.\n5. **Chunk.** Process in batches so memory stays flat and the job survives a large input.\n6. **Change tool before changing language.** Polars, DuckDB or SQL in the database will often outperform hand-optimised pandas by a wide margin.\n7. **Parallelise last** — multiprocessing for CPU work, async for I/O — because it multiplies both throughput and the difficulty of debugging.\n\nThe one to reach for first is almost always vectorisation, and the one people reach for first is almost always parallelism.",
    followUps: [
      { question: "Why is .apply() slow?", answer: "It calls a Python function per row, so you pay interpreter overhead per element and lose the compiled path entirely. It is a loop with better syntax." },
    ],
    tags: ["performance", "profiling", "vectorisation", "pandas", "optimisation"],
  },
  {
    id: "py-deid-data",
    topic: "python-data",
    subtopic: "Data engineering",
    level: "advanced",
    mustKnow: true,
    question: "How do you prepare a clinical dataset for analysis without leaking identity?",
    answer:
      "Removing the name is the easy part and nowhere near enough — the risk is **re-identification by combination**.\n\nWhat has to happen:\n\n- **Drop direct identifiers**: name, MRN, address, phone, email, insurance number, device serial, full-face images.\n- **Generalise quasi-identifiers.** Date of birth becomes a year or an age band; postcode becomes a region; a rare diagnosis may need suppressing entirely. A date of birth plus a postcode plus a sex identifies a large fraction of people on its own.\n- **Shift dates consistently per patient.** Randomly moving every date destroys the intervals that make the data useful; shifting all of one patient's dates by the same random offset preserves *time between events* while breaking the link to a real day.\n- **Pseudonymise with a keyed hash**, not a plain hash — an unsalted hash of an MRN is trivially reversed by hashing every possible MRN. Keep the key somewhere the analyst cannot reach.\n- **Bucket ages over 89**, which are rare enough to identify.\n- **Free text is the hard part.** Names and identifiers appear inside notes; treat unreviewed free text as identifiable.\n- **Small cells.** Suppress or aggregate any group below a threshold — a count of 1 in a rare category *is* a person.\n\nAnd know the difference: **anonymised** data cannot be re-linked; **pseudonymised** data can, by whoever holds the key, and is still personal data under most law.",
    language: "python",
    code:
      "import hmac, hashlib\nimport numpy as np, pandas as pd\n\nKEY = get_secret(\"deid-key\")            # not in the notebook, not in the repo\n\ndef pseudonymise(mrn: str) -> str:\n    return hmac.new(KEY, mrn.encode(), hashlib.sha256).hexdigest()[:16]\n\nrng = np.random.default_rng(0)\noffsets = {mrn: pd.Timedelta(days=int(rng.integers(-90, 90))) for mrn in df[\"mrn\"].unique()}\n\nout = (df\n    .assign(subject=df[\"mrn\"].map(pseudonymise),\n            observed=df[\"observed\"] + df[\"mrn\"].map(offsets),   # intervals preserved\n            age_band=pd.cut(df[\"age\"], [0, 18, 40, 65, 89, 200],\n                            labels=[\"<18\", \"18-39\", \"40-64\", \"65-89\", \"90+\"]))\n    .drop(columns=[\"mrn\", \"name\", \"postcode\", \"dob\", \"age\"]))",
    followUps: [
      { question: "Why shift dates per patient rather than per row?", answer: "Because the clinically interesting quantity is the interval — days from admission to result. A per-row shift destroys it; a per-patient shift keeps every interval intact." },
      { question: "Is a hashed MRN safe to publish?", answer: "No. MRNs come from a small space, so anyone can hash every candidate and match. A keyed HMAC with the key withheld is the minimum, and it is still pseudonymisation rather than anonymisation." },
    ],
    tags: ["de-identification", "phi", "pseudonymisation", "pandas", "privacy"],
    relatedTools: ["healthcare-deidentifier"],
  },
  {
    id: "py-reproducibility",
    topic: "python-data",
    subtopic: "Practice",
    level: "intermediate",
    question: "What makes an analysis reproducible six months later?",
    answer:
      "- **Pinned dependencies.** A lock file, not a range. `pandas>=2.0` is not a version.\n- **A pinned data snapshot**, or at minimum a recorded query with the date it was run. \"The results table\" changes; your analysis assumed a moment in time.\n- **Seeded randomness** everywhere it appears — sampling, splits, model initialisation.\n- **Code in version control**, including the notebook, with outputs cleared.\n- **One entry point.** A script or a make target that runs the whole thing end to end. If reproducing it requires knowing which cells to run in which order, it is not reproducible.\n- **Recorded parameters and outputs.** Which thresholds, which filters, what the numbers were. An experiment tracker if there are many; a text file if there are few.\n- **The environment**, as a container or a lock file, so the interpreter and the native libraries match too.\n\nThe test: hand it to a colleague with the repository and nothing else. If they cannot reproduce your headline number, neither will you in six months.",
    followUps: [
      { question: "Why does seeding matter beyond exactness?", answer: "Because it separates a real effect from sampling noise. If a result moves when the seed changes, the result was the seed." },
    ],
    tags: ["reproducibility", "pinning", "seeds", "version-control", "practice"],
  },
];
