# .bat が LF だと cmd がスクリプトを壊して読む（2026-08-22）

宗本さんの Windows で `scripts\build-android.bat` が化けた文字列を実行しようとして
「内部コマンドまたは外部コマンドとして認識されていません」を2件出していた。
調べたら**スクリプトの約1/4が一度も実行されていなかった**。

## 仕組み

`.bat` は UTF-8（日本語コメント入り）で保存されているが、**cmd.exe は CP932 として読む**。
日本語行の行末バイトが `0x81-0x9F` / `0xE0-0xFC` に化けると、cmd はそれを
「2バイト文字の1バイト目」とみなし、**次の1バイトを無条件に2バイト目として飲む**。

- **行末が LF**（`0x0A`）… 飲まれるのは**改行そのもの**。行が消えて、次の行が
  前の `REM` / `echo` に飲み込まれる → **その行は実行されない**
- **行末が CRLF** … 飲まれるのは `CR`（`0x0D`）。`LF` が残るので改行は保たれる

## 実際の被害（71行 → 54行に潰れていた）

| 飲まれていた行 | 何が起きるか |
|---|---|
| `git checkout -- package-lock.json` / `mcp/index.ts` | 2回目以降の `git pull` が止まる（そもそもこの掃除を足した理由の行が消えていた） |
| `call npm install @mediapipe/pose ...` | optional peer が入らず build が落ちる |
| 🔴 `call npm run build` | **web の dist が更新されない＝古い中身で AAB ができる** |
| `findstr /C:"versionCode"` | ビルド後の版数表示が出ない |

🔴 **いちばん気づけない壊れ方**。ビルドは最後まで通り、AAB もできる。
中身が古いことは Play に上げて動かすまで分からない。

## 対処

1. `scripts/build-android.bat` を **CRLF** で保存（変換済み）
2. `.gitattributes` に `*.bat -text`（改行を変換せずリポジトリにも CRLF を保存。
   `text eol=crlf` ではなく `-text` にしたのは、ファイルを見れば分かる状態にするため）
3. `.bat` の先頭に英語で警告コメント（日本語だとこの問題自体で読めなくなる）
4. `src/test/buildAndroidScript.test.ts` に見張りを3件追加:
   - CRLF であること（CR を伴わない LF が1つでもあれば赤）
   - `.gitattributes` の `*.bat -text` が消えていないこと
   - **cmd の読み方をバイト単位で再現**して、9個の主要コマンドが行頭に立つこと
   変異3種（LF に戻す／`.gitattributes` の指定を外す／`npm run build` の行を消す）
   すべてで赤になることを確認済み

## 同時に起きていた別のエラー（こちらは環境）

```
fatal: unable to access 'https://github.com/kmunemoto/gymboard.git/':
Could not resolve host: github.com
```

これは **DNS が引けていない＝その PC のネットワークの問題**。`git pull || goto :err`
なので、ここで `[build-android] FAILED` になっていた。コードの問題ではない。
`ping github.com` / `nslookup github.com` で切り分ける（VPN・Wi-Fi・DNS 設定）。

## .ps1 も同じ地雷を踏んでいた（同日に発見）

`scripts/setup-android-secrets.ps1` も **LF ＋ BOM なし ＋ 日本語コメント**だった。
**Windows PowerShell 5.1**（`powershell.exe`＝Windows の既定）は BOM の無いファイルを
ANSI（日本語環境では CP932）として読むため、`.bat` とまったく同じ現象が起きる。
実測で **192行 → 171行**に潰れ、`$tmp = [IO.Path]::GetTempFileName()` や
`keytool` の実行行が丸ごと消えていた。

根治は **UTF-8 BOM を付けること**（PowerShell が UTF-8 として読む）。CRLF も併せて固定。
PowerShell 7+（`pwsh`）は BOM 無しでも UTF-8 なので、BOM があれば両方で正しく読める。
`.gitattributes` に `*.ps1 -text`、見張りは同じテストファイルに3件追加（BOM／CRLF／
`.gitattributes` の指定）。変異2種（BOM を外す／LF に戻す）で赤を確認。

⚠️ このスクリプトは Android CI（`android-build.yml`）用で、その CI 自体は使っていない。
つまり**壊れていても誰も気づけない位置**にあった。使うときが来たら直っている。

## この問題の影響範囲（2026-08-22 に確認）

| | 影響 | 理由 |
|---|---|---|
| **Android のビルド** | 🔴 **あり**（直した） | Windows の cmd / PowerShell がスクリプトを読むのはここだけ |
| **iOS のビルド** | 無し | GitHub Actions の macOS ランナーで動き、`npm run build` を自分で実行する（`ios-build.yml`）。cmd も CP932 も介在しない |
| **Web（Lovable）** | 無し | Lovable のクラウドでビルドする |
| **本番DB・Edge Function** | 無し | スクリプトを通らない |

つまり**「Windows で人が叩くスクリプト」だけの問題**。ジムボードではそれが
Android の経路にしか無いので、結果として Android 専用の問題になっている。

## 兄弟アプリへ

同じ `.bat` を持っているなら**必ず同じ確認をすること**。症状が出ていなくても、
日本語コメントの行末バイト次第で「たまたま無事」なだけの可能性がある。
