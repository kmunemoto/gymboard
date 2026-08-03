# Windows で実行して、Android CI 用の GitHub Secrets を登録するスクリプト。
#
# 手で base64 化したり値をコピペしたりしなくて済むようにするためのもの。
# 5つ（GOOGLE_SERVICES_JSON_BASE64 / ANDROID_KEYSTORE_BASE64 /
# ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD）を扱う。
#
# GOOGLE_PLAY_SERVICE_ACCOUNT_JSON だけは Play Console と Google Cloud の
# 画面操作が要るのでこのスクリプトの対象外。手順は mem/features/android-ci.md を参照。
#
# 使い方（リポジトリのルートで）:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-android-secrets.ps1
#
# 前提:
#   - GitHub CLI (gh) が入っていて `gh auth login` 済み
#     （無い場合はクリップボード経由の手動モードに自動で切り替わる）
#   - Android Studio が入っている（keytool を使うため）
#
# このスクリプトは Secret の値を画面に出さない。

param(
  [string]$Repo = "kmunemoto/gymboard",
  [string]$KeystorePath = "",
  [string]$GoogleServicesPath = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "`nエラー: $msg" -ForegroundColor Red; exit 1 }

# --- gh の有無を確認 --------------------------------------------------------
$useGh = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
  try {
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $useGh = $true }
  } catch { }
}
if ($useGh) {
  Write-Ok "GitHub CLI が使えます。Secrets を自動登録します（リポジトリ: $Repo）"
} else {
  Write-Warn2 "GitHub CLI が無いか未ログインです。クリップボード経由の手動モードで進めます。"
  Write-Warn2 "自動登録したい場合は https://cli.github.com/ を入れて `gh auth login` してください。"
}

