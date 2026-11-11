# Packages the extension as a .vsix without needing Node.js / vsce.
# Usage:  pwsh ./build-vsix.ps1      then:  code --install-extension .\xpp-language-tools-<version>.vsix
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$out = Join-Path $root "$($pkg.name)-$($pkg.version).vsix"
$include = @('package.json', 'extension.js', 'language-configuration.json', 'xml-language-configuration.json',
             'README.md', 'CHANGELOG.md', 'LICENSE.txt', 'src', 'syntaxes', 'images')

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$([System.Security.SecurityElement]::Escape($pkg.description))</Description>
    <Tags>$([System.Security.SecurityElement]::Escape(($pkg.keywords -join ',')))</Tags>
    <Categories>$([System.Security.SecurityElement]::Escape(($pkg.categories -join ',')))</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Icon>extension/$($pkg.icon)</Icon>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/$($pkg.icon)" Addressable="true" />
  </Assets>
</PackageManifest>
"@

$contentTypes = @"
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
"@

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
if (Test-Path $out) { Remove-Item $out }
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($pair in @(@('extension.vsixmanifest', $manifest), @('[Content_Types].xml', $contentTypes))) {
        $writer = New-Object System.IO.StreamWriter($zip.CreateEntry($pair[0]).Open(), $utf8)
        $writer.Write($pair[1]); $writer.Dispose()
    }
    foreach ($item in $include) {
        $full = Join-Path $root $item
        if (-not (Test-Path $full)) { throw "Missing file: $item" }
        $files = if ((Get-Item $full).PSIsContainer) { Get-ChildItem $full -Recurse -File } else { Get-Item $full }
        foreach ($f in $files) {
            $rel = [System.IO.Path]::GetRelativePath($root, $f.FullName).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, "extension/$rel") | Out-Null
        }
    }
} finally {
    $zip.Dispose()
}
Write-Host "Created $out"
