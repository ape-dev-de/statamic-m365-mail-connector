<#
  Per-customer onboarding for the Ape Dev M365 connector.

  Run ONCE per customer tenant. Requires:
    - Global Admin of the CUSTOMER tenant for the consent step.
    - Exchange admin + ExchangeOnlineManagement module for the access-policy step.

  What it does:
    1. Prints the admin-consent URL. Opening it provisions the connector's service
       principal in the customer tenant and grants Mail.Send (application).
    2. Restricts the app to a SINGLE mailbox via an Application Access Policy, so it
       cannot send as any other mailbox in the tenant.
#>
param(
  [Parameter(Mandatory)] [string] $ClientId,         # terraform output: client_id
  [Parameter(Mandatory)] [string] $CustomerTenantId, # customer tenant GUID or verified domain
  [Parameter(Mandatory)] [string] $Mailbox           # e.g. kontakt@festglanz.de
)

Write-Host "STEP 1 - Admin consent (open in a browser, sign in as the customer's Global Admin):"
Write-Host "https://login.microsoftonline.com/$CustomerTenantId/adminconsent?client_id=$ClientId"
Write-Host ""
Read-Host "Press Enter once consent has been granted to continue with the access policy"

Write-Host "STEP 2 - Scope the app to a single mailbox via Application Access Policy:"
Connect-ExchangeOnline -ShowBanner:$false

$groupName = "m365-connector-scope"
$group = Get-DistributionGroup -Identity $groupName -ErrorAction SilentlyContinue
if (-not $group) {
  $group = New-DistributionGroup -Name $groupName -Type Security -Members $Mailbox
} else {
  Add-DistributionGroupMember -Identity $groupName -Member $Mailbox -ErrorAction SilentlyContinue
}

New-ApplicationAccessPolicy `
  -AppId $ClientId `
  -PolicyScopeGroupId $group.PrimarySmtpAddress `
  -AccessRight RestrictAccess `
  -Description "Ape Dev M365 connector: restrict to $Mailbox"

Write-Host "Verifying policy (expect AccessCheckResult = Granted for $Mailbox):"
Test-ApplicationAccessPolicy -AppId $ClientId -Identity $Mailbox
