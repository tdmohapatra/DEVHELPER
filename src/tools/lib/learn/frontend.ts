/**
 * Angular cards — maintenance level.
 *
 * This is an existing skill worth keeping sharp rather than growing, so the
 * deck is deliberately short and aimed at what an interview asks a full-stack
 * .NET developer: change detection, RxJS, forms, interceptors, and the modern
 * shape of the framework (standalone components and signals) so nothing here
 * reads as five years out of date.
 */

import type { Question } from "./types";

export const FRONTEND_QUESTIONS: Question[] = [
  {
    id: "ng-standalone",
    topic: "frontend",
    subtopic: "Structure",
    level: "basic",
    mustKnow: true,
    question: "What changed with standalone components, and what happened to NgModules?",
    answer:
      "A standalone component declares its own dependencies in `imports`, so it needs no NgModule at all. Since Angular 15 this is the recommended default, and since 17 it is what `ng new` produces.\n\nWhat it replaces:\n\n- **Declarations** — gone. A component imports the directives and pipes it uses, so the dependency is visible in the file that needs it.\n- **Feature modules for lazy loading** — a route can now `loadComponent` directly.\n- **Providers** — still exist, at the root (`providedIn: 'root'`), in `bootstrapApplication`, or per route.\n\nWhy it is better: the old model let a component use a directive it never mentioned, because some module declared both. That made dependencies invisible and tree-shaking poor. Standalone makes them explicit and lets the bundler drop what is unused.\n\nNgModules still work — the migration is incremental, and a large application will have both for a long time. Knowing why the change happened is what an interview is checking.",
    language: "typescript",
    code:
      "@Component({\n  selector: 'app-result-list',\n  standalone: true,\n  imports: [CommonModule, RouterLink, ResultRowComponent],   // explicit, tree-shakeable\n  template: `\n    @for (result of results(); track result.id) {\n      <app-result-row [result]=\"result\" />\n    } @empty {\n      <p>No results.</p>\n    }\n  `,\n})\nexport class ResultListComponent {\n  private readonly service = inject(ResultService);\n  readonly results = this.service.latest;   // a signal\n}\n\n// Lazy loading without a module\nexport const routes: Routes = [\n  { path: 'results', loadComponent: () => import('./result-list.component').then(m => m.ResultListComponent) },\n];",
    followUps: [
      { question: "What is inject() for?", answer: "Dependency injection without a constructor parameter. It works in field initialisers and in functional guards, interceptors and resolvers, which no longer have a class to put a constructor on." },
    ],
    tags: ["angular", "standalone", "ngmodule", "lazy-loading", "structure"],
  },
  {
    id: "ng-change-detection",
    topic: "frontend",
    subtopic: "Rendering",
    level: "intermediate",
    mustKnow: true,
    question: "How does change detection work, and what does OnPush change?",
    answer:
      "By default, Angular checks **every component** in the tree after any event that might have changed something — a click, an HTTP response, a timer — because Zone.js patches those APIs and tells Angular to run a check. That check is a comparison of every bound expression in every template.\n\n**OnPush** narrows it. A component with `changeDetection: ChangeDetectionStrategy.OnPush` is only checked when:\n\n- one of its `@Input` **references** changes (reference, not contents — mutating an array in place will not trigger it),\n- an event fires from inside its own template,\n- an observable it subscribes to with `async` emits,\n- a signal it reads changes,\n- or something calls `markForCheck()` explicitly.\n\nThe cost of not using it: on a large tree, every keystroke re-evaluates thousands of expressions. The cost of using it: you must treat inputs as immutable — replace the array, do not push to it — which is a discipline, not a switch.\n\n**Signals** are where this is going. A signal-based component knows exactly which views depend on which value, so it can update those and nothing else, and zoneless applications drop Zone.js entirely.",
    language: "typescript",
    code:
      "@Component({\n  selector: 'app-result-row',\n  standalone: true,\n  changeDetection: ChangeDetectionStrategy.OnPush,\n  template: `{{ result.analyte }}: {{ result.value }}`,\n})\nexport class ResultRowComponent {\n  @Input({ required: true }) result!: Result;\n}\n\n// Elsewhere — this will NOT update an OnPush child:\nthis.results.push(newResult);\n\n// This will: a new reference\nthis.results = [...this.results, newResult];",
    followUps: [
      { question: "What is trackBy / track for?", answer: "It tells Angular how to identify a list item, so it reuses DOM nodes instead of destroying and rebuilding the list on every change. On a long list it is the single biggest rendering win." },
    ],
    tags: ["angular", "change-detection", "onpush", "signals", "performance"],
  },
  {
    id: "ng-signals",
    topic: "frontend",
    subtopic: "Rendering",
    level: "intermediate",
    question: "What are signals, and when do you still need RxJS?",
    answer:
      "A **signal** is a value that knows who reads it. Reading it inside a template or a `computed` registers a dependency; setting it notifies exactly those dependents. No subscription, no unsubscribe, no `async` pipe.\n\n- `signal(initial)` — a writable value; `.set()`, `.update()`.\n- `computed(() => ...)` — derived, cached, recomputed only when a dependency it actually read has changed.\n- `effect(() => ...)` — a side effect when dependencies change. Use sparingly; most things that look like an effect are a `computed`.\n\nSignals are **synchronous state**. RxJS is for **asynchronous events over time**, and remains the right tool for:\n\n- HTTP with cancellation (`switchMap` to drop a superseded request),\n- debouncing user input,\n- WebSocket or SSE streams,\n- anything needing time-based operators or retry.\n\nThe modern pattern is both: RxJS at the edge for the stream, converted into a signal for the template with `toSignal()`, so the component holds state rather than a subscription.",
    language: "typescript",
    code:
      "export class ResultSearchComponent {\n  private readonly http = inject(HttpClient);\n\n  readonly query = signal('');\n  readonly patientId = signal<string | null>(null);\n\n  // RxJS where it earns its place: debounce and cancel superseded requests\n  readonly results = toSignal(\n    toObservable(this.query).pipe(\n      debounceTime(300),\n      distinctUntilChanged(),\n      switchMap(q => this.http.get<Result[]>('/api/results', { params: { q } })),\n    ),\n    { initialValue: [] as Result[] },\n  );\n\n  // Derived state: recomputed only when results or patientId change\n  readonly abnormal = computed(() => this.results().filter(r => r.flag !== 'N'));\n}",
    followUps: [
      { question: "Why is switchMap the right operator for search?", answer: "It cancels the previous request when a new one starts, so a slow earlier response cannot arrive last and overwrite the current results. mergeMap would let exactly that happen." },
    ],
    tags: ["angular", "signals", "rxjs", "computed", "state"],
  },
  {
    id: "ng-rxjs-operators",
    topic: "frontend",
    subtopic: "RxJS",
    level: "intermediate",
    mustKnow: true,
    question: "switchMap, mergeMap, concatMap, exhaustMap — which and when?",
    answer:
      "All four flatten an observable of observables. They differ only in what they do when a new outer value arrives while an inner one is still running:\n\n- **switchMap** — cancel the previous, keep the newest. **Search, autocomplete, route parameter changes.** The default for anything where only the latest matters.\n- **mergeMap** — run them all concurrently, in whatever order they finish. Independent work. Dangerous for anything order-sensitive.\n- **concatMap** — queue them, one after another, in order. Sequential writes that must not overtake each other.\n- **exhaustMap** — ignore new values while one is running. **Submit buttons**: the double-click problem solved without disabling anything.\n\nGetting this wrong produces bugs that only appear under load or on a slow network — a search box showing results for a query the user has already changed, or two records created by one impatient double-click.\n\nThe other operators worth having: `catchError` (which must return an observable, or the stream dies), `retry` with a delay, `shareReplay(1)` for a cached shared result, `takeUntilDestroyed()` for cleanup, `combineLatest` and `forkJoin`.",
    diagram:
      "  outer:   ──a───b──────────▶\n  switchMap  ──[a…✗][b…✓]        cancel a when b arrives\n  mergeMap   ──[a……✓]            both run, either may finish first\n             ────[b…✓]\n  concatMap  ──[a……✓][b…✓]       b waits for a\n  exhaustMap ──[a……✓]            b ignored while a runs",
    followUps: [
      { question: "How do you avoid memory leaks from subscriptions?", answer: "Prefer the async pipe or toSignal so the framework unsubscribes. When subscribing manually, use takeUntilDestroyed() — it is tied to the injection context and needs no manual Subject." },
    ],
    tags: ["angular", "rxjs", "switchmap", "operators", "async"],
  },
  {
    id: "ng-forms",
    topic: "frontend",
    subtopic: "Forms",
    level: "intermediate",
    question: "Template-driven or reactive forms, and how do you validate properly?",
    answer:
      "**Reactive forms** for anything real. The model is defined in TypeScript, so it is typed, testable without the DOM, and composable. **Template-driven** is fine for a login box and stops scaling immediately after.\n\nWhat matters:\n\n- **Typed forms.** `FormGroup<{ mrn: FormControl<string> }>` catches a renamed control at compile time instead of returning `undefined` at runtime.\n- **Validators are functions**, so they are testable in isolation. A custom validator returns `null` when valid and an error object when not.\n- **Cross-field validation goes on the group**, not the control — \"collected before ordered\" needs both values.\n- **Async validators** for server checks, debounced, and remember `pending` is a third state your UI must handle.\n- **Show errors when the user has finished**, not while typing: `touched && invalid`, or on submit. Validating on every keystroke tells someone their email is invalid after one character.\n- **Never trust it.** Client validation is a courtesy to the user; the server validates for correctness.",
    language: "typescript",
    code:
      "readonly form = this.fb.nonNullable.group({\n  mrn: ['', [Validators.required, Validators.pattern(/^\\d{6,10}$/)]],\n  collected: [null as Date | null, Validators.required],\n  ordered: [null as Date | null, Validators.required],\n}, { validators: collectedAfterOrdered });\n\n// Cross-field: belongs on the group, because it needs both controls\nfunction collectedAfterOrdered(group: AbstractControl): ValidationErrors | null {\n  const ordered = group.get('ordered')?.value;\n  const collected = group.get('collected')?.value;\n  if (!ordered || !collected) return null;\n  return collected < ordered ? { collectedBeforeOrdered: true } : null;\n}",
    followUps: [
      { question: "Why nonNullable?", answer: "By default reset() sets controls to null, so a typed string control is really string | null. nonNullable resets to the initial value and keeps the type honest." },
    ],
    tags: ["angular", "forms", "reactive-forms", "validation", "typed"],
  },
  {
    id: "ng-interceptors",
    topic: "frontend",
    subtopic: "HTTP",
    level: "intermediate",
    mustKnow: true,
    question: "What is an HTTP interceptor for?",
    answer:
      "It sits in the pipeline for every request, so anything cross-cutting goes there instead of into every service:\n\n- **Attaching the access token**, and refreshing it when it has expired.\n- **Correlation id** — generate one per request and send it, so a browser error can be found in the server's traces.\n- **Error handling** — turn a 401 into a redirect, a 403 into a message, a 5xx into a notification.\n- **Retry** for idempotent requests on a transient failure.\n- **A loading indicator**, by counting requests in flight.\n\nSince Angular 15 they are plain functions registered with `provideHttpClient(withInterceptors([...]))`, which makes them far easier to test — a function taking a request and a next handler.\n\nThe one non-obvious trap: on a 401, several requests may fail at once, and a naive interceptor fires several refreshes. Share one refresh (`shareReplay`) and queue the rest behind it, or the user is logged out by a race.",
    language: "typescript",
    code:
      "export const authInterceptor: HttpInterceptorFn = (req, next) => {\n  const auth = inject(AuthService);\n  const correlationId = crypto.randomUUID();\n\n  const authorised = req.clone({\n    setHeaders: {\n      Authorization: `Bearer ${auth.token()}`,\n      'X-Correlation-Id': correlationId,\n    },\n  });\n\n  return next(authorised).pipe(\n    catchError((error: HttpErrorResponse) => {\n      // One shared refresh, not one per failed request\n      if (error.status === 401) return auth.refreshOnce().pipe(switchMap(() => next(authorised)));\n      return throwError(() => error);\n    }),\n  );\n};",
    followUps: [
      { question: "Why not put the token in a service every call uses?", answer: "Because one call will forget. An interceptor cannot be forgotten, and it is one place to change when the scheme changes." },
    ],
    tags: ["angular", "http", "interceptor", "auth", "correlation"],
    relatedTools: ["jwt-decoder", "api-tester"],
  },
  {
    id: "ng-state",
    topic: "frontend",
    subtopic: "Structure",
    level: "intermediate",
    question: "How much state management does an Angular application need?",
    answer:
      "Start with **services holding signals**. A service with `providedIn: 'root'`, private writable signals and public readonly ones covers a surprising amount, is trivially testable and has no ceremony.\n\nReach for a store (NgRx, or the lighter signal stores) only when you actually have:\n\n- state shared by many unrelated components,\n- complex transitions worth making explicit,\n- a need for time-travel debugging or a strict audit of what changed,\n- a large team that benefits from one enforced pattern.\n\nWhat people get wrong is putting **server state** in a client store. Cached remote data has its own problems — staleness, refetching, invalidation, request deduplication — that a general-purpose store does not solve. Either use a query library that does, or keep it in a service that owns the caching rules.\n\nAnd distinguish the kinds of state: server cache, client UI state (which panel is open), form state, and URL state. **Put in the URL anything a user might bookmark, share or reload into** — filters, the selected patient, the current tab. That is free, shareable state most applications keep in memory and lose on refresh.",
    followUps: [
      { question: "What belongs in the URL specifically?", answer: "Anything that identifies what you are looking at: ids, filters, tab, page. If reloading the page should show the same screen, it belongs in the URL." },
    ],
    tags: ["angular", "state", "signals", "ngrx", "architecture"],
  },
  {
    id: "ng-performance",
    topic: "frontend",
    subtopic: "Rendering",
    level: "advanced",
    question: "An Angular screen is slow. Where do you look?",
    answer:
      "1. **Bundle size first**, if it is slow to *start*. Check the build stats: a stray import of a whole library, moment.js, or an eagerly-loaded feature. Lazy-load routes and defer heavy components with `@defer`.\n2. **Change detection**, if it is slow to *interact*. Profile with the Angular DevTools flame chart. The usual causes are a component tree without OnPush, and **function calls in templates** — `{{ expensiveThing() }}` runs on every check, which is the single most common Angular performance bug.\n3. **Lists.** Missing `track` means the whole list is rebuilt on any change. For thousands of rows, virtual scrolling.\n4. **Too many subscriptions**, or a stream that emits far more often than the UI needs. Debounce at the source.\n5. **Layout thrash** — reading `offsetHeight` in a loop forces a synchronous reflow each time.\n6. **The network.** Requests in series that could be parallel, no caching, no compression. Often the real answer while everyone profiles JavaScript.\n\nMeasure before changing anything. Angular's own DevTools will tell you which component is being checked and how long it takes, which beats guessing every time.",
    followUps: [
      { question: "Why are function calls in templates so bad?", answer: "Angular cannot know whether the result changed, so it calls the function on every change-detection cycle — many times a second. Use a computed signal or a pure pipe instead." },
    ],
    tags: ["angular", "performance", "bundle", "onpush", "profiling"],
  },
  {
    id: "ng-testing",
    topic: "frontend",
    subtopic: "Quality",
    level: "intermediate",
    question: "What is worth testing in an Angular application?",
    answer:
      "In order of value per hour spent:\n\n1. **Pure logic** — services, validators, mappers, pure functions. No TestBed, no DOM, milliseconds to run. Most of your bugs live here and they are the cheapest to catch.\n2. **Component behaviour**, driven the way a user drives it: render it, click, type, assert what appears. Query by role and text rather than by CSS class, so a restyle does not break the test.\n3. **HTTP**, with `HttpTestingController` — that the right URL and body went out, and that an error is handled.\n4. **A few end-to-end journeys** (Playwright or Cypress) for the critical paths: sign in, find a patient, view a result. Slow and brittle at volume, so keep them few and meaningful.\n\nWhat is not worth it: snapshot tests of templates (they break on every change and assert nothing), and testing that Angular's own bindings work.\n\nThe honest test of a test suite: does it fail when the feature breaks, and only then? A suite that fails on refactoring is a tax; a suite that passes while the screen is broken is decoration.",
    language: "typescript",
    code:
      "it('shows the abnormal flag on an out-of-range result', async () => {\n  await TestBed.configureTestingModule({ imports: [ResultRowComponent] }).compileComponents();\n\n  const fixture = TestBed.createComponent(ResultRowComponent);\n  fixture.componentRef.setInput('result', { analyte: 'HGB', value: 8.1, flag: 'L' });\n  fixture.detectChanges();\n\n  expect(fixture.nativeElement.textContent).toContain('HGB');\n  expect(fixture.nativeElement.querySelector('[data-testid=\"flag\"]')?.textContent).toBe('L');\n});",
    followUps: [
      { question: "Why query by role or test id rather than class?", answer: "Classes are styling and change freely. A test that breaks when you restyle a button teaches you nothing and trains people to ignore failures." },
    ],
    tags: ["angular", "testing", "testbed", "e2e", "quality"],
  },
  {
    id: "ng-routing",
    topic: "frontend",
    subtopic: "Structure",
    level: "intermediate",
    question: "How do routing, guards and resolvers fit together?",
    answer:
      "The router maps a URL to a component tree. Around that sit three hooks, all now plain functions rather than classes:\n\n- **Guards** decide whether navigation may proceed. `canActivate` for authorisation, `canMatch` to choose between routes (and to avoid even downloading a lazy chunk the user may not access), `canDeactivate` for \"you have unsaved changes\".\n- **Resolvers** fetch data *before* the route activates, so the component renders with data rather than with a spinner. Use them sparingly: the navigation appears frozen while they run, so anything slow is better loaded inside the component with a loading state.\n- **Route parameters** are observables, or signals with `withComponentInputBinding()`, which binds params straight to component inputs. Navigating from `/patients/1` to `/patients/2` **reuses the component** by default — if you read the parameter only in the constructor, the screen will not update. That is the classic Angular routing bug.\n\nPrefer `canMatch` over `canActivate` for lazy features: it runs before the chunk is fetched, so an unauthorised user never downloads the code.",
    language: "typescript",
    code:
      "export const routes: Routes = [\n  {\n    path: 'patients/:id',\n    loadComponent: () => import('./patient.component').then(m => m.PatientComponent),\n    canMatch: [() => inject(AuthService).hasScope('patient.read')],   // before the chunk downloads\n  },\n];\n\n// With withComponentInputBinding(), the route param arrives as an input\nexport class PatientComponent {\n  @Input() id!: string;             // updates on every navigation, unlike a constructor read\n}",
    followUps: [
      { question: "Why does the component not reload between /patients/1 and /patients/2?", answer: "The router reuses it because the route configuration is the same. React to the parameter stream (or an input) rather than reading it once at construction." },
    ],
    tags: ["angular", "routing", "guards", "resolvers", "lazy-loading"],
  },
  {
    id: "ng-di",
    topic: "frontend",
    subtopic: "Structure",
    level: "intermediate",
    question: "How does Angular's dependency injection work, and what are injection tokens for?",
    answer:
      "Angular has a hierarchical injector tree. A request for a dependency walks up from the component's injector, through its ancestors, to the root — and the first provider found wins.\n\n- **`providedIn: 'root'`** — one instance for the application, tree-shakeable if unused. The default for a service.\n- **Providing on a component** — a new instance per component instance. Useful for per-form or per-widget state, and a memory leak if you meant a singleton.\n- **Providing on a route** — one instance for that lazy feature, disposed when it is left.\n\n**Injection tokens** exist because you cannot inject an interface: TypeScript interfaces vanish at runtime. An `InjectionToken<T>` gives a runtime identity for a configuration object, a primitive or an interface-typed dependency.\n\nThe practical use in a real application is configuration and testability — the API base URL, feature flags, a clock. Injecting a clock rather than calling `new Date()` is what makes time-dependent logic testable, which is the same discipline as passing `now` into a pure function on the server.",
    language: "typescript",
    code:
      "export const API_CONFIG = new InjectionToken<ApiConfig>('API_CONFIG');\n\nbootstrapApplication(AppComponent, {\n  providers: [\n    { provide: API_CONFIG, useValue: { baseUrl: '/api', timeoutMs: 30_000 } },\n    { provide: CLOCK, useValue: { now: () => new Date() } },   // swapped in tests\n  ],\n});\n\nexport class ResultService {\n  private readonly config = inject(API_CONFIG);\n  private readonly clock = inject(CLOCK);\n}",
    followUps: [
      { question: "When would you provide a service on a component?", answer: "When each instance genuinely needs its own state — a wizard, an editable form model. Anything shared belongs higher up, or you get several copies disagreeing." },
    ],
    tags: ["angular", "dependency-injection", "injection-token", "providers", "testing"],
  },
  {
    id: "ng-templates",
    topic: "frontend",
    subtopic: "Rendering",
    level: "basic",
    question: "What is the modern template syntax, and what is @defer?",
    answer:
      "Angular 17 introduced **built-in control flow**, which replaces the structural directives:\n\n- `@if` / `@else if` / `@else` instead of `*ngIf` with `; else`.\n- `@for (item of items; track item.id)` instead of `*ngFor` — and **`track` is mandatory**, because it was the most commonly missed performance setting in the framework.\n- `@switch` / `@case`.\n- `@empty` as a block on `@for`, so the empty state lives with the list rather than in a separate `@if`.\n\nIt is not only nicer to read: it is compiled directly rather than going through a directive, so it is smaller and faster, and it does not need `CommonModule` imported.\n\n**`@defer`** lazily loads a section of a template — its components, directives and their code — on a trigger: `on viewport`, `on idle`, `on interaction`, `on hover`, `when condition`. With `@placeholder`, `@loading` and `@error` blocks it gives you a complete lazy-loading story inside a template, which previously required a route or manual dynamic imports.\n\nThat makes it the easiest real win for a heavy page: defer the chart, the comments, anything below the fold.",
    language: "typescript",
    code:
      "@for (result of results(); track result.id) {\n  <app-result-row [result]=\"result\" />\n} @empty {\n  <p>No results for this patient.</p>\n}\n\n@defer (on viewport) {\n  <app-trend-chart [results]=\"results()\" />   <!-- and its chart library -->\n} @placeholder {\n  <div class=\"skeleton\"></div>\n} @loading (minimum 200ms) {\n  <app-spinner />\n}",
    followUps: [
      { question: "Why was track made mandatory?", answer: "Because omitting trackBy silently rebuilt the entire list on every change. Making it required turns the most common performance mistake into a compile error." },
    ],
    tags: ["angular", "control-flow", "defer", "templates", "performance"],
  },
  {
    id: "ng-a11y",
    topic: "frontend",
    subtopic: "Quality",
    level: "intermediate",
    question: "What accessibility work matters in a clinical application?",
    answer:
      "Clinical software is used all day, at speed, often by people who cannot use a mouse comfortably, sometimes on a poor screen in bad light. Accessibility here is throughput, not only compliance.\n\nWhat matters most:\n\n- **Keyboard.** Every action reachable without a mouse, in a sensible tab order, with a **visible focus indicator**. Removing the focus ring for aesthetics is the single most common accessibility failure.\n- **Semantic HTML.** A `<button>` is focusable, activates on Enter and Space, and announces itself. A `<div (click)>` does none of that, and no amount of ARIA fully fixes it.\n- **Labels.** Every input has one, associated properly — not a placeholder, which disappears exactly when the user needs it.\n- **Focus management on navigation.** After a route change, move focus to the heading; otherwise a screen-reader user stays where they were and hears nothing.\n- **Live regions** for asynchronous updates, so \"result filed\" is announced rather than silently appearing.\n- **Contrast**, and never colour alone — an abnormal flag needs a symbol or text as well as red.\n- **Do not disable zoom**, and let the layout survive 200%.\n\nMost of this is also good keyboard-driven UX, which is what a clinician actually wants.",
    followUps: [
      { question: "What is the cheapest way to find problems?", answer: "Unplug the mouse and use the application. It finds missing focus indicators, unreachable actions and bad tab order in minutes." },
    ],
    tags: ["angular", "accessibility", "a11y", "keyboard", "clinical"],
  },
  {
    id: "ng-build",
    topic: "frontend",
    subtopic: "Delivery",
    level: "intermediate",
    question: "How is an Angular application configured and deployed per environment?",
    answer:
      "The important decision: **the build should not be per environment.** `environment.ts` file replacement bakes configuration into the bundle, so dev, test and production are three different artefacts, and you never deploy the one you tested.\n\nThe better pattern is **runtime configuration**: build once, and fetch a small `config.json` (or read it from an injected `<script>`) before the application bootstraps. The same bundle then runs everywhere, and changing the API URL is a file, not a rebuild.\n\nThe rest of the deployment story:\n\n- **Hashed filenames** and long cache headers for assets; `index.html` must be **no-cache**, or users run a stale application against a new API.\n- **SPA fallback** — every unknown path rewrites to `index.html`, or a deep link 404s.\n- **Compression** (brotli/gzip) and a **CSP** header.\n- **Source maps** uploaded to your error tracker but not served publicly.\n- **Budgets** in `angular.json` so a bundle-size regression fails the build rather than being noticed months later.\n\nAnd never put a secret in a frontend config. Anything the browser can read is public — the API key belongs to a backend.",
    language: "typescript",
    code:
      "// Build once, configure at runtime\nfetch('/config.json')\n  .then(r => r.json())\n  .then((config: AppConfig) =>\n    bootstrapApplication(AppComponent, {\n      providers: [{ provide: API_CONFIG, useValue: config }, provideHttpClient()],\n    }));\n\n// angular.json: a size regression fails the build\n// \"budgets\": [{ \"type\": \"initial\", \"maximumWarning\": \"500kb\", \"maximumError\": \"1mb\" }]",
    followUps: [
      { question: "Why must index.html be no-cache?", answer: "It references the hashed bundles. A cached index.html points at files that no longer exist, and the user gets a blank page until they hard-refresh." },
    ],
    tags: ["angular", "build", "configuration", "caching", "deployment"],
  },
  {
    id: "ng-security",
    topic: "frontend",
    subtopic: "Quality",
    level: "advanced",
    mustKnow: true,
    question: "What are the security concerns in a healthcare Angular application?",
    answer:
      "- **XSS.** Angular escapes interpolated values by default, which handles most of it. The risk is `[innerHTML]` and `bypassSecurityTrustHtml` — every use is a decision that needs justifying, and sanitised HTML from a clinical document is a common route in.\n- **Token storage.** `localStorage` is readable by any script on the page, so an XSS becomes a stolen session. An httpOnly cookie with SameSite is safer; if you must hold a token in memory, accept that a refresh loses it.\n- **PHI in the URL.** `/patients/100234` puts an MRN in browser history, in the referrer header, and in server and analytics logs. Prefer opaque ids.\n- **PHI in local storage or IndexedDB.** A shared clinical workstation is not a personal device. Clear on logout, and think hard before caching a record offline.\n- **Screenshots and session timeout.** Shared workstations need a short idle timeout and a lock, because the next person to sit down should not see the last patient.\n- **Authorisation is server-side.** Hiding a button is user experience, not security. The API must refuse the request regardless of what the UI shows.\n- **CSP** to limit what can execute, and dependency scanning, because a compromised npm package runs with your application's privileges.",
    followUps: [
      { question: "Is Angular's sanitisation enough on its own?", answer: "For interpolation, yes. It stops the moment you bypass it, and sanitising rich clinical text without breaking it is genuinely hard — prefer rendering structured data over trusting HTML." },
    ],
    tags: ["angular", "security", "xss", "phi", "tokens"],
  },
];
