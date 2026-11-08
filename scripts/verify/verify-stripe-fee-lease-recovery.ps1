$ErrorActionPreference = 'Stop'
$names = @('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FEE_LEASE_APPROVAL')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$pointer = [IntPtr]::Zero
$secure = $null
$exitCode = 1
try {
    $approval = Read-Host 'Confirm DEV ONLY, Cron paused/drained, all producers quiet for entire run: type DEV_ONLY_CRON_PAUSED_PRODUCERS_QUIET'
    if ($approval -cne 'DEV_ONLY_CRON_PAUSED_PRODUCERS_QUIET') { throw 'Maintenance acknowledgement required' }
    $url = Read-Host 'SUPABASE_URL (development project)'
    $secure = Read-Host 'Local service_role key (masked; never paste into chat)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    [Environment]::SetEnvironmentVariable('SUPABASE_URL', $url, 'Process')
    [Environment]::SetEnvironmentVariable('FEE_LEASE_APPROVAL', $approval, 'Process')
    [Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY', [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $pointer = [IntPtr]::Zero
    & bun run (Join-Path $PSScriptRoot 'verify-stripe-fee-lease-recovery.ts')
    $exitCode = $LASTEXITCODE
}
catch {
    Write-Host 'FAILED: keep Cron paused; investigate fixture/cleanup if execution started. No raw error output.'
    $exitCode = 1
}
finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($null -ne $secure) { $secure.Dispose() }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    $previous.Clear()
}
exit $exitCode
