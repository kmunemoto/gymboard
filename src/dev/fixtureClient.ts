/**
 * 開発用のダミー Supabase クライアント（`VITE_DEV_FIXTURES=1` のときだけ使う）。
 *
 * ## なぜ必要か
 * トレーナー側の画面はすべてログイン必須で、ローカルの `.env` は本番プロジェクトを
 * 指している。そのため「画面を見て確認する」ができず、実装はレビューとテストだけを
 * 頼りに出荷されていた（本番データを開発に使うのは論外）。
 *
 * このシムを噛ませると、ログインなし・ネットワークなしで全画面をそのまま描画できる。
 * 中身は `src/dev/fixtures.ts` の架空のジムのデータ。
 *
 * ## 何ではないか
 * PostgREST の完全な再現ではない。**画面が現実的な見た目で描画されること**が目的で、
 * RLS・トランザクション・制約・トリガーは一切再現しない。
 * ロジックの正しさは vitest（純粋関数＋コンポーネント）で担保する。
 * 未対応のクエリは黙って空配列を返すので、画面は「データなし」表示になる。
 *
 * ## 本番ビルドに入らないこと
 * 有効化の判定は `import.meta.env.DEV` を含むため、本番ビルドでは条件が定数 false に
 * 畳まれ、このモジュールごと tree-shaking で落ちる（`npm run build` の出力で確認済み）。
 */

import { buildDevFixtures, DEV_CUSTOMER_ID, DEV_OWNER_ID, DEV_TENANT_ID } from "./fixtures";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const tables = buildDevFixtures();
const rowsOf = (table: string): Row[] => (tables[table] ??= []);

