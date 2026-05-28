output "client_id" {
  description = "Application (client) ID. Same value for every customer deployment (set as M365_CLIENT_ID)."
  value       = azuread_application.connector.client_id
}

output "application_object_id" {
  description = "Object ID of the app registration in the home tenant."
  value       = azuread_application.connector.object_id
}

output "admin_consent_url_template" {
  description = "Per-customer admin consent URL. Substitute the customer's tenant ID or verified domain."
  value       = "https://login.microsoftonline.com/{customer_tenant}/adminconsent?client_id=${azuread_application.connector.client_id}"
}
