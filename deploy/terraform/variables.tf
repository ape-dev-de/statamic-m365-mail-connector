variable "home_tenant_id" {
  description = "Tenant ID of the Ape Dev home tenant where the app registration lives."
  type        = string
}

variable "display_name" {
  description = "Display name of the multi-tenant app registration."
  type        = string
  default     = "Ape Dev Statamic M365 Connector"
}

# Zero-downtime rotation: keep the OLD and NEW certificate in this map at the same
# time. Both are trusted as keyCredentials, so containers signing with either cert
# authenticate successfully during the rollover window. Remove the old entry only
# after every consumer has been redeployed with the new cert.
variable "certificates" {
  description = "Trusted signing certificates (public PEM, the contents of the .crt file)."
  type = map(object({
    value    = string
    end_date = optional(string) # RFC3339, e.g. "2036-05-28T00:00:00Z"; defaults to the cert's own notAfter
  }))
}

# Single shared consent-proxy callback, registered ONCE for all customers,
# e.g. ["https://m365-mailer-callback.ape-dev.de/callback"]. The real per-site CP
# callback travels inside the HMAC-signed state and is never registered here, so
# onboarding a customer requires no change to this app registration.
variable "redirect_uris" {
  description = "Consent-proxy callback URL(s). Registered once; not per customer."
  type        = list(string)
  default     = []
}
