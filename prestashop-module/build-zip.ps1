#Requires -Version 5.1
# Empaqueta el modulo PrestaShop con separadores / (valido para subir en backoffice).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$moduleDir = Join-Path $PSScriptRoot 'chatbotiagardenweb'
$moduleName = 'chatbotiagardenweb'
$zipPath = Join-Path $root 'chatbotiagardenweb.zip'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    Get-ChildItem -Path $moduleDir -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($moduleDir.Length + 1) -replace '\\', '/'
        $entryName = "$moduleName/$relative"
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName)
    }
}
finally {
    $zip.Dispose()
}

Write-Host "Created $zipPath"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::OpenRead($zipPath).Entries | ForEach-Object { $_.FullName }
