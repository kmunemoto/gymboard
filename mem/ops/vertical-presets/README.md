# 業種プリセット

兄弟アプリ（業種特化フォーク）に流し込む**値の束**を、業種ごとに1セットずつ置いておく場所。

`mem/ops/vertical-fork.md` が「どう分岐させるか（手順）」で、ここは「何を入れるか（中身）」。

## なぜ GymBoard 本体に置くのか

Phase 0 で、業種差分は**数個のファイルの値**に追い出してある
（`src/lib/brand.ts` / `src/lib/featureFlags.ts` / `src/locales/vertical.ja.json`）。
つまり業種特化は「コードを書く作業」ではなく「値を決める作業」になった。

その値を各フォークのチャットで毎回考え直すと、業種ごとに品質がばらつき、
上流が文言キーを増減させたときに誰も気づけない。だから**上流に置いて上流で守る**。

`src/test/verticalPresets.test.ts` が、プリセットのキーが `src/locales/ja.json` に
実在することを検査している。上流でキーをリネーム/削除すると、プリセットが古くなった
時点でテストが落ちる。

## 一覧

| プリセット | 業種 | 対応アプリ | 状況 |
|---|---|---|---|
| `personal-stretch` | パーソナルストレッチ専門店 | ストレッチボード | **適用済み**（PR #1）。残タスクは `personal-stretch.md` |
| `sekkotsu` | 接骨院・整骨院 | セッコツボード | **語彙は適用済み**（ただし `ja.json` を直接書き換えた形）。移行と残タスクは `sekkotsu.md` |
| `pilates` | パーソナルピラティス | ピラボード | プリセット用意済み・**未適用**（上流未取り込みのため適用不可。まず merge が先。`pilates.md` 参照） |
| `golf` | ゴルフレッスン | ゴルフボード | プリセット用意済み・**未適用**。語彙は `ja.json` から機械生成（120葉）。`golf.md` 参照 |

`sekkotsu` にオーバーレイの JSON が無いのは、セッコツボードが `ja.json` を
**直接書き換えてしまっている**ため。まず `scripts/extract-vertical-overlay.mjs` で
実物から抜き出す（`sekkotsu.md` 参照）。抜き出したものをここに置けば、
以後は他のプリセットと同じ扱いになる。

## 使い方（フォーク側で）

1. まず上流に追従する（`mem/ops/vertical-fork.md` の「上流を追従する」）。
   Phase 0 が入っていないフォークには `vertical.ja.json` 自体が無いので、先にこれをやる。
2. `<preset>.vertical.ja.json` を、フォークの `src/locales/vertical.ja.json` に**丸ごとコピー**する。
3. `<preset>.md` の「brand.ts」「featureFlags.ts」の表のとおりに値を書き換える。
4. `<preset>.md` の「まだ決まっていない値」を埋める（独自ドメイン・Firebase など）。

GymBoard 本体の `src/locales/vertical.ja.json` は**常に空 `{}`**。
ここのプリセットは本体のビルドには一切入らない（`mem/` はコンパイル対象外）。