const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));
const uuid = () => `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

/** PostgREST の比較はゆるいので、数値と文字列の取り違えは吸収しておく */
const looseEquals = (a: unknown, b: unknown) => a === b || String(a) === String(b);

/**
 * `select()` の指定から埋め込み（`tenants:tenant_id(...)` / `exercises(name)`）を取り出す。
 * 括弧の中はネストしないものとして扱う（実際の使用箇所はすべて1段）。
 */
function parseEmbeds(select: string): { key: string; table: string; fk: string }[] {
  const embeds: { key: string; table: string; fk: string }[] = [];
  const re = /(?:^|,)\s*(?:(\w+):)?(\w+)(?:!\w+)?\s*\(([^()]*)\)/g;
  for (let m = re.exec(select); m; m = re.exec(select)) {
    const alias = m[1];
    const name = m[2];
    if (alias) {
      // `tenants:tenant_id(...)` → 別名(=参照先テーブル) tenants を FK 列 tenant_id で引く
      embeds.push({ key: alias, table: alias, fk: name });
    } else {
      // `exercises(name)` → 参照先テーブル exercises を、単数形+_id の列で引く
      embeds.push({ key: name, table: name, fk: `${name.replace(/e?s$/, "")}_id` });
    }
  }
  return embeds;
}

/** 埋め込み先を1件くっつける（多対一のみ。一対多は使われていない） */
function applyEmbeds(row: Row, embeds: { key: string; table: string; fk: string }[]): Row {
  if (!embeds.length) return row;
  const out = { ...row };
  for (const e of embeds) {
    const target = rowsOf(e.table).find((r) => looseEquals(r.id, row[e.fk]));
    out[e.key] = target ? clone(target) : null;
  }
  return out;
}

class FixtureQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private embeds: { key: string; table: string; fk: string }[] = [];
  private sort: { column: string; asc: boolean }[] = [];
  private max: number | null = null;
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row[] = [];
  private singleMode: "none" | "one" | "maybe" = "none";
  private returnsRows = true;

  constructor(private table: string) {}

  select(cols = "*") {
    if (this.mode === "select") this.embeds = parseEmbeds(cols);
    this.returnsRows = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    this.returnsRows = false;
    return this;
  }
  upsert(values: Row | Row[]) {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.returnsRows = false;
    return this;
  }
  update(values: Row) {
    this.mode = "update";
    this.payload = [values];
    this.returnsRows = false;
    return this;
  }
  delete() {
    this.mode = "delete";
    this.returnsRows = false;
    return this;
  }

  eq(col: string, v: unknown) { return this.where((r) => looseEquals(r[col], v)); }
  neq(col: string, v: unknown) { return this.where((r) => !looseEquals(r[col], v)); }
  gt(col: string, v: unknown) { return this.where((r) => (r[col] as never) > (v as never)); }
  gte(col: string, v: unknown) { return this.where((r) => (r[col] as never) >= (v as never)); }
  lt(col: string, v: unknown) { return this.where((r) => (r[col] as never) < (v as never)); }
  lte(col: string, v: unknown) { return this.where((r) => (r[col] as never) <= (v as never)); }
  is(col: string, v: unknown) { return this.where((r) => r[col] === v); }
  in(col: string, vs: unknown[]) { return this.where((r) => vs.some((v) => looseEquals(r[col], v))); }
  like(col: string, p: string) { return this.matchLike(col, p, false); }
  ilike(col: string, p: string) { return this.matchLike(col, p, true); }
  contains() { return this; }
  match(criteria: Row) {
    for (const [col, v] of Object.entries(criteria)) this.eq(col, v);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op === "is") return this.where((r) => r[col] !== v);
    return this.where((r) => !looseEquals(r[col], v));
  }
  /** `or("a.eq.1,b.eq.2")` は未対応。絞り込まずに通す（画面が空にならない側に倒す） */
  or() { return this; }
  filter(col: string, op: string, v: unknown) {
    if (op === "eq") return this.eq(col, v);
    if (op === "neq") return this.neq(col, v);
    if (op === "gte") return this.gte(col, v);
    if (op === "lte") return this.lte(col, v);
    if (op === "gt") return this.gt(col, v);
    if (op === "lt") return this.lt(col, v);
    if (op === "in") return this;
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.sort.push({ column, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) { this.max = n; return this; }
  range(from: number, to: number) { this.max = to - from + 1; return this; }
  abortSignal() { return this; }
  throwOnError() { return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "one"; return this; }

  private where(f: Filter) { this.filters.push(f); return this; }
  private matchLike(col: string, pattern: string, ci: boolean) {
    const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, ci ? "i" : "");
    return this.where((r) => re.test(String(r[col] ?? "")));
  }

  private matches(row: Row) { return this.filters.every((f) => f(row)); }

  private run(): { data: unknown; error: null } {
    const store = rowsOf(this.table);
    let affected: Row[];

    switch (this.mode) {
      case "insert":
      case "upsert": {
        affected = this.payload.map((v) => ({ id: uuid(), created_at: new Date().toISOString(), ...v }));
        for (const row of affected) {
          const i = this.mode === "upsert" ? store.findIndex((r) => looseEquals(r.id, row.id)) : -1;
          if (i >= 0) store[i] = { ...store[i], ...row };
          else store.push(row);
        }
        break;
      }
      case "update": {
        affected = [];
        store.forEach((row, i) => {
          if (!this.matches(row)) return;
          store[i] = { ...row, ...this.payload[0] };
          affected.push(store[i]);
        });
        break;
      }
      case "delete": {
        affected = store.filter((r) => this.matches(r));
        for (const row of affected) store.splice(store.indexOf(row), 1);
        break;
      }
      default:
        affected = store.filter((r) => this.matches(r));
    }

    let out = affected.map((r) => applyEmbeds(clone(r), this.embeds));
    for (const s of [...this.sort].reverse()) {
      out.sort((a, b) => {
        const av = a[s.column] as never;
        const bv = b[s.column] as never;
        return (av < bv ? -1 : av > bv ? 1 : 0) * (s.asc ? 1 : -1);
      });
    }
    if (this.max != null) out = out.slice(0, this.max);

    if (this.singleMode !== "none") return { data: out[0] ?? null, error: null };
    // insert/update/delete で .select() を呼んでいない場合、supabase は data:null を返す
    return { data: this.returnsRows || this.mode === "select" ? out : null, error: null };
  }

  then<R1 = { data: unknown; error: null }, R2 = never>(
    onFulfilled?: ((v: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

/**
 * ジム側とお客様側、どちらとしてログインするか。
 * ブラウザのコンソールで切り替えられる:
 *   localStorage.setItem("devFixtureRole", "customer"); location.reload()
 * 既定はジム（オーナー）側。お客様側の画面も確認できないと片手落ちなので用意している。
 */
const devRole = (() => {
  try {
    return localStorage.getItem("devFixtureRole") === "customer" ? "customer" : "trainer";
  } catch {
    return "trainer";
  }
})();

const DEV_USER = {
  id: devRole === "customer" ? DEV_CUSTOMER_ID : DEV_OWNER_ID,
  email: devRole === "customer" ? "customer@demo.example.com" : "owner@demo.example.com",
  user_metadata: {
    role: devRole,
    display_name: devRole === "customer" ? "田中 花子" : "デモ オーナー",
  },
  app_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
  email_confirmed_at: new Date().toISOString(),
};

const DEV_SESSION = {
  access_token: "dev-fixture-token",
  refresh_token: "dev-fixture-refresh",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: DEV_USER,
};

/** RPC の戻り値。画面が使うものだけ用意し、未知の RPC は null を返す */
const RPC_RESULTS: Record<string, () => unknown> = {
  get_my_tenant_invite_code: () => rowsOf("tenants")[0]?.invite_code ?? "DEMO1234",
  get_tenant_public: () => [clone(rowsOf("tenants")[0])],
  lookup_tenant_by_invite_code: () => [{ tenant_id: DEV_TENANT_ID }],
  get_tenant_booked_slots: () => [],
  // 上限はフィクスチャのテナント行から引く。ここに数値を直書きすると、プラン定義
  // （src/lib/gymboardPlans.ts）を変えたときにプランカードの「N名まで」と
  // 上限バナーの数字が dev:fixtures 上だけ食い違う（実際に 50 のまま取り残されていた）。
  get_tenant_limit_status: () => {
    const t = rowsOf("tenants")[0] as { max_customers?: number | null } | undefined;
    return [{ max_customers: t?.max_customers ?? null, current_customers: 4, is_over_limit: false }];
  },
};

export function createFixtureClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noopChannel: any = {
    on: () => noopChannel,
    subscribe: () => noopChannel,
    unsubscribe: () => Promise.resolve("ok"),
    send: () => Promise.resolve("ok"),
  };

  return {
    from: (table: string) => new FixtureQuery(table),
    rpc: (name: string) => Promise.resolve({ data: RPC_RESULTS[name]?.() ?? null, error: null }),
    channel: () => noopChannel,
    removeChannel: () => Promise.resolve("ok"),
    removeAllChannels: () => Promise.resolve([]),
    functions: {
      invoke: (name: string) => {
        console.info(`[dev-fixtures] functions.invoke("${name}") は呼ばずにスキップしました`);
        return Promise.resolve({ data: null, error: null });
      },
    },
    storage: {
      from: () => ({
        list: () => Promise.resolve({ data: [], error: null }),
        upload: () => Promise.resolve({ data: { path: "dev/placeholder.png" }, error: null }),
        remove: () => Promise.resolve({ data: [], error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `/${path}` } }),
      }),
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: DEV_SESSION }, error: null }),
      getUser: () => Promise.resolve({ data: { user: DEV_USER }, error: null }),
      signInWithPassword: () => Promise.resolve({ data: { session: DEV_SESSION, user: DEV_USER }, error: null }),
      signUp: () => Promise.resolve({ data: { session: DEV_SESSION, user: DEV_USER }, error: null }),
      signInWithOAuth: () => Promise.resolve({ data: null, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      resetPasswordForEmail: () => Promise.resolve({ data: null, error: null }),
      updateUser: () => Promise.resolve({ data: { user: DEV_USER }, error: null }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        // 実クライアントと同じく、購読直後に現在の状態を1回流す
        setTimeout(() => cb("INITIAL_SESSION", DEV_SESSION), 0);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
}
