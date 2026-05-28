locals {
  microsoft_graph_app_id = "00000003-0000-0000-c000-000000000000"
  mail_send_role_id      = "b633e1c5-b582-4048-a93e-9f11b44c7e96" # Mail.Send (Application)
}

resource "azuread_application" "connector" {
  display_name     = var.display_name
  sign_in_audience = "AzureADMultipleOrgs" # multi-tenant: customers admin-consent into this single app

  web {
    redirect_uris = var.redirect_uris # CP admin-consent callbacks, one per customer site
  }

  required_resource_access {
    resource_app_id = local.microsoft_graph_app_id

    resource_access {
      id   = local.mail_send_role_id
      type = "Role" # application permission (app-only), not delegated
    }
  }
}

# Service principal in the HOME tenant. Customer tenants provision their own SP on admin consent.
resource "azuread_service_principal" "connector" {
  client_id = azuread_application.connector.client_id
}

# One keyCredential per trusted cert. for_each lets old + new coexist for zero-downtime rotation.
resource "azuread_application_certificate" "signing" {
  for_each = var.certificates

  application_id = azuread_application.connector.id
  type           = "AsymmetricX509Cert"
  encoding       = "pem"
  value          = each.value.value
  end_date       = try(each.value.end_date, null)
}
