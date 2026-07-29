param(
    [string]$ToolCache = (Join-Path $HOME ".cache\heliosbench-journey-tools")
)

$ErrorActionPreference = "Stop"

$TtydVersion = "1.7.7"
$TtydSha256 = "E33A27501B10B96981335BCBA938B1145C7F52551A343E72160F00AB71832B37"
$VhsVersion = "v0.11.0"
$PhenotypeRevision = "c90480645acd860a6fdbeb3404014c17f988bb72"
$FfmpegVersion = "ffmpeg version 4.2.3"
$TesseractVersion = "tesseract v5.3.0.20221222"

if (-not (Test-Path "pyproject.toml")) {
    throw "Run this script from the heliosBench repository root."
}

$ffmpegActual = (& ffmpeg -version 2>&1 | Select-Object -First 1)
$tesseractActual = (& tesseract --version 2>&1 | Select-Object -First 1)
if (-not $ffmpegActual.StartsWith($FfmpegVersion)) {
    throw "Expected $FfmpegVersion, got $ffmpegActual"
}
if (-not $tesseractActual.StartsWith($TesseractVersion)) {
    throw "Expected $TesseractVersion, got $tesseractActual"
}

$ttydDir = Join-Path $ToolCache "ttyd-$TtydVersion"
New-Item -ItemType Directory -Force -Path $ttydDir | Out-Null
$ttydDownload = Join-Path $ttydDir "ttyd.win32.exe"
$ttyd = Join-Path $ttydDir "ttyd.exe"
if (-not (Test-Path $ttydDownload)) {
    Invoke-WebRequest `
        -Uri "https://github.com/tsl0922/ttyd/releases/download/$TtydVersion/ttyd.win32.exe" `
        -OutFile $ttydDownload
}
$ttydActual = (Get-FileHash $ttydDownload -Algorithm SHA256).Hash
if ($ttydActual -ne $TtydSha256) {
    throw "ttyd checksum mismatch: expected $TtydSha256, got $ttydActual"
}
Copy-Item -Force $ttydDownload $ttyd

go install "github.com/charmbracelet/vhs@$VhsVersion"
cargo install `
    --git https://github.com/KooshaPari/phenotype-journeys `
    --rev $PhenotypeRevision `
    --locked `
    phenotype-journey

$env:PATH = "$ttydDir;$(Join-Path $HOME 'go\bin');$(Join-Path $HOME '.cargo\bin');$env:PATH"
$env:OTEL_EXPORTER_OTLP_ENDPOINT = "stdout"

if ((vhs --version) -ne "vhs version $VhsVersion") {
    throw "Unexpected VHS version."
}
if ((ttyd --version) -notmatch "ttyd version $TtydVersion") {
    throw "Unexpected ttyd version."
}

vhs docs/journeys/tapes/heliosbench-main.tape
phenotype-journey extract-keyframes `
    --recordings-dir docs/journeys/recordings `
    --keyframes-dir docs/journeys/keyframes `
    --tape heliosbench-main `
    --min-iframes 2
phenotype-journey validate docs/journeys/manifests/heliosbench-main/manifest.json
phenotype-journey assert docs/journeys/manifests/heliosbench-main/manifest.json --strict
phenotype-journey verify `
    --manifests-dir docs/journeys/manifests `
    --tapes-dir docs/journeys/tapes `
    --artefacts docs/journeys `
    --mock
phenotype-journey validate docs/journeys/manifests/heliosbench-main/manifest.verified.json
phenotype-journey assert docs/journeys/manifests/heliosbench-main/manifest.verified.json --strict

$verified = Get-Content `
    docs/journeys/manifests/heliosbench-main/manifest.verified.json `
    -Raw | ConvertFrom-Json
if (-not $verified.passed -or -not $verified.verification.all_intents_passed) {
    throw "Generated journey evidence did not pass."
}
if ($verified.verification.assertion_violations.Count -ne 0) {
    throw "Generated journey evidence contains assertion violations."
}
