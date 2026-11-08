variable "name" {
  description = "Prefix for resource names"
  type        = string
  default     = "gada"
}

variable "vpc_cidr" {
  description = "Address range of the VPC"
  type        = string
  default     = "10.20.0.0/16"
}

variable "admin_cidr" {
  description = "Your public IP in CIDR form, for example 203.0.113.7/32. Only this address can reach the servers."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must be a valid CIDR range and must not be 0.0.0.0/0."
  }
}