# --- 値を Secret に登録する（値は画面に出さない） ---------------------------
function Set-Secret($name, $value) {
  if ($useGh) {
    # 値をコマンドライン引数に置かない（プロセス一覧に出るため）。
    # 一時ファイル経由で stdin に流し、直後に消す。
    $tmp = [IO.Path]::GetTempFileName()
    try {
      [IO.File]::WriteAllText($tmp, $value, (New-Object Text.UTF8Encoding $false))
      cmd /c "gh secret set $name --repo $Repo < `"$tmp`"" | Out-Null
      if ($LASTEXITCODE -ne 0) { Fail "gh secret set $name に失敗しました" }
      Write-Ok "$name を登録しました"
    } finally {
      if (Test-Path $tmp) { Remove-Item $tmp -Force }
    }
  } else {
    Set-Clipboard -Value $value
    Write-Host "  → $name の値をクリップボードにコピーしました。" -ForegroundColor Yellow
    Write-Host "     https://github.com/$Repo/settings/secrets/actions で" -ForegroundColor Yellow
    Write-Host "     New repository secret → Name に $name を入れて貼り付け → Add secret" -ForegroundColor Yellow
    Read-Host "     登録したら Enter を押してください"
  }
}

# --- 1. google-services.json ------------------------------------------------
Write-Step "1/5 GOOGLE_SERVICES_JSON_BASE64"

if (-not $GoogleServicesPath) {
  $candidates = @(
    "android\app\google-services.json",
    "google-services.json"
  ) | Where-Object { Test-Path $_ }
  if ($candidates.Count -gt 0) { $GoogleServicesPath = $candidates[0] }
}
if (-not $GoogleServicesPath -or -not (Test-Path $GoogleServicesPath)) {
  Write-Warn2 "google-services.json が見つかりません。"
  Write-Warn2 "Firebase コンソール → プロジェクトの設定 → マイアプリ → Android → ダウンロード"
  $GoogleServicesPath = Read-Host "  google-services.json のフルパスを入力してください"
}
if (-not (Test-Path $GoogleServicesPath)) { Fail "ファイルが見つかりません: $GoogleServicesPath" }

# 中身が正しいアプリのものか確認する（別アプリのものを掴む事故を防ぐ）
$gs = Get-Content $GoogleServicesPath -Raw | ConvertFrom-Json
$pkgs = @($gs.client | ForEach-Object { $_.client_info.android_client_info.package_name })
if ($pkgs -notcontains "app.gymboard.mobile") {
  Fail ("この google-services.json には app.gymboard.mobile が入っていません。" +
        "含まれているのは: " + ($pkgs -join ", "))
}
Write-Ok "app.gymboard.mobile が含まれています ($GoogleServicesPath)"

$gsB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $GoogleServicesPath)))
Set-Secret "GOOGLE_SERVICES_JSON_BASE64" $gsB64

# --- 2. キーストア ----------------------------------------------------------
Write-Step "2/5 ANDROID_KEYSTORE_BASE64"

Write-Host "  Android Studio の署名ウィザードで使っている .jks / .keystore を指定してください。" -ForegroundColor Gray
Write-Host "  Build → Generate Signed App Bundle / APK の「Key store path」に出ているパスです。" -ForegroundColor Gray
Write-Host "  ⚠️ 新しく作らないこと。Play Store の署名は原則変更できません。" -ForegroundColor Yellow

if (-not $KeystorePath) { $KeystorePath = Read-Host "  キーストアのフルパス" }
$KeystorePath = $KeystorePath.Trim('"')
if (-not (Test-Path $KeystorePath)) { Fail "ファイルが見つかりません: $KeystorePath" }

# --- 3-5. パスワードとエイリアス（keytool で実際に開けるか確認する）---------
Write-Step "3/5 ANDROID_KEYSTORE_PASSWORD / 4-5. エイリアスとキーのパスワード"

$keytool = @(
  "$env:ProgramFiles\Android\Android Studio\jbr\bin\keytool.exe",
  "$env:ProgramFiles\Android\Android Studio\jre\bin\keytool.exe",
  "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\keytool.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $keytool) {
  if (Get-Command keytool -ErrorAction SilentlyContinue) { $keytool = "keytool" }
  else { Fail "keytool が見つかりません。Android Studio 同梱のものを使います（jbr\bin\keytool.exe）" }
}
Write-Ok "keytool: $keytool"

$storePassSecure = Read-Host "  ストアのパスワード" -AsSecureString
$storePass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePassSecure))

# パスワードが正しいかをここで確かめる。間違っていればCIを回す前に分かる。
$listOut = & $keytool -list -keystore $KeystorePath -storepass $storePass 2>&1
if ($LASTEXITCODE -ne 0) {
  Fail "キーストアを開けませんでした。パスワードが違うか、ファイルがキーストアではありません。"
}
Write-Ok "キーストアを開けました"

# エイリアスを抽出する（日本語/英語ロケール両対応）
$aliases = @($listOut | Select-String -Pattern '^(.+?),\s.*(PrivateKeyEntry|秘密鍵エントリ)' |
  ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() })

if ($aliases.Count -eq 0) {
  Write-Warn2 "エイリアスを自動抽出できませんでした。以下の一覧から選んでください:"
  $listOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
  $alias = Read-Host "  エイリアス名"
} elseif ($aliases.Count -eq 1) {
  $alias = $aliases[0]
  Write-Ok "エイリアス: $alias"
} else {
  Write-Host "  複数のエイリアスがあります:" -ForegroundColor Yellow
  for ($i = 0; $i -lt $aliases.Count; $i++) { Write-Host "    [$i] $($aliases[$i])" }
  $idx = Read-Host "  使うエイリアスの番号"
  $alias = $aliases[[int]$idx]
}

$keyPassSecure = Read-Host "  キーのパスワード（ストアと同じなら空Enter）" -AsSecureString
$keyPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPassSecure))
if (-not $keyPass) { $keyPass = $storePass; Write-Ok "ストアのパスワードと同じものを使います" }

# キーのパスワードも実際に確かめる
& $keytool -list -keystore $KeystorePath -storepass $storePass -alias $alias -keypass $keyPass 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Fail "エイリアス '$alias' をキーのパスワードで開けませんでした。パスワードを確認してください。"
}
Write-Ok "エイリアスとキーのパスワードを確認しました"

$ksB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $KeystorePath)))
Set-Secret "ANDROID_KEYSTORE_BASE64" $ksB64
Set-Secret "ANDROID_KEYSTORE_PASSWORD" $storePass
Set-Secret "ANDROID_KEY_ALIAS" $alias
Set-Secret "ANDROID_KEY_PASSWORD" $keyPass

# --- 残り1つの案内 ----------------------------------------------------------
Write-Step "残り: GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"
Write-Host @"
  この1つだけは Play Console と Google Cloud の画面操作が必要なので、
  このスクリプトでは扱えません。手順は mem/features/android-ci.md の
  「6. GOOGLE_PLAY_SERVICE_ACCOUNT_JSON」を参照してください。

  要点:
    - Play Console のトップ（全アプリ画面）→ 設定 → デベロッパーアカウント → API アクセス
    - サービスアカウントを作成 → Cloud Console で JSON 鍵をダウンロード
    - **Play Console に戻って「更新」を押す**（これを忘れると一覧に出ません）
    - app.gymboard.mobile に「リリース」系の権限を付与
    - JSON の中身を **base64 化せず** そのまま貼る

  6つ揃ったら GitHub → Actions → Android Build & Upload → Run workflow
  （track は internal のまま）で実行してください。
"@ -ForegroundColor Gray

Write-Host "`n完了しました。" -ForegroundColor Green
