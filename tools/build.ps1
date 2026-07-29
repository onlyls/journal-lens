param(
  [ValidateSet("release", "debug")]
  [string]$Channel = "release",

  [ValidateSet("edge", "firefox", "chromium")]
  [string]$Browser = "edge",

  [switch]$NoZip,

  [string]$FirefoxId = "journal-lens@lyusai.local"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot "extension"
$distRoot = Join-Path $projectRoot "releases"
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourceRoot "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$sourceManifest.version
$outName = "journal-lens-$version-$Browser-$Channel"
$outDir = Join-Path $distRoot $outName
$zipPath = "$outDir.zip"

function Assert-Inside([string]$child, [string]$parent) {
  $childFull = [System.IO.Path]::GetFullPath($child)
  $parentFull = [System.IO.Path]::GetFullPath($parent)
  if (-not $parentFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $parentFull += [System.IO.Path]::DirectorySeparatorChar
  }
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside releases: $childFull"
  }
}

function Write-Utf8([string]$path, [string]$content) {
  Set-Content -LiteralPath $path -Value $content -Encoding UTF8
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
Assert-Inside $outDir $distRoot
if (Test-Path -LiteralPath $outDir) {
  Remove-Item -LiteralPath $outDir -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
New-Item -ItemType Directory -Path $outDir | Out-Null

# Do not bundle downloaded ShowJCR CSV metadata; users load it at runtime.
$includeDirs = @("assets", "content", "options", "popup", "src")
foreach ($dir in $includeDirs) {
  Copy-Item -LiteralPath (Join-Path $sourceRoot $dir) -Destination (Join-Path $outDir $dir) -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $sourceRoot "manifest.json") -Destination (Join-Path $outDir "manifest.json") -Force

$enableDebug = if ($Channel -eq "debug") { "true" } else { "false" }
Write-Utf8 (Join-Path $outDir "src\build-flags.js") @"
(() => {
  "use strict";

  globalThis.JournalLensBuild = {
    channel: "$Channel",
    browser: "$Browser",
    version: "$version",
    enableDebug: $enableDebug
  };
})();
"@

$manifestPath = Join-Path $outDir "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.name = if ($Channel -eq "debug") { "Journal Lens Debug" } else { "Journal Lens" }
$manifest.description = if ($Channel -eq "debug") {
  "Journal Lens development build with optional debug diagnostics."
} else {
  "Journal metrics and explicit literature lookup controls for academic websites."
}
if ($manifest.PSObject.Properties.Name -contains "version_name") {
  $manifest.version_name = if ($Channel -eq "debug") { "$version-debug" } else { $version }
}

foreach ($script in @($manifest.content_scripts)) {
  $scripts = @($script.js)
  if ($scripts -notcontains "src/build-flags.js") {
    $script.js = @("src/build-flags.js") + $scripts
  }
}

if ($Browser -eq "firefox") {
  [void]$manifest.PSObject.Properties.Remove("minimum_chrome_version")
  [void]$manifest.PSObject.Properties.Remove("version_name")
  $manifest.background | Add-Member -Force -NotePropertyName "scripts" -NotePropertyValue @("src/background.js")
  $manifest | Add-Member -Force -NotePropertyName "browser_specific_settings" -NotePropertyValue ([pscustomobject]@{
    gecko = [pscustomobject]@{
      id = $FirefoxId
      strict_min_version = "140.0"
      data_collection_permissions = [pscustomobject]@{
        required = @("websiteContent", "authenticationInfo")
      }
    }
    gecko_android = [pscustomobject]@{
      strict_min_version = "142.0"
    }
  })

  $backgroundPath = Join-Path $outDir "src\background.js"
  $backgroundText = Get-Content -LiteralPath $backgroundPath -Raw -Encoding UTF8
  $backgroundText = $backgroundText.Replace("return chrome.storage.session || chrome.storage.local;", "return chrome.storage.local;")
  Write-Utf8 $backgroundPath $backgroundText
}

$manifest | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

if ($Channel -eq "release") {
  $optionsPath = Join-Path $outDir "options\options.html"
  $optionsHtml = Get-Content -LiteralPath $optionsPath -Raw -Encoding UTF8
  $pattern = '\r?\n\s*<label class="switch">\s*<input id="debugMode" type="checkbox">\s*<span>Debug 模式</span>\s*</label>'
  $optionsHtml = [System.Text.RegularExpressions.Regex]::Replace(
    $optionsHtml,
    $pattern,
    "",
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  Write-Utf8 $optionsPath $optionsHtml
}

if (-not $NoZip) {
  Push-Location $outDir
  try {
    Compress-Archive -Path * -DestinationPath $zipPath -Force
  } finally {
    Pop-Location
  }
}

[pscustomobject]@{
  Channel = $Channel
  Browser = $Browser
  Version = $version
  Directory = $outDir
  Zip = if ($NoZip) { $null } else { $zipPath }
  DebugEnabled = ($Channel -eq "debug")
} | ConvertTo-Json -Compress



