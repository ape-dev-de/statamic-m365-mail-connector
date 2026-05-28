terraform {
  required_version = ">= 1.5"

  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }
}

# Authenticate against YOUR (Ape Dev) home tenant. The app object lives here once;
# customer tenants only get an auto-provisioned service principal via admin consent.
provider "azuread" {
  tenant_id = var.home_tenant_id
}
