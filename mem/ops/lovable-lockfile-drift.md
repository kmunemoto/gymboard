# Lovable のコミットが package-lock.json をずらす（PR の CI では捕まらない）

2026-08-12、ストレッチボード（Lovable 由来の兄弟アプリ）で
**`main` の `npm ci` が壊れ、以後すべての PR の CI が落ちる**状態になっていた。

**ジムボード自身は 2026-08-12 時点で健全**（`npm ci --dry-run` 通過）。
ただし発生の仕組みは Lovable と GitHub を同期している全アプリに当てはまるので記録する。

## 症状

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: @mediapipe/pose@0.5.1675469404 from lock file
npm error Missing: @tensorflow/tfjs-backend-wasm@4.22.0 from lock file
npm error Missing: @tensorflow/tfjs-backend-webgpu@4.22.0 from lock file
npm error Missing: @types/emscripten@0.0.34 from lock file
```

ジョブは **16秒**で落ちる。`npm ci` の段階なので、テストもビルドも1つも走らない。

⚠️ **Actions の枠切れ（5秒で `conclusion: failure` / `steps: []`）とは別物。**
こちらはステップ一覧が出て、ログに上の EUSAGE が残る（`mem/ops/actions-cost.md`）。

## 原因（コミット単位で特定した）

`package.json` 側は何も足されていない。**Lovable が lock を書き直したときに落とした。**
`@tensorflow/tfjs` はリポジトリの初回コミットから入っており、今回新しく増えた依存ではない。
消えた4件はいずれも**推移的依存**で、`package.json` を見ても気づけない。

各コミットで lock の項目数と欠落を数えた結果:

| コミット | 欠落 | lock 項目数 | 内容 |
|---|---|---|---|
| `f08045c` | 0 | **926** | 通常の PR マージ |
| `1c5ee6a` | 0 | 926 | 通常の PR マージ（#23） |
| **`0d3cd8c`** | **4** | **923** | **Lovable の "Changes"** ← ここで落ちた |
| `a2ab76c` 〜 `d4460f9` | 4 | 923 | 以後ずっと欠けたまま |

## 🔴 なぜ PR の CI をすり抜けるか

**ずれは PR ではなく `main` に直接入る。** Lovable は `main` へ直接 push するため、
PR の差分には lock の変更が1行も現れない。

そして **PR のブランチはずれる前の `main` から作られている**ので、
PR の CI は**壊れていない lock で回って緑になる**。

```
c430df1 ✅ ── PR #23 のブランチはここから分岐 → CI 緑 → マージ
1c5ee6a ✅
0d3cd8c ❌ ← Lovable が直接 push。ここで lock が壊れる
   :
d4460f9 ❌
ac6316d ❌ ← PR #24（ブランチは分岐前＝緑）をマージ。main は壊れたまま
```

**「PR の CI が緑」は「マージ後の main が緑」を意味しない。**
PR が触っていないファイルが原因なので、差分をいくら見ても分からない。

## 🔴 本当の見落としはここ

`ci.yml` は **`push: branches: [main]` でも回る**。つまり **main の CI は実際に赤くなっていた。**

```
2026-08-11 14:36  1c5ee6a  success
2026-08-11 15:29  d4460f9  failure   ← ここから赤
2026-08-11 15:29  ac6316d  failure
2026-08-12 01:01  67ca706  success   ← 修正
```

**番人は鳴っていた。誰も見ていなかっただけ。** main の CI は何もブロックしないので、
赤いまま放置されても次の PR を出すまで誰も困らない。そして次に PR を出した人が、
自分の変更と何の関係もない `npm ci` 失敗を踏む。

さらに `concurrency: cancel-in-progress: true` があるため、Lovable が短時間に
連続 push すると**中間コミットの run は取り消される**。上の表で `0d3cd8c` 自身の
run が残っていないのはそのため。**最初に壊れたコミットと、最初に赤くなった run は
一致しない。** run の履歴だけ見て犯人を決めないこと。

## やること

**マージした後、その PR の CI ではなく `main` の CI を見る。**
squash マージは新しいコミットを作るので、**PR で緑だった組み合わせは main には存在しない。**
main の run が緑になって初めて終わり。

直し方（依存のバージョンは上がらない）:

```bash
npm install          # lock を package.json に合わせるだけ
git add package-lock.json
```

確認は**クリーンな clone で**行う。手元の `node_modules` があると `npm ci` の
同期チェックの結果を誤読する（`npm install` が "up to date" と言っても、
lock には差分が出ていることがある）。

```bash
git clone --depth 1 --branch main <repo> /tmp/probe && cd /tmp/probe
npm ci        # ここが通れば直っている
```

`npm ci --dry-run` でも同期チェックは走るので、確認だけならこちらが速い。

⚠️ **`git checkout -- package-lock.json` で「ノイズだから」と戻さないこと。**
`npm install` が出す差分は `"dev": true` の付け外しが大半で、その中に
**不足エントリの追加が混ざっている**。先頭20行だけ見て判断すると取りこぼす。
判断するなら、消えていた項目が入ったかを名前で数える:

```bash
for p in @mediapipe/pose @types/emscripten; do
  echo "$p: $(grep -c "\"node_modules/$p\"" package-lock.json)"
done
```

## 定期的に見るなら

lock のずれは静かに入るので、気づく仕組みを置くなら `npm ci --dry-run` を
CI に足すより、**main の run が赤いまま放置されていないかを見る**方が効く
（今回、検査自体は既に存在していて動いていた）。
